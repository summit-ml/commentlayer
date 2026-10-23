import type { Comment, Persistence, Round, StoreData } from "./core";

/**
 * Google Sheets persistence: a spreadsheet with a `comments` tab and a `rounds` tab, one row per
 * record, headers in row 1. Everything goes through the Sheets REST API with a bearer token the
 * caller obtains (the browser extension uses Chrome's identity API). No server anywhere.
 */

export const COMMENT_COLUMNS = ["id", "page", "selector", "x", "y", "px", "py", "author", "text", "createdAt", "updatedAt", "resolved", "version", "owner", "reactions"] as const;
export const ROUND_COLUMNS = ["id", "label", "createdAt"] as const;
const COMMENTS_TAB = "comments";
const ROUNDS_TAB = "rounds";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

export type SheetsOptions = {
  spreadsheetId: string;
  /** Returns a current OAuth token; called per request so refreshes are the caller's business. */
  token: () => Promise<string>;
  fetch?: typeof fetch;
};

export class SheetsError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(opts: SheetsOptions, path: string, init: RequestInit = {}): Promise<T> {
  const f = opts.fetch ?? fetch;
  const res = await f(`${API}/${opts.spreadsheetId}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await opts.token()}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new SheetsError(body?.error?.message ?? `Sheets request failed (${res.status})`, res.status);
  }
  return (await res.json()) as T;
}

const cell = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : typeof v === "object" ? JSON.stringify(v) : String(v));
const num = (v: string) => (v === "" ? null : Number(v));

function rowToComment(row: string[]): Comment | null {
  const r = Object.fromEntries(COMMENT_COLUMNS.map((k, i) => [k, row[i] ?? ""])) as Record<(typeof COMMENT_COLUMNS)[number], string>;
  if (!r.id) return null;
  return {
    id: r.id,
    page: r.page,
    selector: r.selector,
    x: Number(r.x),
    y: Number(r.y),
    px: num(r.px),
    py: num(r.py),
    author: r.author,
    text: r.text,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt || null,
    resolved: r.resolved === "TRUE",
    version: r.version,
    owner: r.owner,
    reactions: r.reactions ? safeJson(r.reactions) : undefined,
  };
}

function safeJson(text: string): Record<string, string[]> | undefined {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? v : undefined;
  } catch {
    return undefined;
  }
}

export function sheetsPersistence(opts: SheetsOptions): Persistence {
  return {
    async load() {
      const data = await call<{ valueRanges?: { values?: string[][] }[] }>(opts, `/values:batchGet?ranges=${COMMENTS_TAB}!A2:O&ranges=${ROUNDS_TAB}!A2:C&majorDimension=ROWS`);
      const [c, r] = data.valueRanges ?? [];
      const comments = (c?.values ?? []).map(rowToComment).filter((x): x is Comment => !!x);
      const versions: Round[] = (r?.values ?? []).filter((row) => row[0]).map((row) => ({ id: row[0], label: row[1] ?? row[0], createdAt: row[2] ?? "" }));
      return { comments, versions } satisfies StoreData;
    },
    async save(data) {
      const commentRows = data.comments.map((c) => COMMENT_COLUMNS.map((k) => cell(c[k])));
      const roundRows = data.versions.map((v) => ROUND_COLUMNS.map((k) => cell(v[k])));
      await call(opts, `/values:batchClear`, { method: "POST", body: JSON.stringify({ ranges: [`${COMMENTS_TAB}!A2:O`, `${ROUNDS_TAB}!A2:C`] }) });
      await call(opts, `/values:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({
          valueInputOption: "RAW",
          data: [
            { range: `${COMMENTS_TAB}!A2`, majorDimension: "ROWS", values: commentRows.length ? commentRows : [[""]] },
            { range: `${ROUNDS_TAB}!A2`, majorDimension: "ROWS", values: roundRows.length ? roundRows : [[""]] },
          ],
        }),
      });
    },
  };
}

/** Creates a new spreadsheet with the two tabs and header rows. Returns its id and URL. */
export async function createLayerSpreadsheet(title: string, token: () => Promise<string>, f: typeof fetch = fetch): Promise<{ spreadsheetId: string; url: string }> {
  const res = await f(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      properties: { title },
      sheets: [
        { properties: { title: COMMENTS_TAB, gridProperties: { frozenRowCount: 1 } }, data: [{ startRow: 0, startColumn: 0, rowData: [{ values: COMMENT_COLUMNS.map((h) => ({ userEnteredValue: { stringValue: h } })) }] }] },
        { properties: { title: ROUNDS_TAB, gridProperties: { frozenRowCount: 1 } }, data: [{ startRow: 0, startColumn: 0, rowData: [{ values: ROUND_COLUMNS.map((h) => ({ userEnteredValue: { stringValue: h } })) }] }] },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new SheetsError(body?.error?.message ?? `Could not create the spreadsheet (${res.status})`, res.status);
  }
  const data = (await res.json()) as { spreadsheetId: string; spreadsheetUrl: string };
  return { spreadsheetId: data.spreadsheetId, url: data.spreadsheetUrl };
}

/** Pulls a spreadsheet id out of a pasted Sheets URL or a bare id. */
export function parseSpreadsheetId(input: string): string | null {
  const s = input.trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(s) ? s : null;
}
