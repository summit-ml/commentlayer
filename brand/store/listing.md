# Chrome Web Store listing

Images in this folder, at the store's required sizes:

- `screenshot-1280x800.png`: the main screenshot (up to five allowed; this is the first).
- `small-tile-440x280.png`: the small promo tile.
- `marquee-1400x560.png`: the marquee promo tile.

The 128px icon is `../../extension/src/icon128.png`.

## Name

CommentLayer

## Summary (132 characters max)

Private review notes pinned to any site. Your team sees them on the page, nobody else does. Open source.

## Description

Drop a pin, leave a note. CommentLayer puts review comments on the page itself, anchored to the
exact element, so your team stops describing "the second card under the hero" in a thread.

Private by design. A layer is a Google Sheet you own. Share the sheet with your teammates and
they see the same pins; nobody else can, and nothing is ever posted publicly. No accounts, no
server, nothing passes through us.

- Pins stay attached to the element you clicked, across layout shifts and breakpoints.
- Notes grouped into review rounds, with older rounds viewable read-only.
- Up and down votes on every note, anonymous to everyone but you.
- A drawer with every note across the site, with jump links and CSV or JSON export.
- Themes itself to the site's brand colors, or set your own.
- Invite teammates with one link.
- Open source under the MIT license: github.com/summit-ml/commentlayer

Advanced: point a layer at a CommentLayer backend you host instead of a sheet.

## Category

Developer Tools (alternatively Productivity)

## Permission justifications

- **Host permissions, all sites**: the extension injects the comment overlay on sites the user
  has explicitly turned it on for. Nothing is injected elsewhere; the toolbar icon is the switch.
- **storage**: layers, the user's display name, and theme preferences.
- **tabs**: to show the on/off badge for the current site and reload the page when toggled.
- **identity**: Google sign-in so the extension can read and write the user's own spreadsheet.

## Privacy policy

Required. Point at a page on summitml.com that says: comments are stored in the user's own Google
Sheet or a backend of the user's choosing; the extension sends nothing to Summit ML; the only
third party is Google's Sheets API, under the user's own account.
