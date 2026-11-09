# CommentLayer brand

- `mark.svg`: the mark, a layer with a pin. Use at 32px and up.
- `mark-small.svg`: the same mark with heavier strokes for 16 to 24px (favicons, toolbar).
- `wordmark.svg`: mark plus the `commentLayer` wordmark. Helvetica Neue Bold, "comment" in
  ink `#f0efeb`, "Layer" in `#8f8a8d`, pin in `#c94a8f`. On light backgrounds use `#1f1c1f`
  for "comment" and `#6b6468` for "Layer".

The wordmark is one word, lower-case c, capital L: commentLayer.

`icon-128.png` through `icon-1024.png` are `mark.svg` rendered on a transparent background
(`rsvg-convert -w N -h N mark.svg -o icon-N.png`); `icon-1024-dark.png` is the same mark on the
brand's near-black `#151316`, for avatars and anywhere a solid square is needed.

`store/` holds the Chrome Web Store promo images; the listing copy is in `../store/LISTING.md`.
The marquee and the promo screenshot are rendered from `store/promo.html`, so they stay crisp;
regenerate them when the UI or the pitch changes:

```sh
chrome --headless=new --hide-scrollbars --force-device-scale-factor=1 --window-size=1400,560 \
  --screenshot=brand/store/marquee-1400x560.png "file://$PWD/brand/store/promo.html?v=marquee"
chrome --headless=new --hide-scrollbars --force-device-scale-factor=1 --window-size=1280,800 \
  --screenshot=brand/store/screenshot-1280x800.png "file://$PWD/brand/store/promo.html?v=screenshot"
```
