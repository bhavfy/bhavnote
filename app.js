/* Bhavnote — private studio notebook. Everything lives in this browser's localStorage. */
(function () {
  "use strict";

  var KEY = "bhavnote.v1";
  var SCHEMA = 3;

  /* ---------------- types ---------------- */
  var TYPES = {
    note:   { label: "Notes", one: "Note", route: "notes", icon: "i-note", opt: "kind", opts: ["note", "technique", "style", "reference", "idea"], hint: "Ideas, techniques, styles, references" },
    video:  { label: "YouTube Store", one: "Video", route: "youtube", icon: "i-play", opt: "category", opts: ["tutorial", "reference", "inspiration", "client", "music", "other"], hint: "Save a YouTube link" },
    client: { label: "Clients", one: "Client", route: "clients", icon: "i-users", opt: "status", opts: ["lead", "active", "review", "delivered", "paused"], hint: "Jobs, deadlines, rates" },
    post:   { label: "Content", one: "Content plan", route: "calendar", icon: "i-cal", opt: "status", opts: ["idea", "script", "shoot", "edit", "posted"], hint: "Reel / YT / Shorts on a date" },
    income: { label: "Income", one: "Income", route: "paisa", icon: "i-rupee", opt: "status", opts: ["paid", "pending"], hint: "Payment received or due" },
    expense:{ label: "Kharcha", one: "Kharcha", route: "paisa", icon: "i-wallet", opt: "category", opts: ["software", "gear", "internet", "food", "travel", "other"], hint: "Money spent" }
  };
  var ORDER = ["note", "video", "client", "post"];
  var CREATE_ORDER = ["note", "post", "income", "expense", "client", "video"];
  var PLATFORMS = ["reel", "yt", "shorts"];
  var PLATFORM_LABEL = { reel: "Reel", yt: "YouTube", shorts: "Shorts" };
  var PAY_MODES = ["upi", "cash", "bank"];
  var ROUTE_TYPE = { notes: "note", youtube: "video", clients: "client" };
  var NOTE_KINDS = ["note", "technique", "style", "reference", "idea"];
  var RATE_UNITS = ["project", "video", "month", "day", "hour"];

  /* ---------------- helpers ---------------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function now() { return new Date().toISOString(); }
  function debounce(fn, ms) { var t; var d = function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { t = null; fn.apply(self, a); }, ms); }; d.flush = function () { if (t) { clearTimeout(t); t = null; fn(); } }; return d; }
  function icon(id, cls) { return '<svg class="ic' + (cls ? " " + cls : "") + '" aria-hidden="true"><use href="#' + id + '"/></svg>'; }
  function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }
  function parseTags(s) {
    var seen = {}; return String(s || "").split(/[,#\n]/).map(function (t) { return t.trim().toLowerCase().replace(/\s+/g, "-"); })
      .filter(function (t) { if (!t || seen[t]) return false; seen[t] = 1; return true; }).slice(0, 20);
  }
  function titleOf(it) {
    if (it.type === "client") return it.name || "Untitled";
    if (it.type === "income") return it.source || "Income";
    if (it.type === "expense") return it.title || cap(it.category || "Kharcha");
    return it.title || "Untitled";
  }
  function bodyOf(it) {
    if (it.type === "client") return [it.project, it.notes].filter(Boolean).join(" · ");
    if (it.type === "income" || it.type === "expense") return [INR.format(+it.amount || 0), it.mode ? it.mode.toUpperCase() : "", fmtDate(it.date), it.note].filter(Boolean).join(" · ");
    if (it.type === "post") return [PLATFORM_LABEL[it.platform] || "", fmtDate(it.date), it.hook, it.notes].filter(Boolean).join(" · ");
    if (it.type === "video") return it.notes || it.channel || "";
    return it.body || "";
  }
  function ago(iso) {
    var d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!isFinite(d)) return "";
    if (d < 60) return "just now";
    if (d < 3600) return Math.floor(d / 60) + "m ago";
    if (d < 86400) return Math.floor(d / 3600) + "h ago";
    if (d < 86400 * 7) return Math.floor(d / 86400) + "d ago";
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  }
  function ymd(date) { var d = new Date(date); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function addDays(n) { var d = new Date(); d.setDate(d.getDate() + n); return ymd(d); }
  function daysUntil(s) {
    if (!s) return null; var p = String(s).split("-"); if (p.length !== 3) return null;
    var t = new Date(+p[0], +p[1] - 1, +p[2]); var n = new Date(); n.setHours(0, 0, 0, 0);
    return Math.round((t - n) / 86400000);
  }
  function fmtDate(s) { var p = String(s || "").split("-"); if (p.length !== 3) return ""; return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); }
  var INR = (function () { try { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }); } catch (e) { return { format: function (n) { return "₹" + n; } }; } })();
  function fmtRate(it) { if (it.rate === "" || it.rate == null || isNaN(+it.rate)) return ""; return INR.format(+it.rate) + (it.rateUnit ? " / " + it.rateUnit : ""); }
  function ytId(url) {
    if (!url) return null;
    var m = String(url).match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }
  function safeUrl(u) { u = String(u || "").trim(); if (!u) return ""; if (!/^https?:\/\//i.test(u)) u = "https://" + u; try { var x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch (e) { return ""; } }
  function dueBadge(it) {
    var d = daysUntil(it.deadline); if (d === null) return "";
    var open = ["lead", "active", "review"].indexOf(it.status) > -1;
    if (!open) return '<span class="badge plain">' + icon("i-clock") + esc(fmtDate(it.deadline)) + "</span>";
    var txt, cls;
    if (d < 0) { txt = "Overdue " + (-d) + (d === -1 ? " day" : " days"); cls = "due-late"; }
    else if (d === 0) { txt = "Due today"; cls = "due-late"; }
    else if (d === 1) { txt = "Due tomorrow"; cls = "due-soon"; }
    else { txt = "Due in " + d + " days"; cls = d <= 5 ? "due-soon" : "due-ok"; }
    return '<span class="badge plain ' + cls + '" title="' + esc(fmtDate(it.deadline)) + '">' + icon("i-clock") + txt + "</span>";
  }

  /* ---------------- storage ---------------- */
  var db;
  function blank() { return { app: "bhavnote", schema: SCHEMA, settings: { displayName: "Bhavesh", studioName: "BHAvFY Studio" }, items: [], createdAt: now() }; }
  /* v2: Ideas and Editing Lab became part of Notes. Anything the user saved there moves into Notes
     (title, body, tags, favorite, link kept; tagged "idea" / "lab"). Untouched built-in samples of Ideas are dropped. */
  function addTag(tags, t) { tags = Array.isArray(tags) ? tags.slice() : parseTags(tags); if (tags.indexOf(t) < 0) tags.push(t); return tags; }
  function migrateItem(it) {
    if (!it || (it.type !== "idea" && it.type !== "lab")) return it;
    var o = Object.assign({}, it), was = it.type;
    o.type = "note";
    if (was === "idea") {
      o.kind = "idea";
      if (it.status) o.ideaStatus = it.status;
      delete o.status;
      if (!it.sample) o.tags = addTag(o.tags, "idea");
    } else {
      o.kind = NOTE_KINDS.indexOf(it.kind) > -1 ? it.kind : "reference";
      if (it.kind === "tutorial") o.tags = addTag(o.tags, "tutorial");
      if (!it.sample) o.tags = addTag(o.tags, "lab");
    }
    o.migratedFrom = was;
    return o;
  }
  function migrateItems(items) {
    return items.filter(function (i) { return i && !(i.type === "idea" && i.sample); }).map(migrateItem);
  }
  function normalize(data) {
    data.settings = Object.assign({ displayName: "", studioName: "" }, data.settings || {});
    var old = data.items.some(function (i) { return i && (i.type === "idea" || i.type === "lab"); });
    if (old) data.items = migrateItems(data.items);
    var changed = old;
    // v3 added Paisa + Content calendar: give them a few removable examples, but only if this
    // device still has sample data (someone who already removed samples doesn't get new ones).
    if ((data.schema || 1) < 3) {
      if (data.items.some(function (i) { return i && i.sample; })) data.items = data.items.concat(seedV3());
      changed = true;
    }
    data.schema = SCHEMA;
    return { data: data, migrated: changed };
  }
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (raw) {
      try {
        var data = JSON.parse(raw);
        if (data && Array.isArray(data.items)) {
          var n = normalize(data);
          if (n.migrated) {
            // keep the untouched v1 copy, then save the migrated data
            try { if (!localStorage.getItem(KEY + ".backup-v1")) localStorage.setItem(KEY + ".backup-v1", raw); } catch (e) {}
            persist(n.data);
          }
          return n.data;
        }
      } catch (e) { /* fall through */ }
      // Unreadable data is never thrown away: keep a copy before starting fresh.
      try { localStorage.setItem(KEY + ".unreadable-" + Date.now(), raw); } catch (e) {}
    }
    var fresh = blank();
    fresh.items = seed();
    fresh.seededAt = now();
    persist(fresh);
    return fresh;
  }
  function persist(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data || db)); return true; }
    catch (e) { toast("Couldn't save — device storage is full or blocked."); return false; }
  }
  function save() { persist(db); logDiff(); updateCounts(); }
  /* ---------------- IndexedDB (history, trash, AI chats, books) ---------------- */
  var IDB = (function () {
    var dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (res, rej) {
        if (!window.indexedDB) { rej(new Error("IndexedDB not available")); return; }
        var r = indexedDB.open("bhavnote", 1);
        r.onupgradeneeded = function () { var d = r.result; ["events", "trash", "chats", "books", "chunks", "kv"].forEach(function (n) { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: "id" }); }); };
        r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
      });
      dbp.catch(function () { dbp = null; });
      return dbp;
    }
    function run(store, mode, fn) {
      return open().then(function (d) { return new Promise(function (res, rej) {
        var t = d.transaction(store, mode), s = t.objectStore(store), req = fn(s);
        t.oncomplete = function () { res(req && "result" in req ? req.result : undefined); };
        t.onerror = function () { rej(t.error); }; t.onabort = function () { rej(t.error); };
      }); });
    }
    return {
      put: function (store, o) { return run(store, "readwrite", function (s) { s.put(o); }); },
      putMany: function (store, arr) { return run(store, "readwrite", function (s) { arr.forEach(function (o) { s.put(o); }); }); },
      get: function (store, id) { return run(store, "readonly", function (s) { return s.get(id); }); },
      del: function (store, id) { return run(store, "readwrite", function (s) { s.delete(id); }); },
      delMany: function (store, ids) { return run(store, "readwrite", function (s) { ids.forEach(function (id) { s.delete(id); }); }); },
      all: function (store) { return run(store, "readonly", function (s) { return s.getAll(); }); },
      keys: function (store) { return run(store, "readonly", function (s) { return s.getAllKeys(); }); },
      range: function (store, from, to) { return run(store, "readonly", function (s) { return s.getAll(IDBKeyRange.bound(from, to)); }); }
    };
  })();

  /* ---------------- history: every change is diffed on save() and logged ---------------- */
  var HIST_MAX = 2000, TRASH_DAYS = 30;
  var snap = {}, snapSet = "", actor = "you", quiet = false, restoring = false;
  var SKIP_KEYS = { updatedAt: 1, createdAt: 1, sample: 1, migratedFrom: 1, id: 1, type: 1 };
  function logSettings() { return JSON.stringify({ displayName: db.settings.displayName || "", studioName: db.settings.studioName || "", goal: db.settings.goal || 0 }); }
  function snapAll() { snap = {}; db.items.forEach(function (it) { snap[it.id] = JSON.stringify(it); }); snapSet = logSettings(); }
  function shortVal(v) { if (v == null || v === "") return "—"; if (Array.isArray(v)) v = v.join(", "); v = String(v).replace(/\s+/g, " "); return v.length > 60 ? v.slice(0, 57) + "…" : v; }
  function diffItem(o, n) {
    var ch = [], keys = {}; Object.keys(o).concat(Object.keys(n)).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) { if (SKIP_KEYS[k]) return; var a = JSON.stringify(o[k] == null ? "" : o[k]), b = JSON.stringify(n[k] == null ? "" : n[k]); if (a !== b) ch.push({ k: k, from: shortVal(o[k]), to: shortVal(n[k]) }); });
    return ch;
  }
  var evSeq = 0;
  function mkEvent(action, it, ch) {
    return { id: now() + "-" + String(++evSeq).padStart(4, "0") + uid().slice(-3), at: now(), action: action, type: it.type, itemId: it.id, title: titleOf(it), by: actor, changes: ch || null };
  }
  function logDiff() {
    var evs = [], trash = [], seen = {};
    try {
      db.items.forEach(function (it) {
        seen[it.id] = 1; var j = JSON.stringify(it), old = snap[it.id]; if (old === j) return; snap[it.id] = j;
        if (old === undefined) { if (!quiet) evs.push(mkEvent(restoring ? "restore" : "create", it)); }
        else if (!quiet) { var ch = diffItem(JSON.parse(old), it); if (ch.length) evs.push(mkEvent("edit", it, ch)); }
      });
      Object.keys(snap).forEach(function (id) {
        if (seen[id]) return; var o = JSON.parse(snap[id]); delete snap[id];
        if (quiet && o.sample) return;
        evs.push(mkEvent("delete", o)); trash.push({ id: o.id, at: now(), item: o, by: actor });
      });
      var s = logSettings();
      if (s !== snapSet) { var a = JSON.parse(snapSet || "{}"), b = JSON.parse(s); var ch2 = diffItem(a, b); snapSet = s; if (ch2.length && !quiet) evs.push({ id: now() + "-s" + uid().slice(-4), at: now(), action: "edit", type: "settings", itemId: null, title: "Settings", by: actor, changes: ch2 }); }
    } catch (e) { console.warn("history", e); }
    if (evs.length) IDB.putMany("events", evs).catch(function () {});
    if (trash.length) IDB.putMany("trash", trash).catch(function () {});
  }
  function logEvent(action, type, title, changes) { IDB.put("events", { id: now() + "-x" + uid().slice(-4), at: now(), action: action, type: type, itemId: null, title: title, by: actor, changes: changes || null }).catch(function () {}); }
  function asActor(who, fn) { var prev = actor; actor = who; try { return fn(); } finally { actor = prev; } }
  function quietly(fn) { quiet = true; try { return fn(); } finally { quiet = false; } }
  function pruneHistory() {
    IDB.keys("events").then(function (keys) { if (keys.length > HIST_MAX) return IDB.delMany("events", keys.slice(0, keys.length - HIST_MAX)); }).catch(function () {});
    var cutoff = new Date(Date.now() - TRASH_DAYS * 86400000).toISOString();
    IDB.all("trash").then(function (rows) { var old = rows.filter(function (r) { return r.at < cutoff; }).map(function (r) { return r.id; }); if (old.length) return IDB.delMany("trash", old); }).catch(function () {});
  }
  function restoreFromTrash(row) {
    if (byId(row.item.id)) { var copy = Object.assign({}, row.item, { id: uid() }); row = { id: row.id, item: copy }; }
    restoring = true; try { db.items.push(Object.assign({}, row.item, { updatedAt: now() })); save(); } finally { restoring = false; }
    return IDB.del("trash", row.id);
  }

  function byId(id) { for (var i = 0; i < db.items.length; i++) if (db.items[i].id === id) return db.items[i]; return null; }


  /* ---------------- money / client helpers (shared with feature modules) ---------------- */
  function monthKey(d) { if (!d) return ""; if (typeof d === "string") return d.slice(0, 7); return ymd(d).slice(0, 7); }
  function findClient(name) {
    var n = String(name || "").trim().toLowerCase(); if (!n) return null;
    for (var i = 0; i < db.items.length; i++) { var it = db.items[i]; if (it.type === "client" && String(it.name || "").trim().toLowerCase() === n) return it; }
    return null;
  }
  function clientPending(name) {
    var n = String(name || "").trim().toLowerCase(); var sum = 0, list = [];
    db.items.forEach(function (it) { if (it.type === "income" && it.status === "pending" && String(it.source || "").trim().toLowerCase() === n) { sum += +it.amount || 0; list.push(it); } });
    return { sum: sum, items: list };
  }
  function phoneOf(c) {
    var raw = String((c && (c.phone || c.contact)) || ""); if (/@/.test(raw) && !/\d{10}/.test(raw.replace(/\D/g, ""))) return "";
    var d = raw.replace(/\D/g, "");
    if (d.length === 10) return "91" + d;
    if (d.length === 11 && d.charAt(0) === "0") return "91" + d.slice(1);
    if (d.length >= 11 && d.length <= 13) return d;
    return "";
  }
  function reminderText(name, amount, note) {
    var first = String(name || "").trim().split(/\s+/)[0] || "";
    var me = db.settings.displayName || ""; var studio = db.settings.studioName || "";
    return "Namaste " + first + " ji 🙏\n\nUmeed hai aap theek ho. Bas ek chhota sa reminder — " + INR.format(+amount || 0) + " ka payment" + (note ? " (" + note + ")" : "") +
      " abhi pending hai. Jab bhi time mile, UPI ya bank transfer se bhej dijiye.\n\nThank you! 😊" + (me || studio ? "\n— " + [me, studio].filter(Boolean).join(", ") : "");
  }
  function copyText(text) {
    text = String(text || ""); if (!text) { toast("Kuch copy karne ko nahi hai"); return; }
    function fallback() { var ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); toast("Copied ✓"); } catch (e) { toast("Copy nahi hua"); } ta.remove(); }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { toast("Copied ✓"); }, fallback); else fallback();
  }

  /* ---------------- sample data ---------------- */
  function seed() {
    var t = Date.now(), h = 3600000, n = 0;
    function mk(type, o, hoursAgo) {
      var ts = new Date(t - hoursAgo * h).toISOString();
      return Object.assign({ id: "s-" + type + "-" + (++n) + "-" + uid(), type: type, tags: [], fav: false, sample: true, createdAt: ts, updatedAt: ts }, o);
    }
    return [
      // Notes
      mk("note", { kind: "reference", title: "Delivery spec — YouTube 4K (SDR)", fav: true, tags: ["delivery", "youtube", "export"],
        body: "Resolution: 3840×2160 (16:9)\nCodec: H.264 High profile (or H.265), progressive\nFrame rate: same as source — 23.976 / 25 / 29.97\nBitrate (SDR): 35–45 Mbps for 24–30 fps, 53–68 Mbps for 48–60 fps\nColour: Rec.709, full-range OFF\nAudio: AAC-LC 320 kbps, 48 kHz, stereo\nLoudness: around −14 LUFS integrated, true peak −1 dBTP\n\nUpload 4K even for 1080p projects — YouTube gives 4K uploads the better VP9/AV1 encode." }, 3),
      mk("note", { kind: "reference", title: "Delivery spec — Instagram Reels & YouTube Shorts", tags: ["delivery", "reels", "shorts", "vertical"],
        body: "Canvas: 1080×1920 (9:16)\nCodec: H.264, 30 fps (or 25 if shot PAL)\nBitrate: 12–16 Mbps VBR 2-pass, keep file under ~250 MB\nAudio: AAC 320 kbps, 48 kHz, −14 LUFS\nLength: Reels and Shorts both up to 3 min\nSafe zone: keep captions & logos out of top ~250 px and bottom ~420 px (UI buttons and caption bar)\nCover: export a 1080×1920 still, centre the subject for the 1:1 grid crop." }, 20),
      mk("note", { kind: "technique", title: "Premiere: J & L cuts without unlinking", tags: ["premiere", "audio", "dialogue"],
        body: "Hold Alt (Option on Mac) and drag only the audio edge to make the sound lead (J) or trail (L) the picture.\nOr use the Rolling Edit tool (N) on just the audio track.\nRule of thumb for interviews: let the next speaker's audio come in 6–12 frames before the cut." }, 30),
      mk("note", { kind: "technique", title: "Premiere: dialogue cleanup chain", fav: true, tags: ["premiere", "audio", "podcast"],
        body: "1. Essential Sound → tag as Dialogue → Enhance Speech (mix 60–80%, not 100%)\n2. DeNoise 20–40% if fan/AC hum remains\n3. Parametric EQ: high-pass 80 Hz, small dip at 250–350 Hz for boxiness\n4. DeEsser, then Dynamics compressor ~3:1\n5. Loudness Meter: −14 LUFS for YouTube, −16 LUFS for podcasts\nMusic bed sits 18–22 dB under the voice." }, 52),
      mk("note", { kind: "technique", title: "Resolve: Magic Mask for skin & subject", tags: ["resolve", "color", "masking"],
        body: "Colour page → Magic Mask (Studio) → Person mode, draw one stroke on the face → Track forward/back.\nRefine: Quality = Better, Smart refine on, soft edge 2–4.\nUse it as a window for exposure and skin tone only — keep the global grade on its own node so the mask can't break the whole shot." }, 76),
      mk("note", { kind: "style", title: "Clean talking-head look (YouTube)", tags: ["style", "youtube", "captions"],
        body: "Punch-ins 110–120% on emphasis, never two in a row.\nCut breaths and 'umm' but keep a natural rhythm — leave 2–4 frames.\nCaptions: bold white, 1 key word in brand colour, max 2 lines, centre-lower third.\nB-roll every 6–10 s on long explainers. Subtle whoosh on transitions only." }, 100),
      mk("note", { kind: "note", title: "Client revision policy", tags: ["business", "clients"],
        body: "2 revision rounds included in every quote.\nRound 3+ billed at ₹1,500/hour.\nFeedback only through one person, in one timestamped list (Frame.io / Google Doc).\n50% advance before starting, rest before final export without watermark." }, 140),
      mk("note", { kind: "reference", title: "Client preview exports (WhatsApp/Drive)", tags: ["export", "clients", "preview"],
        body: "1080p H.264 at 8 Mbps, 'PREVIEW' watermark top-right at 40% opacity, burnt-in timecode for feedback.\nSend on WhatsApp as a Document, not as video, so it isn't re-compressed.\nFinals go on Google Drive with the date in the file name: CLIENT_Project_v03_2026-11-04.mp4" }, 190),
      // YouTube Store
      mk("video", { category: "tutorial", title: "How to Edit Video with the J-Cut and L-Cut in Premiere Pro", url: "https://www.youtube.com/watch?v=DVSZujJDYXg", channel: "tutvid", tags: ["premiere", "audio"], notes: "Best clear explanation of J/L cuts — show this to interns." }, 8),
      mk("video", { category: "tutorial", title: "5 creative ways to use the Magic Mask in DaVinci Resolve", url: "https://www.youtube.com/watch?v=6i0GfE4dTkE", channel: "Creator Sergeant - Julian Woldan", tags: ["resolve", "color", "masking"], notes: "Background desaturation trick at the end is great for product shots." }, 26),
      mk("video", { category: "tutorial", title: "The NEW Way to Speed Ramp Davinci Resolve Tutorial", url: "https://www.youtube.com/watch?v=c4YOJQwFopw", channel: "DanVinci", tags: ["resolve", "speed-ramp"], fav: true, notes: "Retime curve method. Use for the gym/fitness reels." }, 48),
      mk("video", { category: "tutorial", title: "Adobe Enhance Speech explained — Premiere Pro", url: "https://www.youtube.com/watch?v=8bubIvQ8AnU", channel: "Matt WhoisMatt Johnson", tags: ["premiere", "audio"], notes: "Mix amount tip: don't run it at 100%." }, 90),
      mk("video", { category: "reference", title: "Colour Grading for Beginners (DaVinci Resolve)", url: "https://www.youtube.com/watch?v=_KImTKhy_mI", channel: "Declan Jenkinson", tags: ["resolve", "color"], notes: "Node order reference: balance → match → look." }, 120),
      mk("video", { category: "reference", title: "Best Export Settings for Premiere Pro for YouTube", url: "https://www.youtube.com/watch?v=DHSw4yghUZs", channel: "Matt WhoisMatt Johnson", tags: ["export", "youtube"] }, 160),
      mk("video", { category: "inspiration", title: "How to Make Instagram Reels in Premiere Pro (captions, workflow, export)", url: "https://www.youtube.com/watch?v=N_cFWHOVCG0", channel: "Think Media", tags: ["reels", "captions"] }, 210),
      mk("video", { category: "client", title: "Richa & Rohan — cinematic wedding teaser (reference)", url: "https://www.youtube.com/watch?v=c9-oPkdRSRo", channel: "Harman Films", tags: ["wedding", "teaser"], notes: "Kapoor Weddings wants this pacing for the Mehta–Shah teaser." }, 28),
      mk("video", { category: "music", title: "massobeats — until then (royalty free lofi)", url: "https://www.youtube.com/watch?v=7FrSki6hvzs", channel: "massobeats", tags: ["music", "lofi", "vlog"], notes: "Check licence terms before client use." }, 260),
      // Editing know-how (was Editing Lab)
      mk("note", { kind: "technique", title: "Hook in the first 2 seconds", fav: true, tags: ["retention", "shorts"],
        body: "Open on the most visual moment, not the intro.\nText on screen in frame 1, voice starts by 0.3 s.\nCut the first sentence if it's context — start on the claim." }, 16),
      mk("note", { kind: "technique", title: "Match cut on motion", tags: ["transitions"],
        body: "Cut at the peak of a movement (hand swing, head turn, whip). Shift the incoming clip 2–3 frames earlier so motion feels continuous. Add a 4-frame whoosh only if the motion is fast." }, 60),
      mk("note", { kind: "style", title: "Wedding teaser grade — warm film", tags: ["resolve", "wedding", "color"],
        body: "CST to DaVinci Wide Gamut → balance → skin on its own node (hue vs hue) → soft split tone: shadows teal 5%, highlights warm 8% → halation light → grain 35 size, 5–8% strength → CST to Rec.709." }, 110),
      mk("note", { kind: "style", title: "Documentary YouTube pacing", tags: ["youtube", "pacing"],
        body: "Music changes every chapter. Hard cuts on beats, J-cuts into interviews, 1 sound design moment per minute. Lower thirds: 2 lines, 3 s in, 0.3 s ease." }, 170),
      mk("note", { kind: "reference", title: "Speed ramp workflow (Resolve)", link: "https://www.youtube.com/watch?v=c4YOJQwFopw", tags: ["resolve", "speed-ramp", "tutorial"],
        body: "Shoot 50/60 fps. Ctrl+R → Retime curve → add points → ease the curve. Retime process: Optical Flow, Motion estimation: Speed Warp (Studio) for clean frames." }, 220),
      mk("note", { kind: "reference", title: "Product reel shot list (cafés/brands)", tags: ["shot-list", "reels", "clients"],
        body: "1 hero wide, 2 macro textures, 1 pour/steam, 2 hands-in-action, 1 people/laughs, 1 logo/sign, 1 top-down flat lay. 3–5 s each at 50 fps for slow-mo options." }, 280),
      // Clients
      mk("client", { name: "Ananya Kapoor", company: "Kapoor Weddings Studio, Pune", project: "Mehta–Shah wedding: 3-min teaser + 4 reels", status: "active", contact: "ananya@kapoorweddings.example", deadline: addDays(4), rate: 18000, rateUnit: "project", fav: true, tags: ["wedding", "teaser"],
        notes: "Footage on 2 drives (Sony S-Log3). Teaser music approved. Reels in 9:16 after teaser sign-off." }, 4),
      mk("client", { name: "Rohit Verma", company: "Chai Talks Podcast", project: "Monthly: 4 long episodes + 12 shorts", status: "active", contact: "+91 98000 00000", deadline: addDays(2), rate: 25000, rateUnit: "month", tags: ["podcast", "retainer"],
        notes: "3-cam multicam in Premiere. Ep 18 due this week. Shorts with animated captions." }, 10),
      mk("client", { name: "Sneha Iyer", company: "Brew & Bloom Café, Bengaluru", project: "Menu launch reels ×3", status: "review", contact: "sneha@brewbloom.example", deadline: addDays(1), rate: 6000, rateUnit: "video", tags: ["reels", "food"],
        notes: "v2 sent. She wants the logo bigger and a Hindi + English caption version." }, 22),
      mk("client", { name: "Arjun Malhotra", company: "FitWithArjun (YouTube)", project: "Channel trailer + 10 thumbnails", status: "lead", contact: "arjun@fitwitharjun.example", deadline: addDays(12), rate: 12000, rateUnit: "project", tags: ["youtube", "fitness"],
        notes: "Sent quote on call. Follow up Friday. Wants speed ramps & punchy SFX." }, 36),
      mk("client", { name: "Priya Nair", company: "Nair Realty, Kochi", project: "Property walkthroughs ×5", status: "delivered", contact: "+91 97000 00000", deadline: addDays(-6), rate: 4500, rateUnit: "video", tags: ["real-estate"],
        notes: "Delivered. Balance ₹11,250 received. Ask for a testimonial." }, 150),
      mk("client", { name: "Karan Desai", company: "Urban Threads (D2C fashion)", project: "Festive ad 30 s + 15 s cutdowns", status: "paused", contact: "karan@urbanthreads.example", deadline: addDays(18), rate: 22000, rateUnit: "project", tags: ["ad", "fashion"],
        notes: "Paused until their shoot is rescheduled. Advance ₹11,000 received." }, 240)
    ].concat(seedV3());
  }

  function monthsAgoDay(m, day) { var d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - m); var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); return ymd(d); }
  function seedV3() {
    var t = Date.now(), n = 0;
    function mk(type, o) { var ts = new Date(t - (++n) * 60000).toISOString(); return Object.assign({ id: "s3-" + type + "-" + n + "-" + uid(), type: type, tags: [], fav: false, sample: true, createdAt: ts, updatedAt: ts }, o); }
    var today = new Date().getDate();
    function thisMonth(day) { return monthsAgoDay(0, Math.min(day, today)); }
    return [
      // Paisa — income
      mk("income", { source: "Rohit Verma", amount: 25000, date: thisMonth(3), mode: "upi", status: "paid", note: "Chai Talks — monthly retainer" }),
      mk("income", { source: "Ananya Kapoor", amount: 9000, date: thisMonth(5), mode: "bank", status: "paid", note: "Wedding teaser — 50% advance" }),
      mk("income", { source: "Ananya Kapoor", amount: 9000, date: addDays(4), mode: "upi", status: "pending", note: "Balance on teaser delivery" }),
      mk("income", { source: "Sneha Iyer", amount: 18000, date: addDays(1), mode: "upi", status: "pending", note: "3 menu reels × ₹6,000" }),
      mk("income", { source: "Rohit Verma", amount: 25000, date: monthsAgoDay(1, 3), mode: "upi", status: "paid", note: "Retainer" }),
      mk("income", { source: "Priya Nair", amount: 22500, date: monthsAgoDay(1, 14), mode: "bank", status: "paid", note: "Property walkthroughs ×5" }),
      mk("income", { source: "Rohit Verma", amount: 25000, date: monthsAgoDay(2, 3), mode: "upi", status: "paid", note: "Retainer" }),
      mk("income", { source: "Karan Desai", amount: 11000, date: monthsAgoDay(2, 20), mode: "bank", status: "paid", note: "Festive ad — advance" }),
      mk("income", { source: "Rohit Verma", amount: 25000, date: monthsAgoDay(3, 3), mode: "upi", status: "paid", note: "Retainer" }),
      mk("income", { source: "YouTube AdSense", amount: 3200, date: monthsAgoDay(3, 21), mode: "bank", status: "paid", note: "BHAvFY channel" }),
      // Paisa — kharcha
      mk("expense", { title: "Premiere Pro (Creative Cloud)", amount: 1675, date: thisMonth(2), category: "software", note: "Monthly plan" }),
      mk("expense", { title: "Jio Fiber", amount: 999, date: thisMonth(4), category: "internet", note: "" }),
      mk("expense", { title: "SanDisk 1TB SSD", amount: 6499, date: thisMonth(6), category: "gear", note: "Project drive" }),
      mk("expense", { title: "Client meeting chai + snacks", amount: 340, date: thisMonth(7), category: "food", note: "" }),
      mk("expense", { title: "Premiere Pro (Creative Cloud)", amount: 1675, date: monthsAgoDay(1, 2), category: "software", note: "" }),
      mk("expense", { title: "Uber to wedding shoot", amount: 820, date: monthsAgoDay(1, 18), category: "travel", note: "" }),
      mk("expense", { title: "Artlist music (yearly ÷ 12)", amount: 1350, date: monthsAgoDay(2, 9), category: "software", note: "" }),
      // Content calendar
      mk("post", { title: "Raw vs graded — 15 s before/after", date: addDays(0), platform: "reel", status: "edit", hook: "Ye footage phone se nahi, LOG se hai — dekho grade ke baad 👀",
        script: "0–2s: raw LOG clip, text \"RAW\"\n2–4s: wipe to graded, text \"GRADED\"\n4–12s: 3 more before/after pairs, beat-synced\n12–15s: CTA — \"Kaunsa better? Comment karo\"", caption: "Raw vs graded 🎨 Ek hi clip, do duniya. Kaunsa pasand aaya?", hashtags: "#colorgrading #davinciresolve #videoediting #beforeafter #bhavfy" }),
      mk("post", { title: "3 Premiere shortcuts jo time bachate hain", date: addDays(2), platform: "shorts", status: "script", hook: "Premiere mein ye 3 shortcuts nahi jaante toh ghanta waste ho raha hai",
        script: "1. Ripple delete (Shift+Delete)\n2. Q / W ripple trim\n3. Ctrl+D default transition\nEnd: Follow for part 2", caption: "Save karo, kaam aayega 💾", hashtags: "#premierepro #editingtips #shorts #bhavfy" }),
      mk("post", { title: "Wedding teaser BTS carousel", date: addDays(5), platform: "reel", status: "shoot", hook: "1 shaadi, 6 camera, 3 minute ka teaser — aise bana", caption: "", hashtags: "#weddingfilm #bts #videoeditor" }),
      mk("post", { title: "Phone se ₹20-30k kaise kamaye (eBook)", date: addDays(-2), platform: "reel", status: "posted", hook: "Ghar baithe ₹20-30 hazaar mahina? Sirf phone se?", caption: "eBook link pinned comment mein 📘", hashtags: "#earnmoneyonline #workfromhome #bhavfy" }),
      mk("post", { title: "Editing setup tour (YouTube)", date: addDays(9), platform: "yt", status: "idea", hook: "₹50k ke andar full editing setup", notes: "Show SSD, monitor calibration, mic" })
    ];
  }


  /* ---------------- UI state ---------------- */
  var ui = { route: "dashboard", filters: {}, captureMode: "note" };
  function filt(route) {
    if (!ui.filters[route]) ui.filters[route] = { q: "", opt: "all", fav: false, sort: route === "clients" ? "deadline" : "recent", type: "all" };
    return ui.filters[route];
  }

  /* ---------------- router ---------------- */
  var ROUTES = ["dashboard", "notes", "calendar", "paisa", "ai", "youtube", "clients", "favorites", "settings", "history", "books"];
  var VIEWS = {}; // routes provided by feature modules (paisa.js, calendar.js, ai.js)
  function currentRoute() { var r = (location.hash || "").replace(/^#\/?/, "").split("?")[0]; if (r === "ideas" || r === "lab") return "notes"; return ROUTES.indexOf(r) > -1 ? r : "dashboard"; }
  function render() {
    ui.route = currentRoute();
    var v = $("#view");
    var r = ui.route;
    document.body.setAttribute("data-route", r);
    if (VIEWS[r]) v.innerHTML = VIEWS[r].render();
    else if (r === "dashboard") v.innerHTML = viewDashboard();
    else if (r === "settings") v.innerHTML = viewSettings();
    else if (r === "favorites") v.innerHTML = viewList("favorites");
    else v.innerHTML = viewList(r);
    $$("[data-route]").forEach(function (a) { if (a.getAttribute("data-route") === r) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    var titles = { dashboard: "Bhavnote", notes: "Notes", calendar: "Content Calendar", paisa: "Paisa", ai: "Bhav AI", history: "History", books: "Books", youtube: "YouTube Store", clients: "Clients", favorites: "Favorites", settings: "Settings" };
    $("#topTitle").textContent = titles[r];
    document.title = (r === "dashboard" ? "Bhavnote · Studio notebook" : titles[r] + " · Bhavnote");
    updateCounts();
    afterRender(r);
    if (VIEWS[r] && VIEWS[r].after) VIEWS[r].after();
  }
  function updateCounts() {
    var c = counts();
    $$("[data-count]").forEach(function (el) { var k = el.getAttribute("data-count"); el.textContent = c[k] != null ? c[k] : ""; });
    $("#sideStudio").textContent = db.settings.studioName || "Studio notebook";
  }
  function counts() {
    var c = { note: 0, video: 0, client: 0, fav: 0 };
    db.items.forEach(function (it) { if (c[it.type] != null) c[it.type]++; if (it.fav) c.fav++; });
    return c;
  }

  /* ---------------- dashboard ---------------- */
  function greeting() { var h = new Date().getHours(); return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }
  function viewDashboard() {
    var c = counts();
    var name = db.settings.displayName ? ", <em>" + esc(db.settings.displayName) + "</em>" : "";
    var date = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
    var modes = [["note", "Note"], ["video", "YouTube link"]];
    var h = '<section class="hero" aria-labelledby="greet">' +
      '<p class="date">' + esc(date) + '</p>' +
      '<h1 id="greet">' + greeting() + name + '</h1>' +
      (db.settings.studioName ? '<p class="studio">' + esc(db.settings.studioName) + ' · your private studio notebook</p>' : '<p class="studio">Your private studio notebook</p>') +
      '<form class="capture" id="captureForm" autocomplete="off">' +
      '<div class="capture-modes" role="group" aria-label="Capture as">' +
      modes.map(function (m) { return '<button type="button" class="chip" data-capture="' + m[0] + '" aria-pressed="' + (ui.captureMode === m[0]) + '">' + m[1] + "</button>"; }).join("") +
      '</div><div class="capture-row"><label class="sr-only" for="captureInput">Quick capture</label>' +
      '<input class="input" id="captureInput" placeholder="' + capturePlaceholder() + '" enterkeyhint="done">' +
      '<button class="btn btn-primary" type="submit" aria-label="Save capture">' + icon("i-arrow") + '</button></div>' +
      '</form></section>';
    h += todayPlan();
    h += '<div id="reportSlot"></div>';
    var stats = [["client", "Clients", "#/clients", "i-users"], ["video", "Videos", "#/youtube", "i-play"], ["note", "Notes", "#/notes", "i-note"], ["fav", "Starred", "#/favorites", "i-star"]];
    h += '<div class="more-links"><a class="more-link" href="#/books">' + icon("i-book") + '<span><b>Books</b><small>PDF → Hinglish</small></span></a><a class="more-link" href="#/history">' + icon("i-history") + '<span><b>History</b><small>Sab kuch, trash, AI chats</small></span></a></div>';
    h += '<div class="stats">' + stats.map(function (s) { return '<a class="stat t-' + s[0] + '" href="' + s[2] + '">' + icon(s[3]) + '<span class="num">' + c[s[0]] + '</span><span class="lbl">' + s[1] + "</span></a>"; }).join("") + "</div>";
    var recent = db.items.slice().sort(function (a, b) { return b.updatedAt < a.updatedAt ? -1 : 1; }).slice(0, 7);
    var due = db.items.filter(function (it) { return it.type === "client" && it.deadline && ["lead", "active", "review"].indexOf(it.status) > -1; })
      .sort(function (a, b) { return a.deadline < b.deadline ? -1 : 1; }).slice(0, 4);
    h += '<div class="dash-cols"><section aria-labelledby="recentH"><div class="section-label"><h2 id="recentH">Recent</h2></div>';
    h += recent.length ? '<div class="list">' + recent.map(function (it) { return listItem(it, false); }).join("") + "</div>" : emptyBox("Nothing here yet", "Capture your first note above.", null);
    h += '</section><section aria-labelledby="dueH"><div class="section-label"><h2 id="dueH">Upcoming deadlines</h2><a href="#/clients">All clients</a></div>';
    h += due.length ? '<div class="list">' + due.map(function (it) { return listItem(it, true); }).join("") + "</div>" : emptyBox("No open deadlines", "Client jobs with a deadline show up here.", null);
    h += "</section></div>";
    return h;
  }

  function waLink(phone, text) { return "https://wa.me/" + (phone || "") + "?text=" + encodeURIComponent(text); }
  function todayPlan() {
    var today = ymd(new Date());
    var posts = db.items.filter(function (it) { return it.type === "post" && it.date === today && it.status !== "posted"; });
    var late = db.items.filter(function (it) { return it.type === "post" && it.date && it.date < today && it.status !== "posted"; }).length;
    var due = db.items.filter(function (it) { if (it.type !== "client" || !it.deadline || ["lead", "active", "review"].indexOf(it.status) < 0) return false; var d = daysUntil(it.deadline); return d !== null && d <= 2; })
      .sort(function (a, b) { return a.deadline < b.deadline ? -1 : 1; });
    var pend = db.items.filter(function (it) { return it.type === "income" && it.status === "pending" && (!it.date || daysUntil(it.date) <= 3); })
      .sort(function (a, b) { return (a.date || "") < (b.date || "") ? -1 : 1; });
    var h = '<section class="panel plan" aria-labelledby="planH"><div class="plan-head"><h2 id="planH">Aaj ka plan</h2><a href="#/calendar">Calendar</a></div>';
    if (!posts.length && !due.length && !pend.length) h += '<p class="plan-empty">Aaj sab clear hai ✨ Koi post, deadline ya payment pending nahi.</p>';
    if (posts.length) {
      h += '<div class="plan-group"><p class="plan-label">' + icon("i-cal") + "Aaj post karna hai</p>";
      posts.forEach(function (p) { h += '<button type="button" class="plan-row" data-open="' + esc(p.id) + '"><span class="dot st-' + esc(p.status) + '"></span><span class="pr-main">' + esc(p.title) + '</span><span class="pr-side">' + esc(PLATFORM_LABEL[p.platform] || "") + " · " + esc(cap(p.status)) + "</span></button>"; });
      h += "</div>";
    }
    if (late) h += '<p class="plan-note">' + late + " purane plan abhi tak post nahi hue — <a href=\"#/calendar\">dekho</a></p>";
    if (due.length) {
      h += '<div class="plan-group"><p class="plan-label">' + icon("i-clock") + "Deadlines</p>";
      due.forEach(function (c) { h += '<button type="button" class="plan-row" data-open="' + esc(c.id) + '"><span class="pr-main">' + esc(c.name) + (c.project ? " · " + esc(c.project) : "") + '</span><span class="pr-side ' + (daysUntil(c.deadline) <= 0 ? "late" : "") + '">' + esc(daysText(c.deadline)) + "</span></button>"; });
      h += "</div>";
    }
    if (pend.length) {
      h += '<div class="plan-group"><p class="plan-label">' + icon("i-rupee") + "Payment aana baaki</p>";
      pend.slice(0, 4).forEach(function (p) {
        var c = findClient(p.source); var link = waLink(phoneOf(c), reminderText(p.source, p.amount, p.note));
        h += '<div class="plan-row static"><button type="button" class="pr-main as-link" data-open="' + esc(p.id) + '">' + esc(p.source) + " · <b>" + esc(INR.format(+p.amount || 0)) + "</b></button>" +
          '<a class="mini-btn" href="' + esc(link) + '" target="_blank" rel="noopener">' + icon("i-chat") + "Remind</a></div>";
      });
      h += "</div>";
    }
    return h + "</section>";
  }
  function capturePlaceholder() {
    return { note: "Jot a note… press Enter to save", video: "Paste a YouTube link…" }[ui.captureMode] || "Jot a note… press Enter to save";
  }
  function listItem(it, deadline) {
    var T = TYPES[it.type]; var sub;
    if (deadline) sub = (it.project || it.company || "") + " · " + (daysText(it.deadline));
    else sub = T.one + (it[T.opt] ? " · " + cap(it[T.opt]) : "") + " · " + ago(it.updatedAt);
    return '<button type="button" class="list-item" data-open="' + esc(it.id) + '">' +
      '<span class="li-icon t-' + it.type + '">' + icon(T.icon) + '</span>' +
      '<span class="li-main"><span class="li-title">' + esc(titleOf(it)) + '</span><span class="li-sub">' + esc(sub) + "</span></span>" +
      (it.fav ? '<span class="li-fav" role="img" aria-label="Favorite">' + icon("i-star") + "</span>" : "") +
      "</button>";
  }
  function daysText(s) { var d = daysUntil(s); if (d === null) return ""; if (d < 0) return "overdue " + (-d) + "d"; if (d === 0) return "due today"; if (d === 1) return "due tomorrow"; return "due in " + d + " days"; }

  /* ---------------- list views ---------------- */
  function viewList(route) {
    var f = filt(route);
    var type = ROUTE_TYPE[route];
    var T = type ? TYPES[type] : null;
    var all = route === "favorites" ? db.items.filter(function (i) { return i.fav; }) : db.items.filter(function (i) { return i.type === type; });
    var title = route === "favorites" ? "Favorites" : T.label;
    var sub = {
      notes: "Ideas, techniques, styles and references, all in one place.",
      youtube: "Tutorials, references and inspiration worth rewatching.",
      clients: "Jobs, deadlines and rates in one place.",
      favorites: "Everything you starred, across all sections."
    }[route];
    var h = '<div class="page-head"><div><h1>' + esc(title) + '</h1><p class="sub">' + esc(sub) + "</p></div>" +
      (T ? '<button class="btn btn-primary" type="button" data-new="' + type + '">' + icon("i-plus") + "New " + esc(T.one.toLowerCase()) + "</button>" : "") + "</div>";
    // toolbar
    var chipsHtml;
    if (route === "favorites") {
      chipsHtml = '<button class="chip" type="button" data-ftype="all" aria-pressed="' + (f.type === "all") + '">All <span class="n">' + all.length + "</span></button>" +
        ORDER.map(function (t) { var n = all.filter(function (i) { return i.type === t; }).length; return '<button class="chip" type="button" data-ftype="' + t + '" aria-pressed="' + (f.type === t) + '">' + TYPES[t].label + ' <span class="n">' + n + "</span></button>"; }).join("");
    } else {
      chipsHtml = '<button class="chip" type="button" data-fopt="all" aria-pressed="' + (f.opt === "all") + '">All <span class="n">' + all.length + "</span></button>" +
        T.opts.map(function (o) { var n = all.filter(function (i) { return optOf(i) === o; }).length; return '<button class="chip" type="button" data-fopt="' + o + '" aria-pressed="' + (f.opt === o) + '">' + o + ' <span class="n">' + n + "</span></button>"; }).join("") +
        '<button class="chip star" type="button" data-ffav aria-pressed="' + f.fav + '">' + icon("i-star") + "Starred</button>";
    }
    var sorts = [["recent", "Recent"], ["az", "A–Z"]]; if (route === "clients") sorts.unshift(["deadline", "Deadline"]);
    h += '<div class="toolbar"><div class="toolbar-row"><div class="filter-search">' + icon("i-search") +
      '<label class="sr-only" for="fq">Filter ' + esc(title) + '</label><input class="input" id="fq" type="search" placeholder="Filter ' + esc(route === "youtube" ? title : title.toLowerCase()) + '…" value="' + esc(f.q) + '"></div>' +
      '<label class="sr-only" for="fsort">Sort</label><select class="select" id="fsort">' + sorts.map(function (s) { return '<option value="' + s[0] + '"' + (f.sort === s[0] ? " selected" : "") + ">" + s[1] + "</option>"; }).join("") + "</select></div>" +
      '<div class="chips" role="group" aria-label="Filters">' + chipsHtml + "</div></div>";
    h += '<div id="results">' + resultsHtml(route) + "</div>";
    return h;
  }
  function optOf(it) { return it[TYPES[it.type].opt]; }
  function filtered(route) {
    var f = filt(route); var type = ROUTE_TYPE[route];
    var arr = route === "favorites" ? db.items.filter(function (i) { return i.fav; }) : db.items.filter(function (i) { return i.type === type; });
    if (route === "favorites" && f.type !== "all") arr = arr.filter(function (i) { return i.type === f.type; });
    if (route !== "favorites" && f.opt !== "all") arr = arr.filter(function (i) { return optOf(i) === f.opt; });
    if (f.fav) arr = arr.filter(function (i) { return i.fav; });
    if (f.q) { var q = f.q.toLowerCase(); arr = arr.filter(function (i) { return haystack(i).indexOf(q) > -1; }); }
    arr = arr.slice();
    if (f.sort === "az") arr.sort(function (a, b) { return titleOf(a).localeCompare(titleOf(b)); });
    else if (f.sort === "deadline") arr.sort(function (a, b) {
      var ao = ["lead", "active", "review"].indexOf(a.status) > -1 ? 0 : 1, bo = ["lead", "active", "review"].indexOf(b.status) > -1 ? 0 : 1;
      if (ao !== bo) return ao - bo; return (a.deadline || "9999") < (b.deadline || "9999") ? -1 : 1;
    });
    else arr.sort(function (a, b) { return b.updatedAt < a.updatedAt ? -1 : 1; });
    return arr;
  }
  function resultsHtml(route) {
    var arr = filtered(route); var f = filt(route); var type = ROUTE_TYPE[route];
    if (!arr.length) {
      var any = f.q || f.opt !== "all" || f.fav || f.type !== "all";
      if (any) return emptyBox("No matches", "Try another filter or clear the search.", null);
      if (route === "favorites") return emptyBox("No favorites yet", "Tap the ☆ on anything to keep it here.", null);
      return emptyBox("No " + TYPES[type].label.toLowerCase() + " yet", "Create your first one.", type);
    }
    return '<div class="grid">' + arr.map(card).join("") + "</div>";
  }
  function emptyBox(t, p, type) {
    return '<div class="empty"><h3>' + esc(t) + "</h3><p>" + esc(p) + "</p>" + (type ? '<button class="btn btn-primary" type="button" data-new="' + type + '">' + icon("i-plus") + "New " + esc(TYPES[type].one.toLowerCase()) + "</button>" : "") + "</div>";
  }
  function card(it) {
    var T = TYPES[it.type]; var h = '<article class="card" aria-label="' + esc(T.one + ": " + titleOf(it)) + '">';
    if (it.type === "video") {
      var id = ytId(it.url);
      h += '<div class="thumb">' + (id ? '<img loading="lazy" decoding="async" width="320" height="180" alt="" src="https://img.youtube.com/vi/' + id + '/mqdefault.jpg" onerror="this.remove()">' : "") +
        '<div class="ph" aria-hidden="true">' + icon("i-play") + "</div>" + (id ? "" : "") +
        '<span class="play">' + icon("i-play") + esc(it.category || "video") + "</span></div>";
    }
    h += '<div class="card-top">';
    if (ui.route === "favorites") h += '<span class="badge t-' + it.type + '">' + esc(T.one) + "</span>";
    if (it.type !== "video" && it[T.opt]) {
      var cls = it.type === "client" ? "s-" + it.status : "t-" + it.type;
      h += '<span class="badge ' + cls + '">' + esc(it[T.opt]) + "</span>";
    }
    if (it.type === "client") { h += dueBadge(it); var pend = clientPending(it.name).sum; if (pend) h += '<span class="badge plain due-soon">' + icon("i-rupee") + INR.format(pend) + " pending</span>"; }
    h += "</div>";
    h += '<h3><button type="button" data-open="' + esc(it.id) + '">' + esc(titleOf(it)) + "</button></h3>";
    if (it.type === "client") {
      h += '<div class="client-line">' + (it.company ? "<span><b>" + esc(it.company) + "</b></span>" : "") + (it.rate !== "" && it.rate != null ? '<span class="rate">' + esc(fmtRate(it)) + "</span>" : "") + "</div>";
      if (it.project) h += '<p class="excerpt">' + esc(it.project) + "</p>";
    } else if (it.type === "video") {
      if (it.channel || it.notes) h += '<p class="excerpt">' + esc([it.channel, it.notes].filter(Boolean).join(" — ")) + "</p>";
    } else if (it.type === "post") {
      h += '<p class="excerpt">' + esc([PLATFORM_LABEL[it.platform], it.date ? fmtDate(it.date) : "", it.hook].filter(Boolean).join(" · ")) + "</p>";
    } else if (it.body) h += '<p class="excerpt">' + esc(it.body) + "</p>";
    if (it.tags && it.tags.length) h += '<div class="tags">' + it.tags.slice(0, 5).map(function (t) { return '<span class="tag">#' + esc(t) + "</span>"; }).join("") + "</div>";
    h += '<div class="card-foot"><span class="meta">' + (it.type === "client" && it.contact ? esc(it.contact) : "Updated " + esc(ago(it.updatedAt))) + "</span>";
    var link = it.type === "video" ? safeUrl(it.url) : it.type === "note" ? safeUrl(it.link) : "";
    if (link) h += '<a class="link-btn" href="' + esc(link) + '" target="_blank" rel="noopener">' + icon("i-ext") + (it.type === "video" ? "Watch" : "Open") + '<span class="sr-only"> ' + esc(titleOf(it)) + " (opens in new tab)</span></a>";
    h += '<button type="button" class="fav-btn" data-fav="' + esc(it.id) + '" aria-pressed="' + !!it.fav + '" aria-label="' + (it.fav ? "Remove from favorites" : "Add to favorites") + '">' + icon("i-star") + "</button>";
    h += "</div></article>";
    return h;
  }
  function refreshResults() { var r = $("#results"); if (r) r.innerHTML = resultsHtml(ui.route); }

  /* ---------------- settings ---------------- */
  function viewSettings() {
    var c = counts(); var samples = db.items.filter(function (i) { return i.sample; }).length;
    var size = 0; try { size = (localStorage.getItem(KEY) || "").length; } catch (e) {}
    var h = '<div class="page-head"><div><h1>Settings</h1><p class="sub">Everything stays on this device. No account, no cloud.</p></div></div><div class="settings-grid"><div>';
    h += '<section class="panel" aria-labelledby="pH"><h2 id="pH">Profile</h2>' +
      '<div class="field"><label for="sName">Display name</label><input class="input" id="sName" maxlength="40" value="' + esc(db.settings.displayName) + '" placeholder="Your name"></div>' +
      '<div class="field"><label for="sStudio">Studio name</label><input class="input" id="sStudio" maxlength="60" value="' + esc(db.settings.studioName) + '" placeholder="Your studio"></div>' +
      '<span class="saved-note" id="savedNote" aria-live="polite">Saved</span></section>';
    h += '<section class="panel" aria-labelledby="iH"><h2 id="iH">Install on your phone</h2>' +
      '<p>Open this page in Chrome on Android, tap <b>⋮</b> → <b>Add to Home screen</b> (or <b>Install app</b>). Bhavnote then opens full-screen from its own icon and works offline.</p>' +
      '<div class="actions"><button class="btn" type="button" id="installBtn" hidden>' + icon("i-phone") + "Install Bhavnote</button></div></section>";
    h += '</div><div><section class="panel" aria-labelledby="dH"><h2 id="dH">Your data</h2>' +
      '<div class="kv"><div><b>' + db.items.length + '</b><span>entries</span></div><div><b>' + c.fav + '</b><span>favorites</span></div><div><b>' + Math.max(1, Math.round(size / 1024)) + ' KB</b><span>on device</span></div></div>' +
      '<p>Make a backup now and then — clearing the browser or changing phones removes local data.</p>' +
      '<div class="actions"><button class="btn" type="button" id="exportBtn">' + icon("i-download") + 'Export backup (JSON)</button>' +
      '<button class="btn" type="button" id="importBtn">' + icon("i-upload") + 'Import backup</button>' +
      '<input type="file" id="importFile" accept="application/json,.json" hidden></div></section>';
    h += '<div id="aiSettingsSlot"></div>';
    h += '<section class="panel" aria-labelledby="sH"><h2 id="sH">Sample data</h2>' +
      '<p>' + (samples ? samples + " sample entries are still here. Removing them keeps everything you created — and any sample you edited." : "No sample entries left. Your own entries are all that's here.") + "</p>" +
      '<div class="actions"><button class="btn btn-danger" type="button" id="removeSamples"' + (samples ? "" : " disabled") + ">" + icon("i-trash") + "Remove sample data</button></div></section>";
    h += '<p class="hint" style="padding:0 4px">Bhavnote v2 · data key “' + KEY + '” in this browser</p></div></div>';
    return h;
  }
  function exportData() {
    var data = { app: "bhavnote", schema: SCHEMA, exportedAt: now(), settings: db.settings, items: db.items };
    var json = JSON.stringify(data, null, 2), fname = "bhavnote-backup-" + ymd(new Date()) + ".json";
    if (window.BhavnoteAndroid && window.BhavnoteAndroid.saveFile) {
      try { var where = window.BhavnoteAndroid.saveFile(fname, json); toast(where ? "Backup saved to " + where : "Backup saved"); } catch (e) { toast("Couldn't save the backup file."); }
      return;
    }
    var blob = new Blob([json], { type: "application/json" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fname;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast("Backup downloaded — " + db.items.length + " entries");
  }
  function importData(file) {
    var r = new FileReader();
    r.onload = function () {
      var data; try { data = JSON.parse(r.result); } catch (e) { toast("That file isn't valid JSON."); return; }
      var items = data && (Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : null);
      if (!items) { toast("That doesn't look like a Bhavnote backup."); return; }
      items = migrateItems(items).filter(function (i) { return i && TYPES[i.type]; }).map(clean);
      confirmBox("Import " + items.length + " entries?", "Merge adds them to what's here (newer copy wins for the same entry). Replace deletes everything currently on this device first.",
        [{ label: "Cancel", value: null }, { label: "Replace all", value: "replace", cls: "btn-danger" }, { label: "Merge", value: "merge", cls: "btn-primary" }]).then(function (mode) {
        if (!mode) return;
        if (mode === "replace") { db.items = items; if (data.settings) db.settings = Object.assign({}, db.settings, pickSettings(data.settings)); }
        else {
          var map = {}; db.items.forEach(function (i) { map[i.id] = i; });
          items.forEach(function (i) { var ex = map[i.id]; if (!ex) db.items.push(i); else if ((i.updatedAt || "") > (ex.updatedAt || "")) Object.assign(ex, i); });
        }
        quietly(save); logEvent("import", "settings", (mode === "replace" ? "Backup se replace kiya: " : "Backup merge kiya: ") + items.length + " entries"); render(); toast((mode === "replace" ? "Replaced with " : "Merged ") + items.length + " entries");
      });
    };
    r.readAsText(file);
  }
  function pickSettings(s) { return { displayName: String(s.displayName || "").slice(0, 40), studioName: String(s.studioName || "").slice(0, 60) }; }
  function clean(i) {
    var o = Object.assign({}, i);
    o.id = String(o.id || uid()); o.tags = Array.isArray(o.tags) ? o.tags.map(String) : parseTags(o.tags);
    o.fav = !!o.fav; o.createdAt = o.createdAt || now(); o.updatedAt = o.updatedAt || o.createdAt;
    return o;
  }

  /* ---------------- editor ---------------- */
  var editing = null; // {type, id}
  function fieldsFor(type, it) {
    var T = TYPES[type]; var v = function (k) { return esc(it[k] == null ? "" : it[k]); };
    var opt = '<div class="field"><label for="f_opt">' + cap(T.opt) + '</label><select class="select" id="f_opt" name="' + T.opt + '">' +
      T.opts.map(function (o) { return '<option value="' + o + '"' + (it[T.opt] === o ? " selected" : "") + ">" + cap(o) + "</option>"; }).join("") + "</select></div>";
    var tags = '<div class="field"><label for="f_tags">Tags</label><input class="input" id="f_tags" name="tags" value="' + esc((it.tags || []).join(", ")) + '" placeholder="premiere, color, delivery"><p class="hint">Separate with commas</p></div>';
    var fav = '<label class="switch-row" for="f_fav"><span>' + icon("i-star") + 'Favorite</span><input class="switch" type="checkbox" role="switch" id="f_fav" name="fav"' + (it.fav ? " checked" : "") + "></label>";
    var h = "";
    var copyBtn = function (sel) { return '<button type="button" class="mini-btn" data-copy="' + sel + '">' + icon("i-copy") + "Copy</button>"; };
    if (type === "post") {
      h += '<div class="field"><label for="f_title">Title</label><input class="input" id="f_title" name="title" required value="' + v("title") + '" placeholder="Video ka naam"></div>';
      h += '<div class="row2"><div class="field"><label for="f_date">Date</label><input class="input" type="date" id="f_date" name="date" value="' + v("date") + '"></div>' +
        '<div class="field"><label for="f_platform">Platform</label><select class="select" id="f_platform" name="platform">' + PLATFORMS.map(function (p) { return '<option value="' + p + '"' + (it.platform === p ? " selected" : "") + ">" + PLATFORM_LABEL[p] + "</option>"; }).join("") + "</select></div></div>";
      h += opt;
      h += '<div class="field"><label for="f_hook">Hook</label><input class="input" id="f_hook" name="hook" value="' + v("hook") + '" placeholder="Pehle 2 second ki line"></div>';
      h += '<div class="field"><div class="label-row"><label for="f_script">Script</label>' + copyBtn("#f_script") + '</div><textarea class="textarea big" id="f_script" name="script" placeholder="Poori script yahan paste karo…">' + v("script") + "</textarea></div>";
      h += '<div class="field"><div class="label-row"><label for="f_caption">Caption</label>' + copyBtn("#f_caption") + '</div><textarea class="textarea" id="f_caption" name="caption" style="min-height:90px">' + v("caption") + "</textarea></div>";
      h += '<div class="field"><div class="label-row"><label for="f_hashtags">Hashtags</label>' + copyBtn("#f_hashtags") + '</div><input class="input" id="f_hashtags" name="hashtags" value="' + v("hashtags") + '" placeholder="#reels #editing"></div>';
      h += '<div class="field"><label for="f_notes">Notes</label><textarea class="textarea" id="f_notes" name="notes" style="min-height:80px">' + v("notes") + "</textarea></div>";
      return h + fav;
    }
    if (type === "income") {
      var names = db.items.filter(function (x) { return x.type === "client"; }).map(function (x) { return x.name; });
      h += '<div class="field"><label for="f_title">Client / source</label><input class="input" id="f_title" name="source" required list="dl_clients" value="' + v("source") + '" placeholder="Client ka naam ya source"><datalist id="dl_clients">' + names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist></div>";
      h += '<div class="row2"><div class="field"><label for="f_amount">Amount (₹)</label><input class="input" id="f_amount" name="amount" inputmode="numeric" value="' + v("amount") + '" placeholder="5000"></div>' +
        '<div class="field"><label for="f_date">Date</label><input class="input" type="date" id="f_date" name="date" value="' + esc(it.date || ymd(new Date())) + '"></div></div>';
      h += '<div class="row2"><div class="field"><label for="f_mode">Mode</label><select class="select" id="f_mode" name="mode">' + PAY_MODES.map(function (m) { return '<option value="' + m + '"' + (it.mode === m ? " selected" : "") + ">" + m.toUpperCase() + "</option>"; }).join("") + "</select></div>" + opt + "</div>";
      h += '<div class="field"><label for="f_note">Note</label><input class="input" id="f_note" name="note" value="' + v("note") + '" placeholder="Kis kaam ka payment"></div>';
      return h;
    }
    if (type === "expense") {
      var cats = TYPES.expense.opts.slice(); db.items.forEach(function (x) { if (x.type === "expense" && x.category && cats.indexOf(x.category) < 0) cats.push(x.category); });
      h += '<div class="field"><label for="f_title">Kya liya / kis cheez pe</label><input class="input" id="f_title" name="title" value="' + v("title") + '" placeholder="Premiere subscription, SSD…"></div>';
      h += '<div class="row2"><div class="field"><label for="f_amount">Amount (₹)</label><input class="input" id="f_amount" name="amount" inputmode="numeric" required value="' + v("amount") + '" placeholder="999"></div>' +
        '<div class="field"><label for="f_date">Date</label><input class="input" type="date" id="f_date" name="date" value="' + esc(it.date || ymd(new Date())) + '"></div></div>';
      h += '<div class="field"><label for="f_cat">Category</label><input class="input" id="f_cat" name="category" list="dl_cats" value="' + v("category") + '" placeholder="software, gear… ya apna likho"><datalist id="dl_cats">' + cats.map(function (c) { return '<option value="' + esc(c) + '">'; }).join("") + "</datalist></div>";
      h += '<div class="field"><label for="f_note">Note</label><input class="input" id="f_note" name="note" value="' + v("note") + '"></div>';
      return h;
    }
    if (type === "client") {
      h += '<div class="field"><label for="f_title">Name</label><input class="input" id="f_title" name="name" required value="' + v("name") + '" placeholder="Client name"></div>';
      h += '<div class="row2"><div class="field"><label for="f_company">Company</label><input class="input" id="f_company" name="company" value="' + v("company") + '"></div>' + opt + "</div>";
      h += '<div class="field"><label for="f_project">Project</label><input class="input" id="f_project" name="project" value="' + v("project") + '" placeholder="e.g. Wedding teaser + 4 reels"></div>';
      h += '<div class="field"><label for="f_contact">Contact</label><input class="input" id="f_contact" name="contact" value="' + v("contact") + '" placeholder="Phone or email"></div>';
      h += '<div class="row2"><div class="field"><label for="f_deadline">Deadline</label><input class="input" type="date" id="f_deadline" name="deadline" value="' + v("deadline") + '"></div>' +
        '<div class="field"><label for="f_rate">Rate (₹)</label><input class="input" id="f_rate" name="rate" inputmode="numeric" value="' + v("rate") + '" placeholder="15000"></div></div>';
      h += '<div class="field"><label for="f_unit">Rate per</label><select class="select" id="f_unit" name="rateUnit">' + RATE_UNITS.map(function (u) { return '<option value="' + u + '"' + ((it.rateUnit || "project") === u ? " selected" : "") + ">" + cap(u) + "</option>"; }).join("") + "</select></div>";
      h += '<div class="field"><label for="f_notes">Notes</label><textarea class="textarea" id="f_notes" name="notes" placeholder="Footage, feedback, payments…">' + v("notes") + "</textarea></div>";
    } else if (type === "video") {
      h += '<div class="field"><label for="f_url">YouTube URL</label><input class="input" id="f_url" name="url" type="url" inputmode="url" value="' + v("url") + '" placeholder="https://youtu.be/…"></div>';
      h += '<div class="yt-preview" id="ytPrev" hidden></div>';
      h += '<div class="field"><label for="f_title">Title</label><input class="input" id="f_title" name="title" required value="' + v("title") + '" placeholder="What is this video?"></div>';
      h += '<div class="row2"><div class="field"><label for="f_channel">Channel</label><input class="input" id="f_channel" name="channel" value="' + v("channel") + '"></div>' + opt + "</div>";
      h += '<div class="field"><label for="f_notes">Notes</label><textarea class="textarea" id="f_notes" name="notes" style="min-height:110px" placeholder="Why it\'s worth keeping, timestamps…">' + v("notes") + "</textarea></div>";
    } else {
      h += '<div class="field"><label for="f_title">Title</label><input class="input" id="f_title" name="title" required value="' + v("title") + '" placeholder="Title"></div>';
      h += opt;
      h += '<div class="field"><label for="f_link">Link (optional)</label><input class="input" id="f_link" name="link" type="url" inputmode="url" value="' + v("link") + '" placeholder="Tutorial or reference URL"></div>';
      h += '<div class="field"><label for="f_body">' + "Body" + '</label><textarea class="textarea" id="f_body" name="body" placeholder="Write it down…">' + v("body") + "</textarea></div>";
    }
    return h + tags + fav;
  }
  function openEditor(type, id, preset) {
    var it = id ? byId(id) : null;
    if (id && !it) return;
    type = it ? it.type : type;
    var T = TYPES[type];
    var base = it || Object.assign({ tags: [], fav: false }, preset || {});
    if (!it && !base[T.opt]) base[T.opt] = (type === "client") ? "active" : T.opts[0];
    editing = { type: type, id: it ? it.id : null };
    $("#editorType").textContent = T.one;
    $("#editorTitle").textContent = it ? "Edit " + T.one.toLowerCase() : "New " + T.one.toLowerCase();
    $("#editorFields").innerHTML = fieldsFor(type, base);
    $("#editorDelete").hidden = !it;
    var dlg = $("#editor"); if (!dlg.open) dlg.showModal();
    if (type === "video") { var u = $("#f_url"); u.addEventListener("input", ytPreview); ytPreview(); }
    setTimeout(function () { var f = type === "video" && !base.url ? $("#f_url") : $("#f_title"); if (f && !it && matchMedia("(pointer:fine)").matches) f.focus(); else if (f && !it) f.focus(); }, 30);
  }
  function ytPreview() {
    var u = $("#f_url"); var box = $("#ytPrev"); if (!u || !box) return;
    var id = ytId(u.value);
    if (id) { box.hidden = false; box.innerHTML = '<img alt="Video thumbnail" src="https://img.youtube.com/vi/' + id + '/hqdefault.jpg">'; }
    else { box.hidden = true; box.innerHTML = ""; }
  }
  function saveEditor() {
    if (!editing) return;
    var type = editing.type; var T = TYPES[type]; var form = $("#editorForm");
    var get = function (n) { var el = form.elements[n]; return el ? String(el.value || "").trim() : ""; };
    var titleKey = type === "client" ? "name" : type === "income" ? "source" : "title";
    var title = get(titleKey);
    if (type === "video" && !title && ytId(get("url"))) title = "YouTube video";
    var amt = get("amount").replace(/[₹,\s]/g, "");
    if ((type === "income" || type === "expense") && (amt === "" || isNaN(+amt) || +amt <= 0)) { var af = $("#f_amount"); af.setAttribute("aria-invalid", "true"); af.focus(); toast("Amount daalo (₹)"); return; }
    if (!title && type !== "expense") { var tf = $("#f_title"); tf.setAttribute("aria-invalid", "true"); tf.focus(); toast(type === "client" ? "Add the client's name" : type === "income" ? "Client ya source ka naam daalo" : "Add a title"); return; }
    var o = { tags: parseTags(get("tags")), fav: form.elements.fav ? !!form.elements.fav.checked : false };
    o[titleKey] = title; o[T.opt] = (get(T.opt) || T.opts[0]).toLowerCase();
    if (type === "income" || type === "expense") { o.amount = +amt; o.date = get("date") || ymd(new Date()); o.note = get("note"); if (type === "income") o.mode = get("mode") || "upi"; }
    else if (type === "post") { ["date", "platform", "hook", "script", "caption", "hashtags", "notes"].forEach(function (k) { o[k] = form.elements[k] ? String(form.elements[k].value || "").replace(/\s+$/, "") : ""; }); o.title = title; }
    else if (type === "client") {
      ["company", "project", "contact", "deadline", "notes", "rateUnit"].forEach(function (k) { o[k] = get(k); });
      var rate = get("rate").replace(/[₹,\s]/g, ""); o.rate = rate === "" || isNaN(+rate) ? "" : +rate;
    } else if (type === "video") { o.url = get("url"); o.channel = get("channel"); o.notes = get("notes"); }
    else if (type === "note") { o.body = get("body"); o.link = get("link"); }
    var ts = now();
    if (editing.id) { var it = byId(editing.id); Object.assign(it, o, { updatedAt: ts }); delete it.sample; toast(T.one + " saved"); }
    else { db.items.push(Object.assign({ id: uid(), type: type, createdAt: ts, updatedAt: ts }, o)); toast(T.one + " added"); }
    save(); $("#editor").close(); render();
  }
  function deleteItem(id) {
    var it = byId(id); if (!it) return;
    var idx = db.items.indexOf(it);
    confirmBox("Delete “" + titleOf(it) + "”?", "This removes it from this device.", [{ label: "Cancel", value: null }, { label: "Delete", value: true, cls: "btn-danger" }]).then(function (ok) {
      if (!ok) return;
      db.items.splice(idx, 1); save();
      if ($("#editor").open) $("#editor").close();
      render();
      toast("Deleted", "Undo", function () { db.items.splice(Math.min(idx, db.items.length), 0, it); save(); render(); });
    });
  }
  function toggleFav(id) {
    var it = byId(id); if (!it) return; it.fav = !it.fav; save();
    // update in place: no full list re-render on a star tap
    if (ui.route === "favorites" || (filt(ui.route).fav && ui.route !== "dashboard")) { refreshResults(); return; }
    if (ui.route === "dashboard") { render(); return; }
    $$('[data-fav="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]').forEach(function (b) { b.setAttribute("aria-pressed", it.fav); b.setAttribute("aria-label", it.fav ? "Remove from favorites" : "Add to favorites"); });
  }

  /* ---------------- chooser ---------------- */
  function openChooser() {
    $("#chooserGrid").innerHTML = CREATE_ORDER.map(function (t) { var T = TYPES[t]; return '<button type="button" class="choose t-' + t + '" data-choose="' + t + '">' + icon(T.icon) + "<b>" + esc(T.one) + "</b><small>" + esc(T.hint) + "</small></button>"; }).join("");
    $("#chooser").showModal();
  }

  /* ---------------- confirm ---------------- */
  function confirmBox(title, msg, buttons) {
    return new Promise(function (resolve) {
      var dlg = $("#confirmDlg"); $("#confirmTitle").textContent = title; $("#confirmMsg").textContent = msg;
      var box = $("#confirmActions"); box.innerHTML = "";
      var result = null;
      buttons.forEach(function (b) {
        var el = document.createElement("button"); el.type = "button"; el.className = "btn " + (b.cls || "btn-ghost"); el.textContent = b.label;
        el.addEventListener("click", function () { result = b.value; dlg.close(); });
        box.appendChild(el);
      });
      dlg.addEventListener("close", function on() { dlg.removeEventListener("close", on); resolve(result); });
      dlg.showModal();
      var last = box.lastElementChild; if (last) last.focus();
    });
  }

  /* ---------------- toast ---------------- */
  function toast(msg, action, fn) {
    var wrap = $("#toasts"); var t = document.createElement("div"); t.className = "toast";
    t.innerHTML = "<span>" + esc(msg) + "</span>" + (action ? '<button type="button">' + esc(action) + "</button>" : "");
    if (action) t.querySelector("button").addEventListener("click", function () { fn(); t.remove(); });
    wrap.appendChild(t); while (wrap.children.length > 3) wrap.firstChild.remove();
    setTimeout(function () { t.remove(); }, action ? 6000 : 2600);
  }

  /* ---------------- search ---------------- */
  var sel = 0, hits = [];
  var HS = {};
  function haystack(it) { var k = it.id + "|" + it.updatedAt; if (HS[k]) return HS[k]; return (HS[k] = [titleOf(it), bodyOf(it), it.company, it.channel, it.url, it.contact, it.project, it.notes, it.link, it[TYPES[it.type].opt], (it.tags || []).join(" ")].filter(Boolean).join(" \n ").toLowerCase()); }
  function openSearch() { var d = $("#searchDlg"); if (!d.open) d.showModal(); var i = $("#searchInput"); i.value = ""; runSearch(); i.focus(); }
  function hl(text, q) {
    text = String(text || ""); if (!q) return esc(text);
    var i = text.toLowerCase().indexOf(q); if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + "<mark>" + esc(text.slice(i, i + q.length)) + "</mark>" + esc(text.slice(i + q.length));
  }
  function snippet(it, q) {
    var b = bodyOf(it).replace(/\s+/g, " "); if (!q) return b.slice(0, 90);
    var i = b.toLowerCase().indexOf(q); if (i < 0) return b.slice(0, 90);
    var s = Math.max(0, i - 30); return (s ? "…" : "") + b.slice(s, s + 100);
  }
  function runSearch() {
    var q = $("#searchInput").value.trim().toLowerCase();
    var list = $("#searchResults");
    var items = db.items;
    if (q) {
      var words = q.split(/\s+/);
      hits = items.map(function (it) {
        var hs = haystack(it), t = titleOf(it).toLowerCase(), score = 0;
        for (var i = 0; i < words.length; i++) { if (hs.indexOf(words[i]) < 0) return null; score += t.indexOf(words[i]) > -1 ? (t.indexOf(words[i]) === 0 ? 6 : 4) : 1; }
        if ((it.tags || []).indexOf(q) > -1) score += 3; if (it.fav) score += .5;
        return { it: it, score: score };
      }).filter(Boolean).sort(function (a, b) { return b.score - a.score || (b.it.updatedAt > a.it.updatedAt ? 1 : -1); }).slice(0, 40).map(function (x) { return x.it; });
    } else {
      hits = items.slice().sort(function (a, b) { return b.updatedAt > a.updatedAt ? 1 : -1; }).slice(0, 8);
    }
    sel = 0;
    if (!hits.length) { list.innerHTML = '<li class="none" role="presentation">No results for “' + esc(q) + "”</li>"; return; }
    var h = q ? "" : '<li class="grp" role="presentation">Recent</li>';
    hits.forEach(function (it, i) {
      var T = TYPES[it.type];
      h += '<li role="option" id="sr' + i + '" data-hit="' + i + '" aria-selected="' + (i === 0) + '"><span class="li-icon t-' + it.type + '">' + icon(T.icon) + '</span><span class="li-main"><span class="li-title">' + hl(titleOf(it), words1(q)) + '</span><span class="li-sub">' + esc(T.one) + " · " + hl(snippet(it, words1(q)), words1(q)) + "</span></span></li>";
    });
    list.innerHTML = h;
    $("#searchInput").setAttribute("aria-activedescendant", "sr0");
  }
  function words1(q) { return (q || "").split(/\s+/)[0]; }
  function moveSel(d) {
    if (!hits.length) return; sel = (sel + d + hits.length) % hits.length;
    $$("#searchResults [data-hit]").forEach(function (li) { var on = +li.getAttribute("data-hit") === sel; li.setAttribute("aria-selected", on); if (on) li.scrollIntoView({ block: "nearest" }); });
    $("#searchInput").setAttribute("aria-activedescendant", "sr" + sel);
  }
  function pickHit(i) { var it = hits[i]; if (!it) return; $("#searchDlg").close(); openEditor(it.type, it.id); }

  /* ---------------- quick capture ---------------- */
  function capture(text) {
    text = text.trim(); if (!text) return;
    var mode = ui.captureMode; var ts = now();
    var id = ytId(text);
    if (id || mode === "video") {
      var url = id ? text : safeUrl(text);
      if (!url) { toast("Paste a YouTube link"); return; }
      var v = { id: uid(), type: "video", title: "", url: url, channel: "", category: "tutorial", notes: "", tags: [], fav: false, createdAt: ts, updatedAt: ts };
      openEditor("video", null, v); return;
    }
    var parts = text.split(/\s+[—–-]\s+|\n/); var title = parts.shift().slice(0, 120); var body = parts.join("\n");
    var it = { id: uid(), type: mode, title: title, body: body, tags: [], fav: false, createdAt: ts, updatedAt: ts };
    it[TYPES[mode].opt] = TYPES[mode].opts[0];
    db.items.push(it); save(); render();
    toast(TYPES[mode].one + " captured", "Edit", function () { openEditor(mode, it.id); });
    var ci = $("#captureInput"); if (ci) ci.focus();
  }

  /* ---------------- events ---------------- */
  var nameTimer;
  function afterRender(r) {
    if (r === "settings") {
      if (window.BNAI) { try { window.BNAI.mountSettings($("#aiSettingsSlot")); } catch (e) { console.warn(e); } }
      var sn = $("#savedNote");
      ["sName", "sStudio"].forEach(function (id) {
        $("#" + id).addEventListener("input", function () {
          db.settings.displayName = $("#sName").value.trim(); db.settings.studioName = $("#sStudio").value.trim();
          clearTimeout(nameTimer); nameTimer = setTimeout(function () { save(); sn.classList.add("show"); setTimeout(function () { sn.classList.remove("show"); }, 1200); }, 300);
        });
      });
      $("#exportBtn").addEventListener("click", exportData);
      $("#importBtn").addEventListener("click", function () { $("#importFile").click(); });
      $("#importFile").addEventListener("change", function (e) { var f = e.target.files[0]; if (f) importData(f); e.target.value = ""; });
      $("#removeSamples").addEventListener("click", function () {
        var n = db.items.filter(function (i) { return i.sample; }).length; if (!n) return;
        confirmBox("Remove " + n + " sample entries?", "Only the built-in examples go. Everything you created or edited stays.", [{ label: "Cancel", value: null }, { label: "Remove samples", value: true, cls: "btn-danger" }]).then(function (ok) {
          if (!ok) return; quietly(function () { db.items = db.items.filter(function (i) { return !i.sample; }); save(); }); render(); toast("Sample data removed");
        });
      });
      var ib = $("#installBtn"); if (deferredPrompt) ib.hidden = false;
      ib.addEventListener("click", function () { if (!deferredPrompt) return; deferredPrompt.prompt(); deferredPrompt.userChoice.finally(function () { deferredPrompt = null; ib.hidden = true; }); });
    }
    if (r === "dashboard") {
      if (window.BNReport) { try { window.BNReport.mount($("#reportSlot")); } catch (e) { console.warn(e); } }
      $("#captureForm").addEventListener("submit", function (e) { e.preventDefault(); var i = $("#captureInput"); var v = i.value; i.value = ""; capture(v); });
    }
    var fq = $("#fq");
    if (fq) {
      fq.addEventListener("input", debounce(function () { filt(ui.route).q = fq.value.trim(); refreshResults(); }, 140));
      $("#fsort").addEventListener("change", function (e) { filt(ui.route).sort = e.target.value; refreshResults(); });
    }
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest("button, a"); if (!t) return;
    if (t.hasAttribute("data-open")) { openEditor(null, t.getAttribute("data-open")); return; }
    if (t.hasAttribute("data-fav")) { toggleFav(t.getAttribute("data-fav")); return; }
    if (t.hasAttribute("data-new")) { openEditor(t.getAttribute("data-new")); return; }
    if (t.hasAttribute("data-choose")) { $("#chooser").close(); openEditor(t.getAttribute("data-choose")); return; }
    if (t.hasAttribute("data-capture")) { ui.captureMode = t.getAttribute("data-capture"); $$("[data-capture]").forEach(function (b) { b.setAttribute("aria-pressed", b === t); }); var ci = $("#captureInput"); ci.placeholder = capturePlaceholder(); ci.focus(); return; }
    if (t.hasAttribute("data-fopt")) { var f = filt(ui.route); f.opt = t.getAttribute("data-fopt"); $$("[data-fopt]").forEach(function (b) { b.setAttribute("aria-pressed", b === t); }); refreshResults(); return; }
    if (t.hasAttribute("data-ftype")) { var g = filt(ui.route); g.type = t.getAttribute("data-ftype"); $$("[data-ftype]").forEach(function (b) { b.setAttribute("aria-pressed", b === t); }); refreshResults(); return; }
    if (t.hasAttribute("data-ffav")) { var h = filt(ui.route); h.fav = !h.fav; t.setAttribute("aria-pressed", h.fav); refreshResults(); return; }
    if (t.hasAttribute("data-copy")) { var src = $(t.getAttribute("data-copy")); copyText(src ? (src.value != null ? src.value : src.textContent) : t.getAttribute("data-copy-text")); return; }
    if (t.hasAttribute("data-copy-text")) { copyText(t.getAttribute("data-copy-text")); return; }
    if (t.hasAttribute("data-close")) { var d = t.closest("dialog"); if (d) d.close(); return; }
    var act = t.getAttribute("data-action");
    if (act === "search") { openSearch(); return; }
    if (act === "new") { openChooser(); return; }
  });
  // click on dialog backdrop closes it
  $$("dialog").forEach(function (d) {
    d.addEventListener("click", function (e) { if (e.target === d) { var r = d.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close(); } });
  });
  $("#editorForm").addEventListener("submit", function (e) { e.preventDefault(); saveEditor(); });
  $("#editorForm").addEventListener("keydown", function (e) { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); saveEditor(); } });
  $("#editorDelete").addEventListener("click", function () { if (editing && editing.id) deleteItem(editing.id); });
  $("#editor").addEventListener("close", function () { editing = null; });
  var runSearchSoon = debounce(runSearch, 90);
  $("#searchInput").addEventListener("input", runSearchSoon);
  $("#searchInput").addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { e.preventDefault(); moveSel(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveSel(-1); }
    else if (e.key === "Enter") { e.preventDefault(); runSearchSoon.flush(); pickHit(sel); }
  });
  $("#searchResults").addEventListener("click", function (e) { var li = e.target.closest("[data-hit]"); if (li) pickHit(+li.getAttribute("data-hit")); });
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); if ($("#searchDlg").open) $("#searchDlg").close(); else { $$("dialog[open]").forEach(function (d) { d.close(); }); openSearch(); } return; }
    if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "") && !document.querySelector("dialog[open]")) { e.preventDefault(); openSearch(); }
  });
  window.addEventListener("hashchange", function () { render(); window.scrollTo(0, 0); $("#view").focus({ preventScroll: true }); });
  window.addEventListener("storage", function (e) { if (e.key === KEY && e.newValue) { try { var d = JSON.parse(e.newValue); if (d && Array.isArray(d.items)) { db = normalize(d).data; snapAll(); render(); } } catch (x) {} } });

  var deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferredPrompt = e; var b = $("#installBtn"); if (b) b.hidden = false; });
  window.addEventListener("appinstalled", function () { deferredPrompt = null; toast("Bhavnote installed"); });

  if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) { var k = $("#kbdHint"); if (k) k.textContent = "⌘K"; }

  /* ---------------- boot ---------------- */
  window.BN = {
    get db() { return db; }, KEY: KEY, TYPES: TYPES, PLATFORMS: PLATFORMS, PLATFORM_LABEL: PLATFORM_LABEL, PAY_MODES: PAY_MODES, VIEWS: VIEWS, ui: ui,
    $: $, $$: $$, esc: esc, icon: icon, cap: cap, uid: uid, now: now, ymd: ymd, addDays: addDays, daysUntil: daysUntil, fmtDate: fmtDate, INR: INR,
    parseTags: parseTags, titleOf: titleOf, bodyOf: bodyOf, ago: ago, byId: byId, save: save, render: render, toast: toast, confirmBox: confirmBox,
    openEditor: openEditor, deleteItem: deleteItem, debounce: debounce, haystack: haystack, safeUrl: safeUrl, clientPending: clientPending,
    IDB: IDB, asActor: asActor, quietly: quietly, logEvent: logEvent, restoreFromTrash: restoreFromTrash, findClient: findClient, waLink: waLink, daysText: daysText, seedV3: seedV3, clean: clean, persist: persist, phoneOf: phoneOf, reminderText: reminderText, monthKey: monthKey, emptyBox: emptyBox, listItem: listItem, copyText: copyText
  };
  // boot after the feature modules (loaded after this file) have registered their views
  document.addEventListener("DOMContentLoaded", function () {
    db = load();
    snapAll();
    render();
    setTimeout(pruneHistory, 3000);
    if (window.BNReady) window.BNReady.forEach(function (fn) { try { fn(); } catch (e) { console.warn(e); } });
  });
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", function () { navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" }).then(function (reg) { reg.update().catch(function () {}); }).catch(function () {}); });
  }
  window.Bhavnote = { version: 2, key: KEY };
})();
