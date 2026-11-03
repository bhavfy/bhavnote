# Bhavnote

A private studio notebook for an independent video editor — notes, ideas, a YouTube store, an editing lab and clients, in one premium dark app.

**Open it:** https://bhavfy.github.io/bhavnote/

- Works on phone (Android layout with bottom nav) and laptop (sidebar).
- Everything is saved only on your device (browser localStorage). No accounts, no cloud.
- Global search: `Ctrl K` / `⌘K` (search icon on phone).
- Settings → Export / Import a JSON backup, remove sample data.
- Installable: in Chrome on Android tap ⋮ → **Add to Home screen**. Works offline.

Plain HTML/CSS/JS, no build step. Edit `app.js` (sample data is in `seed()`), `styles.css`, or `index.html` right here on GitHub; the site updates within a minute. After changing files, bump `CACHE` in `sw.js` (e.g. `bhavnote-v2`) so installed apps pick up the new version.
