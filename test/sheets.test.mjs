import { test } from "node:test";
import assert from "node:assert/strict";
import { sheetsPersistence, createLayerSpreadsheet, parseSpreadsheetId, COMMENT_COLUMNS } from "../src/sheets.ts";
import { createCommentStore } from "../src/core.ts";

// A fake Sheets API: two tabs held in memory, enough of values:batchGet/batchClear/batchUpdate.
function fakeSheets() {
  const tabs = { comments: [], rounds: [] };
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET" });
    const ok = (data) => new Response(JSON.stringify(data), { status: 200 });
    if (url.includes("values:batchGet")) return ok({ valueRanges: [{ values: tabs.comments }, { values: tabs.rounds }] });
    if (url.includes("values:batchClear")) { tabs.comments = []; tabs.rounds = []; return ok({}); }
    if (url.includes("values:batchUpdate")) {
      const body = JSON.parse(init.body);
      for (const d of body.data) { const tab = d.range.startsWith("comments") ? "comments" : "rounds"; tabs[tab] = d.values.filter((r) => r[0] !== ""); }
      return ok({});
    }
    if (url.endsWith("/spreadsheets")) return ok({ spreadsheetId: "abc123", spreadsheetUrl: "https://docs.google.com/spreadsheets/d/abc123" });
    return new Response(JSON.stringify({ error: { message: "nope" } }), { status: 404 });
  };
  return { tabs, calls, fetchFn };
}

test("round-trips comments and rounds through the sheet", async () => {
  const sheet = fakeSheets();
  const persistence = sheetsPersistence({ spreadsheetId: "abc123", token: async () => "tok", fetch: sheet.fetchFn });
  const store = await createCommentStore({ persistence, adminToken: "admin" });
  assert.equal(store.versions().current, "r1");
  assert.equal(sheet.tabs.rounds.length, 1);
  await store.create({ page: "/", selector: "h1", x: 0.5, y: 0.2, px: 10, py: 20, author: "Ann", text: "Tighter" }, "hash-ann");
  assert.equal(sheet.tabs.comments.length, 1);
  assert.equal(sheet.tabs.comments[0][COMMENT_COLUMNS.indexOf("author")], "Ann");
  assert.equal(sheet.tabs.comments[0][COMMENT_COLUMNS.indexOf("resolved")], "FALSE");
  // a second store instance (another teammate) sees the same data
  const again = await createCommentStore({ persistence, adminToken: "admin" });
  const list = again.list({ page: "/", tokenHash: "hash-ann", admin: null });
  assert.equal(list.length, 1);
  assert.equal(list[0].mine, true);
  assert.equal(list[0].px, 10);
  await again.update(list[0].id, { resolved: true }, "hash-bob", null);
  assert.equal(sheet.tabs.comments[0][COMMENT_COLUMNS.indexOf("resolved")], "TRUE");
});

test("creates a spreadsheet with headers and parses ids from links", async () => {
  const sheet = fakeSheets();
  const r = await createLayerSpreadsheet("CommentLayer · test", async () => "tok", sheet.fetchFn);
  assert.equal(r.spreadsheetId, "abc123");
  assert.equal(parseSpreadsheetId("https://docs.google.com/spreadsheets/d/1AbC_dEf-123456789012345/edit#gid=0"), "1AbC_dEf-123456789012345");
  assert.equal(parseSpreadsheetId("1AbC_dEf-123456789012345"), "1AbC_dEf-123456789012345");
  assert.equal(parseSpreadsheetId("hello"), null);
});
