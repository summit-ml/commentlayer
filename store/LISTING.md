# Chrome Web Store listing

Paste these into the Developer Dashboard. Upload `commentlayer-<version>.zip`, built with
`npm run package` in `packages/commentlayer`.

## Store listing

**Name:** CommentLayer

**Summary (132 characters max):**
Drop a pin, leave a note. Private review comments on any website. One click to start, one link to invite.

**Category:** Developer Tools

**Language:** English

**Description:**

Stop sending screenshots with red circles on them.

CommentLayer puts review comments on the page itself. Turn it on, click the thing that's wrong, and say what should change. Your teammates see a numbered pin exactly where you left it, and a drawer lists every note across the site.

How it works
• Create a layer in one click. No account, no sign-in.
• Copy the invite link and send it to your team. Anyone with the link can comment.
• Click the toolbar icon on any site to turn the layer on there, then click anything to leave a note.

What you get
• Pins anchored to the element, not the pixel, so they stay put when the layout changes
• Review rounds, so each pass of feedback stays separate
• Resolve, vote, edit, and delete notes
• Export everything as CSV or JSON
• Works on any site, including staging and localhost
• Themes itself to the site's brand colors

Private by design
Only people with your invite link can see your notes, and nothing is ever posted to the site. A layer is deleted automatically 30 days after its last note, or whenever you delete it. Prefer to keep data on your own servers? Point the extension at your own CommentLayer backend instead.

Open source under the MIT license: https://github.com/summit-ml/commentlayer
Built by Summit ML: https://summitml.com/products/open-source

**Screenshots (1280×800):** `screenshot-drawer.png`, `screenshot-panel.png`

**Icon:** `extension/src/icon128.png`

**Official URL:** https://summitml.com (verify the domain in Search Console if the dashboard asks)

**Homepage URL:** https://summitml.com/products/open-source

**Support URL:** https://github.com/summit-ml/commentlayer/issues

## Privacy practices

**Single purpose:**
Leave and read review comments pinned to elements on web pages, shared with the people who have a layer's invite link.

**Permission justifications:**

- `storage`: Saves the reviewer's layers, display name, theme colors, and a random identifier used to edit their own comments.
- `tabs`: Reads the current tab's address so the toolbar icon can turn a layer on or off for that site and show whether it is active there.
- Host permission (all sites): Reviewers comment on whatever site they are reviewing, so the comment overlay must be able to load on any page the user turns it on for. The overlay only reads the clicked element's position and selector to place a pin; it does not read page content.

**Remote code:** No, I am not using remote code. (All JavaScript ships in the package.)

**Data usage, check:**
- Personally identifiable information (the name the user types to sign comments)
- Website content (the comment text, page address, and element the user pins it to)

**Certify all three:** not sold to third parties; not used for purposes unrelated to the single purpose; not used for creditworthiness or lending.

**Privacy policy URL:** https://summitml.com/policies/privacy#commentlayer

## Distribution

Start with **Unlisted** for a team test, then switch to **Public**.
