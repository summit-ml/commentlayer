# Google setup for sheet layers

**Sheet layers are not in the current extension.** The Web Store build has no `identity`
permission, no `oauth2` block in the manifest, and no sheet controls on the options page. The
service worker and the overlay still handle a sheet layer, so a fork can bring them back by
restoring those three things; this page covers the Google side.

A sheet layer stores comments in a Google Sheet using the reviewer's own Google account. For
that it needs an OAuth client, which is a one-time, free setup for whoever publishes the
extension. End users never see any of this; they just see Google's sign-in.

1. **Create a Google Cloud project** at console.cloud.google.com (any name).
2. **Enable the Google Sheets API** under APIs & Services → Library.
3. **Configure the OAuth consent screen**: External, app name "CommentLayer", your support
   email, the privacy policy URL, and the two scopes the extension asks for:
   `https://www.googleapis.com/auth/spreadsheets` and
   `https://www.googleapis.com/auth/userinfo.profile`. While the app is in *Testing*, add the
   Google accounts that may use it (up to 100). Publishing it to everyone requires Google's
   verification because the Sheets scope is classed as sensitive; plan a week or two and a
   short demo video for that.
4. **Create an OAuth client** of type *Chrome Extension*. It asks for the extension ID. For a
   store build that's the ID the Chrome Web Store assigns. For a local build, load the
   unpacked extension once, copy its ID from `chrome://extensions`, and pin it by adding a
   `key` field to the manifest so the ID stays stable (the Web Store docs explain how to get
   the key from the `.pem`).
5. **Add the client to the manifest.** In `extension/src/manifest.json`, add `"identity"` to
   `permissions` and an `oauth2` block with the `client_id` and the two scopes above, then
   rebuild with `npm run build:extension`.

That's it. The first time a reviewer creates or opens a sheet layer, Chrome shows Google's
consent screen once and caches the token. The service worker still answers a `signOut` message
that clears it; the options-page button that sent it was removed with the other sheet controls.

## What the extension does with the access

- Creates a spreadsheet named `CommentLayer · <layer name>` in the user's Drive, with a
  `comments` tab and a `rounds` tab.
- Reads and writes those two tabs. Nothing else in Drive is touched, and nothing leaves the
  user's browser except calls to Google's API.
- Reads the profile name to prefill the name on comments.

## Later: avoiding verification

Google's `drive.file` scope is not classed as sensitive and would avoid verification, but it
only grants access to files the app created or the user picked through Google's file picker.
Adding the picker to the "open a shared sheet" flow would let the extension move to that
scope. Noted as a follow-up.
