# Bhavnote

A private studio notebook for an independent video editor — notes (ideas, techniques, styles, references), a content calendar, an earnings dashboard (Paisa), clients, a YouTube store and Bhav AI, in one premium dark app.

**v2:** smoother on Android (no live glass blur), Ideas + Editing Lab merged into Notes (old entries are moved automatically), no floating + button; new tabs Calendar, Paisa and Bhav AI (runs on your own free Google Gemini API key, saved only on this device — Settings → Bhav AI), plus History (timeline, 30-day Trash, saved AI chats) and Books (PDF → easy Hinglish reader; pdf.js is vendored in `vendor/pdfjs`, Apache-2.0).

**Open it:** https://bhavfy.github.io/bhavnote/

- Works on phone (Android layout with bottom nav) and laptop (sidebar).
- Everything is saved only on your device (browser localStorage). No accounts, no cloud.
- Global search: `Ctrl K` / `⌘K` (search icon on phone).
- Settings → Export / Import a JSON backup, remove sample data.
- Installable: in Chrome on Android tap ⋮ → **Add to Home screen**. Works offline.
- Android APK: [apk/Bhavnote.apk](https://github.com/bhavfy/bhavnote/raw/main/apk/Bhavnote.apk) — a thin app that opens this live site, so edits here show up in the app automatically. (APK data and browser data are stored separately; use Settings → Export/Import to move.)

Plain HTML/CSS/JS, no build step. Files: `app.js` (core, storage, Notes/Clients/Videos; sample data in `seed()` / `seedV3()`), `paisa.js`, `calendar.js`, `ai.js`, `history.js`, `books.js`. Edit `app.js`, `styles.css`, or `index.html` right here on GitHub; the site updates within a minute. After changing files, bump `CACHE` in `sw.js` and the `?v=` on `styles.css` / `app.js` in `index.html` so installed apps pick up the new version.
