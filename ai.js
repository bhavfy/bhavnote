/* Bhavnote — Sahayak. A small chat-style helper that runs completely inside this phone:
   no internet, no account, no key. It understands a few Hinglish / English commands
   (note likho, kitne notes, dhundo, kharcha, kitni books). Registers the #/sahayak view.
   Old saved chats stay readable. */
(function () {
  "use strict";
  var B = window.BN; if (!B) return;
  var esc = B.esc, icon = B.icon, INR = B.INR, $ = B.$, $$ = B.$$;
  var CHAT_KEY = "bhavnote.chat";

  /* a leftover key from the old helper has no use any more: wipe it from this phone */
  try { localStorage.removeItem("bhavnote.ai"); } catch (e) {}

  /* ---------- chat state (same storage format as before, so old chats keep rendering) ---------- */
  var conv = [], log = [], chatId = null, chatCreated = null;
  function loadChat() { try { var c = JSON.parse(localStorage.getItem(CHAT_KEY) || "null"); if (c) { conv = c.conv || []; log = c.log || []; chatId = c.id || null; chatCreated = c.createdAt || null; } } catch (e) {} if (!chatId) { chatId = B.uid(); chatCreated = B.now(); } }
  function chatTitle(lg) {
    for (var i = 0; i < lg.length; i++) if (lg[i].kind === "user") { var t = String(lg[i].text || "").replace(/\(Voice note[^)]*\)/, "🎙️ Voice note").replace(/📸 \(screenshot\)/, "📸 Screenshot").replace(/\s+/g, " ").trim(); if (!t && lg[i].img) t = "📸 Screenshot"; if (!t && lg[i].audio) t = "🎙️ Voice note"; return t.length > 46 ? t.slice(0, 44) + "…" : (t || "Chat"); }
    return "Chat";
  }
  var archiveSoon = B.debounce(function () { archiveNow(); }, 800);
  function archiveNow(lg, cv) {
    lg = lg || storedLog(); if (!lg.length) return Promise.resolve();
    return B.IDB.put("chats", { id: chatId, title: chatTitle(lg), createdAt: chatCreated || B.now(), updatedAt: B.now(), log: lg, conv: cv || conv, n: lg.filter(function (m) { return m.kind === "user" || m.kind === "ai"; }).length }).catch(function () {});
  }
  function storedLog() { return log.slice(-80).map(function (m) { if (m.img) { m = Object.assign({}, m); delete m.img; m.text = (m.text ? m.text + "\n" : "") + "📸 (screenshot)"; } return m; }); }
  function newChat() { if (log.length) archiveNow(); conv = []; log = []; chatId = B.uid(); chatCreated = B.now(); saveChat(); }
  function listChats() { return B.IDB.all("chats").then(function (rows) { return rows.sort(function (a, b) { return b.updatedAt < a.updatedAt ? -1 : 1; }); }); }
  function openChat(id) {
    return B.IDB.get("chats", id).then(function (c) {
      if (!c) return; if (log.length && chatId !== id) archiveNow();
      conv = c.conv || []; log = c.log || []; chatId = c.id; chatCreated = c.createdAt; saveChat(); location.hash = "#/sahayak"; if (B.ui.route === "sahayak") B.render();
    });
  }
  function deleteChat(id) { return B.IDB.del("chats", id).then(function () { if (id === chatId) { conv = []; log = []; chatId = B.uid(); chatCreated = B.now(); saveChat(); } }); }
  function saveChat() {
    try { localStorage.setItem(CHAT_KEY, JSON.stringify({ id: chatId, createdAt: chatCreated, conv: conv, log: storedLog() })); } catch (e) {}
    if (log.length) archiveSoon();
  }
  function md(t) { // tiny, safe formatting: **bold**, bullets, line breaks
    return esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/^\s*[\*\-•]\s+/gm, "• ").replace(/\n/g, "<br>");
  }
  function bubbleHtml(m) {
    if (m.kind === "user") return '<div class="msg me">' + (m.img ? '<img class="msg-img" alt="Attached screenshot" src="' + m.img + '">' : "") + (m.audio ? '<p class="msg-tag">' + icon("i-mic") + "Voice note</p>" : "") + (m.text ? "<p>" + md(m.text) + "</p>" : "") + "</div>";
    if (m.kind === "ai") return '<div class="msg ai"><p>' + md(m.text) + "</p></div>";
    if (m.kind === "note") return '<div class="msg-note">' + esc(m.text) + "</div>";
    if (m.kind === "err") return '<div class="msg ai err"><p>' + md(m.text) + "</p></div>";
    if (m.kind === "html") return m.html;
    return "";
  }
  function feed() { return $("#chatFeed"); }
  function scrollDown() { requestAnimationFrame(function () { window.scrollTo(0, document.documentElement.scrollHeight); }); }
  function push(m) {
    log.push(m); var cb = $("#chatClear"); if (cb) cb.hidden = false;
    var f = feed(); if (f) { var e = $(".chat-empty", f); if (e) e.remove(); f.insertAdjacentHTML("beforeend", bubbleHtml(m)); scrollDown(); }
    saveChat();
  }
  function reply(html) { push({ kind: "html", html: '<div class="msg ai">' + html + "</div>" }); }
  function say(text) { push({ kind: "ai", text: text }); }

  /* ---------- text helpers ---------- */
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[“”"'`’]/g, "").replace(/[?!.,;()\[\]]/g, " ").replace(/\s+/g, " ").trim(); }
  function lev(a, b) {
    if (a === b) return 0; if (Math.abs(a.length - b.length) > 2) return 9;
    var p = [], i, j; for (j = 0; j <= b.length; j++) p[j] = j;
    for (i = 1; i <= a.length; i++) { var c = [i]; for (j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; }
    return p[b.length];
  }
  // does token t match one of the words (typo-tolerant for words of 4+ letters)?
  function isW(t, words) {
    for (var i = 0; i < words.length; i++) { var w = words[i]; if (t === w) return true; if (w.length >= 4 && t.length >= 4 && lev(t, w) <= (w.length >= 7 ? 2 : 1)) return true; }
    return false;
  }
  function hasW(toks, words) { for (var i = 0; i < toks.length; i++) if (isW(toks[i], words)) return true; return false; }
  var W_NOTE = ["note", "notes", "nots", "noat", "naote"], W_IDEA = ["idea", "ideas", "idia", "aidea", "idiya"];
  var W_WRITE = ["likho", "likh", "likhdo", "likhna", "likhlo", "banao", "add", "save", "create", "new", "yaad", "rakho", "rakh", "daalo", "dalo", "write", "karo"];
  var W_FILL = ["ek", "ye", "yeh", "naya", "nayi", "ik", "mera", "meri", "mere", "mein", "me", "ko", "ka", "ki", "ke", "kar", "do", "de", "dena", "please", "plz", "pls", "bhai", "bhaiya", "isko", "usko", "iska", "bas"];
  var W_COUNT = ["kitne", "kitna", "kitni", "total", "count", "many", "number", "ginti", "gino", "sankhya", "kitnay"];
  var W_SEARCH = ["dhundo", "dhundh", "dhoondo", "dhoondh", "dhundna", "search", "find", "khojo", "khoj", "dikhao", "dikha", "dikhana", "dikhado", "show", "list", "batao", "bata", "nikalo"];
  var W_WALE = ["wale", "wali", "wala", "waale", "vale", "vali", "related", "about", "baare", "bare"];
  var W_MONEY_OUT = ["kharcha", "kharch", "kharche", "kharcho", "expense", "expenses", "spend", "spent", "kharchaa"];
  var W_MONEY_IN = ["kamai", "kamayi", "kamaya", "income", "earning", "earnings", "kamaye", "paisa", "payment"];
  var W_BOOK = ["book", "books", "kitab", "kitabein", "kitaben", "pdf", "pdfs"];

  /* ---------- data helpers ---------- */
  function notes() { return B.db.items.filter(function (it) { return it.type === "note"; }); }
  function isIdea(it) { return it.kind === "idea" || (it.tags || []).indexOf("idea") > -1; }
  function addNote(text, idea) {
    var words = text.split(/\s+/).filter(Boolean); var ts = B.now();
    var firstLine = text.split("\n")[0].trim(); var title = firstLine, body = "";
    if (words.length > 6 || firstLine.length > 60 || text.indexOf("\n") > -1) {
      var tw = firstLine.split(/\s+/).slice(0, 6).join(" "); if (tw.length > 60) tw = tw.slice(0, 58);
      title = tw + (tw.length < text.trim().length ? "…" : ""); body = text.trim();
    }
    var it = { id: B.uid(), type: "note", title: title, body: body, kind: idea ? "idea" : "note", tags: idea ? ["idea"] : [], fav: false, createdAt: ts, updatedAt: ts };
    B.db.items.push(it); B.save(); return it;
  }
  function noteRow(it) {
    var kind = it.kind && it.kind !== "note" ? B.cap(it.kind) : "Note";
    return '<button type="button" class="list-item sah-row" data-open="' + esc(it.id) + '"><span class="li-main"><span class="li-title">' + esc(B.titleOf(it)) + '</span><span class="li-sub">' + esc(kind + (it.pinned ? " · pinned" : "") + (it.archived ? " · archive" : "")) + "</span></span></button>";
  }
  function btnGo(label, hash) { return '<button type="button" class="mini-btn" data-sahgo="' + esc(hash) + '">' + esc(label) + "</button>"; }

  /* ---------- commands ---------- */
  var HELP = "• **Kitne notes hain** — total notes\n• **Note likho: …** ya **Idea likho: …** — seedha note ban jaye\n• **Dhundo <word>** ya **<word> wale notes dikha** — notes dhundh ke dega\n• **Aaj ka kharcha** / **Kharcha total** / **Is mahine ki kamai** — paisa ka hisaab\n• **Kitni books** — kitni PDF upload hain";

  var STRONG = ["likho", "likh", "likhdo", "likhna", "likhlo", "yaad", "rakho", "write", "banao", "add", "save", "daalo", "dalo"];
  function strongTok(t) { return STRONG.indexOf(t) > -1 || lev(t, "likho") <= 1 || lev(t, "banao") <= 1 || lev(t, "likhdo") <= 1; }
  function hasStrong(ts) { for (var i = 0; i < ts.length; i++) if (strongTok(ts[i])) return true; return false; }
  function tryCreate(raw) {
    var text = raw.trim(); var colon = text.indexOf(":");
    var kinds = W_NOTE.concat(W_IDEA);
    function cmdTok(t) { return isW(t, kinds) || isW(t, W_WRITE) || isW(t, W_FILL); }
    var body = null, idea = false;
    if (colon > -1) {
      var toks = norm(text.slice(0, colon)).split(" ").filter(Boolean);
      if (!toks.length || toks.length > 6 || !toks.every(cmdTok) || !(hasW(toks, kinds) || hasStrong(toks))) return null;
      body = text.slice(colon + 1).trim(); idea = hasW(toks, W_IDEA);
    } else {
      var all = text.split(/\s+/), i = 0, lead = [];
      for (; i < all.length && i < 5; i++) { var t = norm(all[i]); if (!t) continue; if (!cmdTok(t)) break; lead.push(t); }
      if (!lead.length || !hasStrong(lead) || !(isW(lead[0], kinds) || isW(lead[0], W_WRITE) || isW(lead[0], W_FILL))) return null;
      body = all.slice(i).join(" ").trim(); idea = hasW(lead, W_IDEA);
    }
    if (!body) { say("Kya likhun? Aise bolo:\nnote likho: kal 5 baje client call\nidea likho: travel reel ka hook"); return true; }
    var it = addNote(body, idea);
    push({ kind: "html", html: '<div class="msg-note done"><span>✓ ' + (idea ? "Idea" : "Note") + " ban gaya: " + esc(B.titleOf(it)) + '</span><button type="button" class="mini-btn" data-open="' + esc(it.id) + '">Open</button><button type="button" class="mini-btn" data-sahundo="' + esc(it.id) + '">Undo</button></div>' });
    return true;
  }

  function countNotes(wantIdeas) {
    var n = notes(); var arch = n.filter(function (i) { return i.archived; }).length; var pin = n.filter(function (i) { return i.pinned && !i.archived; }).length;
    var active = n.length - arch; var ideas = n.filter(function (i) { return isIdea(i) && !i.archived; }).length;
    if (wantIdeas) { say("Tumhare paas " + ideas + " idea" + (ideas === 1 ? "" : "s") + " hain (archive ke bina)."); return; }
    var t = "Total " + active + " note" + (active === 1 ? "" : "s") + " hain 📝";
    var bits = []; if (pin) bits.push(pin + " pinned"); if (ideas) bits.push(ideas + " ideas"); if (arch) bits.push(arch + " archived alag");
    say(t + (bits.length ? "\n(" + bits.join(" · ") + ")" : ""));
  }
  function countBooks() {
    return B.IDB.all("books").then(function (rows) {
      var n = (rows || []).length;
      reply('<p>' + (n ? "Tumne " + n + " PDF/book upload ki hain 📚" : "Abhi koi book upload nahi hai. Books tab mein PDF daal sakte ho.") + '</p><div class="cf-actions">' + btnGo("Books kholo", "#/books") + "</div>");
    }).catch(function () { say("Books abhi padh nahi paaya, thodi der baad try karo."); });
  }

  function wordMatch(hay, w) {
    if (hay.indexOf(w) > -1) return true;
    if (w.length < 5) return false;
    var ts = hay.split(/[^a-z0-9\u0900-\u097f]+/); for (var i = 0; i < ts.length; i++) if (ts[i].length >= 4 && Math.abs(ts[i].length - w.length) <= 1 && lev(ts[i], w) <= 1) return true;
    return false;
  }
  function searchNotes(q) {
    var words = norm(q).split(" ").filter(Boolean);
    if (!words.length) { say("Kya dhundhna hai? Jaise: dhundo travel"); return; }
    var strict = function (hs, w) { return hs.indexOf(w) > -1; };
    var find = function (fn) { return notes().filter(function (it) { var hs = B.haystack(it); return words.every(function (w) { return fn(hs, w); }); }); };
    var hits = find(strict); if (!hits.length) hits = find(wordMatch);
    hits.sort(function (a, b) { return (b.updatedAt || "") < (a.updatedAt || "") ? -1 : 1; });
    if (!hits.length) { say("“" + q.trim() + "” wala koi note nahi mila."); return; }
    var shown = hits.slice(0, 8);
    reply('<p>“' + esc(q.trim()) + '” ke ' + hits.length + " note" + (hits.length === 1 ? "" : "s") + " mile — tap karke kholo:</p>" + shown.map(noteRow).join("") + (hits.length > shown.length ? "<p class=\"cm-label\">+" + (hits.length - shown.length) + " aur hain, word thoda specific karo.</p>" : ""));
  }

  function listRecent() {
    var r = notes().filter(function (i) { return !i.archived; }).sort(function (a, b) { return (b.updatedAt || "") < (a.updatedAt || "") ? -1 : 1; }).slice(0, 8);
    if (!r.length) { say("Abhi koi note nahi hai. “note likho: …” bolke bana lo."); return; }
    reply("<p>Ye rahe tumhare latest notes:</p>" + r.map(noteRow).join(""));
  }
  function amt(it) { return +it.amount || 0; }
  function money(toks, wantIn) {
    var today = B.ymd(new Date()), mk = B.monthKey(new Date());
    var period = "month", label = "Is mahine";
    if (hasW(toks, ["aaj", "today", "aj"])) { period = "day"; label = "Aaj"; }
    else if (hasW(toks, ["kal", "yesterday"])) { period = "yday"; label = "Kal"; today = B.addDays(-1); }
    else if (hasW(toks, ["hafte", "hafta", "week", "haftey"])) { period = "week"; label = "Is hafte (7 din)"; }
    var type = wantIn ? "income" : "expense"; var from = null, to = null;
    if (period === "day" || period === "yday") { from = to = today; } else if (period === "week") { from = B.addDays(-6); to = B.ymd(new Date()); }
    var rows = B.db.items.filter(function (it) {
      if (it.type !== type || !it.date) return false;
      if (wantIn && it.status === "pending") return false;
      if (from) return it.date >= from && it.date <= to; return B.monthKey(it.date) === mk;
    });
    var sum = rows.reduce(function (s, it) { return s + amt(it); }, 0);
    var name = wantIn ? "kamai" : "kharcha";
    var t = B.paisa && B.paisa.totals ? B.paisa.totals(mk) : null;
    var h = "<p><b>" + label + (wantIn ? " ki " : " ka ") + name + ": " + esc(INR.format(sum)) + "</b>" + (rows.length ? " (" + rows.length + " entry)" : "") + "</p>";
    if (!rows.length) h += "<p>" + (period === "month" ? "Is mahine koi " + name + " entry nahi hai." : "Koi " + name + " entry nahi mili.") + "</p>";
    else h += rows.sort(function (a, b) { return amt(b) - amt(a); }).slice(0, 6).map(function (it) { return '<button type="button" class="list-item sah-row" data-open="' + esc(it.id) + '"><span class="li-main"><span class="li-title">' + esc(B.titleOf(it)) + '</span><span class="li-sub">' + esc(INR.format(amt(it)) + " · " + B.fmtDate(it.date)) + "</span></span></button>"; }).join("");
    if (t && period !== "month") h += "<p>Is mahine " + (wantIn ? "ki" : "ka") + " total " + name + ": " + esc(INR.format(wantIn ? t.income : t.expense)) + "</p>";
    else if (t && period === "month") h += "<p>Is mahine bacha: " + esc(INR.format(t.saved)) + " (kamai " + esc(INR.format(t.income)) + ", kharcha " + esc(INR.format(t.expense)) + ")</p>";
    reply(h + '<div class="cf-actions">' + btnGo("Paisa kholo", "#/paisa") + "</div>");
  }

  function noMatch() { say("Ye samajh nahi aaya, ye commands try karo:\n" + HELP); }

  function handle(raw) {
    var text = raw.trim(); if (!text) return;
    var n = norm(text); var toks = n.split(" ").filter(Boolean);
    if (!toks.length) { noMatch(); return; }
    var isNote = hasW(toks, W_NOTE), isIdea = hasW(toks, W_IDEA);
    // 0) explicit create with colon first ("note: ...", "idea likho: ...")
    if (text.indexOf(":") > -1 && tryCreate(text)) return;
    // 1) help / hello
    if (n === "help" || n === "madad" || n === "commands" || n === "menu" || /^(help|madad|commands|kya kar sakte|kya kar sakta)/.test(n)) { say("Main ye kar sakta hoon:\n" + HELP); return; }
    if (toks.length <= 2 && isW(toks[0], ["hi", "hello", "hey", "namaste", "hlo", "hii"])) { say("Namaste! 👋 Main tumhara Sahayak hoon, sab kuch phone ke andar chalta hai. Ye bol sakte ho:\n" + HELP); return; }
    // 1b) create without colon ("note likho kal shoot 5 baje")
    if (tryCreate(text)) return;
    // 2) books
    if (hasW(toks, W_BOOK) && (hasW(toks, W_COUNT) || toks.length <= 2)) { countBooks(); return; }
    // 3) money
    var out = hasW(toks, W_MONEY_OUT), inn = hasW(toks, W_MONEY_IN);
    if ((out || inn) && !hasW(toks, W_WRITE.slice(0, 5)) ) { money(toks, inn && !out); return; }
    // 4) search ("dhundo travel", "travel wale notes dikha")
    var sIdx = -1; toks.forEach(function (t, i) { if (sIdx < 0 && isW(t, ["dhundo", "dhundh", "dhoondo", "dhoondh", "dhundna", "search", "find", "khojo", "khoj"])) sIdx = i; });
    if (sIdx > -1) {
      var q = toks.filter(function (t, i) { return i !== sIdx && !isW(t, W_NOTE) && !isW(t, W_WALE) && !isW(t, ["mein", "me", "ko", "ka", "ki", "ke", "kar", "do", "mere", "meri", "for", "in", "my", "about", "please", "bhai"]); }).join(" ");
      searchNotes(q); return;
    }
    var wIdx = -1; toks.forEach(function (t, i) { if (wIdx < 0 && isW(t, W_WALE)) wIdx = i; });
    if ((isNote || isIdea) && wIdx < 0 && hasW(toks, W_COUNT)) { countNotes(isIdea && !isNote); return; }
    var showV = hasW(toks, ["dikha", "dikhao", "dikhana", "show", "dikhado", "list"]);
    if (wIdx > 0 || (isNote && showV)) {
      var stop = function (t) { return isW(t, W_NOTE) || isW(t, W_WALE) || isW(t, W_SEARCH) || isW(t, ["mere", "meri", "mein", "me", "ko", "ka", "ki", "ke", "kar", "do", "all", "sab", "saare", "please", "bhai", "plz", "my", "recent", "latest"]); };
      var q2 = (wIdx > 0 ? toks.slice(0, wIdx) : toks).filter(function (t) { return !stop(t); }).join(" ");
      if (q2) { searchNotes(q2); return; }
      if (isNote) { listRecent(); return; }
    }
    // 5) counts
    if ((isNote || isIdea) && toks.length <= 2) { countNotes(isIdea && !isNote); return; }
    // 7) a lone word that is a note word ("notes") -> count
    noMatch();
  }

  function submit(v) {
    v = String(v || "").trim(); if (!v) return;
    push({ kind: "user", text: v });
    try { handle(v); } catch (e) { console.warn(e); say("Kuch gadbad ho gayi, dobara try karo."); }
  }

  /* ---------- view ---------- */
  var QUICK = [
    ["i-note", "Kitne notes hain", "send", "kitne notes hain"],
    ["i-plus", "Note likho", "fill", "note likho: "],
    ["i-spark", "Idea likho", "fill", "idea likho: "],
    ["i-rupee", "Aaj ka kharcha", "send", "aaj ka kharcha"],
    ["i-search", "Dhundo…", "fill", "dhundo "],
    ["i-book", "Kitni books", "send", "kitni books"]
  ];
  function render() {
    var h = '<div class="ai-head"><div><h1>Sahayak</h1><p class="sub">Notes likho, gino, dhundo, kharcha dekho — sab phone ke andar, bina internet.</p></div>' +
      '<div class="head-actions"><button class="mini-btn" type="button" id="chatList">' + icon("i-history") + 'Chats</button><button class="mini-btn" type="button" id="chatClear"' + (log.length ? "" : " hidden") + ">+ Nayi</button></div></div>";
    h += '<div class="chat-feed" id="chatFeed" aria-live="polite">';
    if (!log.length) {
      h += '<div class="chat-empty"><p class="cm-label">Try karo</p><div class="quick">' + QUICK.map(function (q, i) { return '<button type="button" class="quick-btn" data-quick="' + i + '">' + icon(q[0]) + "<span>" + esc(q[1]) + "</span></button>"; }).join("") + "</div></div>";
    }
    h += log.map(bubbleHtml).join("");
    h += '</div>';
    h += '<form class="composer" id="chatForm" autocomplete="off"><div class="comp-row">' +
      '<label class="sr-only" for="chatInput">Message</label><textarea id="chatInput" rows="1" placeholder="Likho: kitne notes hain…" enterkeyhint="send"></textarea>' +
      '<button type="submit" class="send-btn" id="chatSend" aria-label="Send">' + icon("i-send") + "</button></div></form>";
    return h;
  }
  function autosize() { var t = $("#chatInput"); if (!t) return; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 140) + "px"; }
  function after() {
    var f = $("#chatForm"), input = $("#chatInput");
    f.addEventListener("submit", function (e) { e.preventDefault(); var v = input.value.trim(); if (!v) return; input.value = ""; autosize(); submit(v); });
    input.addEventListener("input", autosize);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey && matchMedia("(pointer:fine)").matches) { e.preventDefault(); f.requestSubmit(); } });
    var cl = $("#chatClear"); if (cl) cl.addEventListener("click", function () { newChat(); B.render(); });
    $("#chatList").addEventListener("click", function () { B.ui.histTab = "chats"; location.hash = "#/history"; });
    $$("[data-quick]").forEach(function (b) { b.addEventListener("click", function () {
      var q = QUICK[+b.getAttribute("data-quick")];
      if (q[2] === "send") submit(q[3]);
      else { input.value = q[3]; autosize(); input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }); });
    var fd = feed();
    fd.addEventListener("click", function (e) {
      var go = e.target.closest("[data-sahgo]"); if (go) { location.hash = go.getAttribute("data-sahgo"); return; }
      var un = e.target.closest("[data-sahundo]");
      if (un) {
        var id = un.getAttribute("data-sahundo"), it = B.byId(id), i = it ? B.db.items.indexOf(it) : -1;
        if (i > -1) { B.db.items.splice(i, 1); B.save(); B.toast("Hata diya"); un.closest(".msg-note").classList.add("undone"); un.remove(); } else { B.toast("Ye pehle hi hat chuka hai"); un.remove(); }
      }
    });
    scrollDown();
  }
  B.VIEWS.sahayak = { render: render, after: after };

  window.BNSAH = { listChats: listChats, openChat: openChat, deleteChat: deleteChat, newChat: newChat, md: md, handle: submit };
  loadChat();
  if (log.length) archiveSoon();
})();
