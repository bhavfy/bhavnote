/* Bhavnote — Bhav AI. A chat helper that reads and changes Bhavnote data through Google Gemini
   (the user's own free API key, stored only in this browser). Registers the #/ai view,
   and the Settings → Bhav AI panel. (v3: the Sunday Report card was removed from Home.) */
(function () {
  "use strict";
  var B = window.BN; if (!B) return;
  var esc = B.esc, icon = B.icon, INR = B.INR, $ = B.$, $$ = B.$$;
  var CFG_KEY = "bhavnote.ai", CHAT_KEY = "bhavnote.chat";
  var API = "https://generativelanguage.googleapis.com/v1beta";
  var FALLBACK_MODELS = ["gemini-flash-latest", "gemini-2.5-flash"];
  // order tried when the chosen model is overloaded (de-duplicated at call time)
  var CHAIN = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];  // 2.x are closed to newer keys (404) — those are skipped fast, 3.5 is the one Google points new keys to
  var DELAYS = [1000, 2500];          // backoff before attempt 2 and 3 on the same model
  var MAX_ATTEMPTS = 3, TRY_TIMEOUT = 35000, TOTAL_BUDGET = 100000;
  var SNAP_MAX = 9000;
  var lastUsed = { model: "", fellBack: false, tries: 0 };

  /* ---------- config (kept out of the JSON backup on purpose) ---------- */
  function cfg() { try { return JSON.parse(localStorage.getItem(CFG_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function setCfg(o) { var c = Object.assign(cfg(), o); try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) {} return c; }
  function hasKey() { return !!(cfg().key || "").trim(); }

  /* ---------- model choice: ask Google which models this key can use, pick the newest stable Flash ---------- */
  function pickModel(models) {
    // Stable first: the newest-numbered Flash (3.x) was picked before and kept answering "busy". Prefer proven GA models.
    var ids = models.filter(function (m) { return (m.supportedGenerationMethods || []).indexOf("generateContent") > -1; }).map(function (m) { return String(m.name || "").replace(/^models\//, ""); });
    var stable = ["gemini-flash-latest", "gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.0-flash"];
    for (var k = 0; k < stable.length; k++) if (ids.indexOf(stable[k]) > -1) return stable[k];
    var bad = /(lite|image|tts|live|audio|transcribe|embed|computer|robotics|thinking|exp|learnlm|gemma|aqa|vision|nano|banana|veo|imagen|translate)/i;
    var best = null, bestScore = -1;
    models.forEach(function (m) {
      var id = String(m.name || "").replace(/^models\//, "");
      if (!/flash/i.test(id) || bad.test(id)) return;
      if ((m.supportedGenerationMethods || []).indexOf("generateContent") < 0) return;
      var v = (id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1]; var score = v ? parseFloat(v) : (id === "gemini-flash-latest" ? 0.5 : 0);
      if (/preview/i.test(id)) score -= 0.6; if (/-\d{3}$|-\d{2}-\d{4}$/.test(id)) score -= 0.01;
      if (score > bestScore) { bestScore = score; best = id; }
    });
    return best;
  }
  function listModels(key) {
    return fetch(API + "/models?pageSize=200", { headers: { "x-goog-api-key": key } }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) { var e = new Error((j.error && j.error.message) || ("HTTP " + r.status)); e.status = r.status; e.body = j; throw e; } return j.models || []; });
    });
  }
  function ensureModel(force) {
    var c = cfg(); if (c.model && !force && c.pickVer === 2) return Promise.resolve(c.model);
    return listModels(c.key).then(function (ms) { buildExtras(ms); var m = pickModel(ms) || FALLBACK_MODELS[0]; setCfg({ model: m, preferred: m, pickVer: 2, dead: {}, extras: extras, modelCheckedAt: B.now() }); return m; })
      .catch(function (e) { if (e.status === 400 || e.status === 403) throw e; var m = (c.pickVer === 2 && c.model) || FALLBACK_MODELS[0]; setCfg({ model: m, preferred: m, pickVer: 2 }); return m; });
  }

  /* ---------- Gemini call ---------- */
  function friendlyError(e) {
    if (!navigator.onLine) return "Internet nahi hai 📶 AI ko online hona padega. Baaki app offline chalta rahega.";
    var msg = String((e && e.message) || e || "");
    var det = e && e.details ? "\n(details: " + String(e.details).slice(0, 450) + ")" : "";
    if (e && e.allBusy) return "Google ke saare models abhi busy hain. 2-3 min baad try karo — key theek hai ✅" + det;
    if (e && e.status === 429 && e.quota) return "Aaj ki free limit ya per-minute limit poori ho gayi ⏳ 1-2 minute baad try karo.";
    if (e && (e.status === 400 && /api key|API_KEY/i.test(msg))) return "API key galat lag rahi hai 🔑 Settings → Bhav AI mein dobara paste karo.";
    if (e && e.status === 403) return "Is key ko Gemini use karne ki permission nahi hai. aistudio.google.com se nayi key banao.";
    if (e && e.status === 429) return "Aaj ki free limit ya per-minute limit poori ho gayi ⏳ 1-2 minute baad try karo.";
    if (e && e.status >= 500) return "Google ka server abhi busy hai, thodi der baad try karo." + det;
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "Google tak connect nahi ho paaya. Internet check karo aur dobara try karo.";
    return "Kuch gadbad ho gayi: " + msg.slice(0, 160);
  }
  function isQuota(status, msg) { return status === 429 && /quota|per day|per-day|perday|daily|billing|free.?tier/i.test(msg || ""); }
  function isOverload(status, msg) { return status === 500 || status === 502 || status === 503 || status === 504 || (status === 429 && !isQuota(status, msg)); }
  // one compact line per model: "model 503 first-60-chars-of-Google's-message (x3)"
  function logFail(log, m, e) {
    var txt = m + " " + (e.status || (e.timeout ? "timeout" : "net")) + (e.status ? " " + String(e.message || "").replace(/\s+/g, " ").slice(0, 60) : "");
    var last = log.length - 1;
    if (last >= 0 && log[last].txt === txt) log[last].n++; else log.push({ txt: txt, n: 1 });
    log.toString = function () { return this.map(function (x) { return x.txt + (x.n > 1 ? " (x" + x.n + ")" : ""); }).join(" | "); };
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var extras = []; // other usable Flash models from the key's own model list (newest stable first), appended at the end of the chain
  function buildExtras(models) {
    var bad = /(lite|image|tts|live|audio|transcribe|embed|computer|robotics|thinking|exp|learnlm|gemma|aqa|vision|nano|banana|veo|imagen|translate|omni|preview)/i;
    extras = models.filter(function (m) { return (m.supportedGenerationMethods || []).indexOf("generateContent") > -1; })
      .map(function (m) { return String(m.name || "").replace(/^models\//, ""); })
      .filter(function (id) { return /^gemini-\d/.test(id) && /flash/i.test(id) && !bad.test(id); })
      .sort(function (x, y) { return parseFloat((y.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1]) - parseFloat((x.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1]); }).slice(0, 3);
  }
  function candidates(first) {
    var c = cfg(), list = [first]; if (!extras.length && c.extras) extras = c.extras;
    if (c.preferred && c.preferred !== first) list.push(c.preferred);
    CHAIN.forEach(function (m) { list.push(m); });
    extras.forEach(function (m) { list.push(m); });
    list = list.filter(function (m, i) { return m && list.indexOf(m) === i; });
    var dead = c.dead || {}, fresh = list.filter(function (m) { return !(dead[m] && Date.now() - dead[m] < 864e5); });  // 404'd in the last 24 h: skip
    return fresh.length ? fresh : list;
  }
  function markDead(m) { var d = cfg().dead || {}; d[m] = Date.now(); setCfg({ dead: d }); }
  // One HTTP try. Resolves { ok, json } or rejects with an Error carrying .status / .net / .timeout
  function tryOnce(model, key, body) {
    var ctl = typeof AbortController === "function" ? new AbortController() : null, timer = null;
    var req = fetch(API + "/models/" + encodeURIComponent(model) + ":generateContent", {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok) return j;
        var e = new Error((j.error && j.error.message) || ("HTTP " + r.status)); e.status = r.status; e.body = j; throw e;
      });
    }, function (err) { var e = new Error(ctl && ctl.signal.aborted ? "timeout" : String((err && err.message) || err)); e.net = true; e.timeout = !!(ctl && ctl.signal.aborted); throw e; });
    if (!ctl) return req;
    timer = setTimeout(function () { try { ctl.abort(); } catch (x) {} }, TRY_TIMEOUT);
    return req.then(function (j) { clearTimeout(timer); return j; }, function (e) { clearTimeout(timer); throw e; });
  }
  /* Tries the chosen model up to 3 times (1s, 2.5s backoff) when Google is overloaded, then walks CHAIN.
     opts.onProgress(text) is told what is happening so the chat can show it instead of silence. */
  function callGemini(body, opts) {
    opts = opts || {}; var say = opts.onProgress || function () {}; var t0 = Date.now(), c = cfg(), log = [], maxTry = opts.attempts || MAX_ATTEMPTS;
    return ensureModel(false).then(function (first) {
      var list = candidates(first), lastErr = null, busyCount = 0, skipped = 0, repicked = false;
      lastUsed = { model: "", fellBack: false, tries: 0 };
      // a fallback that was saved earlier is only trusted for 30 min, then the best model is tried first again
      if (c.model && c.preferred && c.model !== c.preferred && Date.now() - (c.fallbackAt || 0) > 30 * 60000) list = candidates(c.preferred);
      function model(i) {
        if (i >= list.length) {
          if (lastErr && lastErr.status === 404 && skipped === list.length && !repicked) { repicked = true; return ensureModel(true).then(function (m) { list = candidates(m); return model(0); }); }
          if (busyCount && lastErr && !lastErr.net) lastErr.allBusy = true;
          lastErr = lastErr || new Error("AI se jawab nahi mila"); lastErr.details = String(log);
          // last resort when every model failed on the full request: one quick pass without the tool list (plain chat still works)
          if (lastErr.allBusy && body.tools && !opts.lean) {
            say("Simple mode try kar raha hoon…"); var lean = Object.assign({}, body); delete lean.tools; delete lean.toolConfig;
            var firstErr = lastErr;
            return callGemini(lean, { onProgress: say, lean: true, attempts: 1 }).then(function (j) { lastUsed.lean = true; return j; }, function () { throw firstErr; });
          }
          throw lastErr;
        }
        var m = list[i];
        if (i > 0) say("Google busy hai, dusra model try kar raha hoon… (" + m + ")");
        function attempt(n) {
          lastUsed.tries++;
          return tryOnce(m, c.key, body).then(function (j) {
            lastUsed.model = m; lastUsed.fellBack = (m !== list[0]) || i > 0;
            if (cfg().model !== m) setCfg({ model: m, fallbackAt: Date.now() });
            return j;
          }, function (e) {
            lastErr = e; logFail(log, m, e);
            if (e.net) {                       // no connection / timeout: other models will not help if the network is down
              if (n < maxTry && navigator.onLine !== false && Date.now() - t0 < TOTAL_BUDGET) { say("Connection slow hai, dobara try kar raha hoon… (" + (n + 1) + "/" + maxTry + ")"); return sleep(DELAYS[n - 1] || 2500).then(function () { return attempt(n + 1); }); }
              if (e.timeout && i + 1 < list.length && Date.now() - t0 < TOTAL_BUDGET) { busyCount++; return model(i + 1); }
              e.details = String(log); throw e;
            }
            if (isQuota(e.status, e.message)) { e.quota = true; e.details = String(log); throw e; }   // real limit: do not hammer other models
            if (e.status === 404 || (e.status === 400 && /model/i.test(e.message) && !/api key/i.test(e.message))) { skipped++; if (e.status === 404) markDead(m); return model(i + 1); }
            if (isOverload(e.status, e.message)) {
              busyCount++;
              if (Date.now() - t0 > TOTAL_BUDGET) { e.allBusy = true; e.details = String(log); throw e; }
              if (n < maxTry) { say("Google busy hai, dobara try kar raha hoon… (" + (n + 1) + "/" + maxTry + ")"); return sleep(DELAYS[n - 1] || 2500).then(function () { return attempt(n + 1); }); }
              return model(i + 1);
            }
            e.details = String(log); throw e;                           // 400 bad key, 403, anything else: show it as it is
          });
        }
        return attempt(1);
      }
      return model(0);
    });
  }

  /* ---------- data snapshot sent with every chat ---------- */
  function todayStr() { var d = new Date(); return B.ymd(d) + " (" + B.DAYS[d.getDay()] + ")"; }
  function compact(it) {
    var o = { id: it.id, type: it.type, title: B.titleOf(it) };
    ["kind", "status", "date", "deadline", "platform", "category", "mode", "company", "project", "contact"].forEach(function (k) { if (it[k]) o[k] = it[k]; });
    if (it.amount != null && it.amount !== "") o.amount = +it.amount; if (it.rate !== "" && it.rate != null) o.rate = it.rate;
    if (it.fav) o.fav = true; if (it.sample) o.sample = true;
    return o;
  }
  function snapshot() {
    var db = B.db, today = B.ymd(new Date()), mk = B.monthKey(new Date());
    var t = B.paisa ? B.paisa.totals(mk) : {};
    var clientsAll = db.items.filter(function (i) { return i.type === "client"; }).map(function (c) { var o = compact(c); var p = B.clientPending(c.name).sum; if (p) o.pending = p; return o; });
    var postsAll = db.items.filter(function (i) { return i.type === "post" && (!i.date || i.date >= B.addDays(-7)); }).sort(function (a, b) { return (a.date || "z") < (b.date || "z") ? -1 : 1; });
    var moneyAll = db.items.filter(function (i) { return (i.type === "income" || i.type === "expense") && (i.status === "pending" || B.monthKey(i.date) === mk); });
    var recentAll = db.items.filter(function (i) { return ["note", "video"].indexOf(i.type) > -1; }).sort(function (a, b) { return b.updatedAt < a.updatedAt ? -1 : 1; });
    var counts = {}; db.items.forEach(function (i) { counts[i.type] = (counts[i.type] || 0) + 1; });
    // normal sizes first; if the JSON is still big (a lot of data), shrink the lists so requests stay small
    var levels = [[60, 25, 40, 25], [30, 15, 20, 10], [15, 8, 10, 5], [8, 4, 5, 3]], out = "";
    for (var k = 0; k < levels.length; k++) {
      var L = levels[k];
      out = JSON.stringify({ today: today, user: db.settings.displayName, studio: db.settings.studioName, monthly_goal: db.settings.goal || 0,
        this_month: { month: mk, kamaya: t.income, kharcha: t.expense, bacha: t.saved, pending: t.pending }, counts: counts,
        clients: clientsAll.slice(0, L[0]), calendar: postsAll.slice(0, L[1]).map(compact), money_this_month_and_pending: moneyAll.slice(0, L[2]).map(compact), recent_notes_and_videos: recentAll.slice(0, L[3]).map(compact) });
      if (out.length <= SNAP_MAX) break;
    }
    return out;
  }
  function systemText() {
    return [
      "Tum 'Bhav AI' ho — Bhavnote app ke andar ka assistant. User: " + (B.db.settings.displayName || "Bhavesh") + ", ek independent video editor aur creator (India). Studio: " + (B.db.settings.studioName || "") + ".",
      "Hamesha chhota, friendly Hinglish (Roman Hindi + English) mein jawab do, jaise WhatsApp pe dost. Emoji kam. Paisa ₹ (INR) mein, Indian format.",
      "Aaj ki date: " + todayStr() + ", timezone IST. 'kal', 'parso', 'agle Monday' jaisi dates aaj ke hisaab se YYYY-MM-DD mein badlo.",
      "App ka data tools se padho aur badlo. Kabhi ID guess mat karo — pehle search_items ya snapshot dekho. Ek message mein kai kaam ho sakte hain: sab tools call karo, phir ek chhota summary do ki kya kiya.",
      "Delete ya edit ke liye seedha tool call karo — app khud user se confirm karwayega. Add karne wale kaam turant karo (user ke paas Undo hai).",
      "UPI / payment screenshot: payer ka naam, ₹ amount, date, UTR/transaction id nikaalo aur add_income (status paid, mode upi, note mein UTR) call karo. Agar naam kisi existing client se match kare toh wahi naam use karo.",
      "Client chat ka screenshot ya client ka message: changes/requirements ki checklist banao aur add_note (kind note, body mein '- [ ] ...' lines, title 'Changes: <client>') call karo. Naya kaam/project ho toh add_client (agar client pehle se nahi hai) ya update_item se project/deadline/rate set karo, aur zarurat ho toh add_calendar_video.",
      "Reel Factory: jab user topic de aur reel/video idea maange, show_reel_pack call karo: 5 hooks, poori script (time-coded), caption, hashtags, thumbnail text. User card se calendar mein save karega.",
      "Weekly / Sunday report: get_summary se numbers lo, phir batao: kitna kamaya, kharcha, kya faltu kharcha laga, kitni reels post hui, kaun late payer hai, agle hafte ke 2-3 tips.",
      "Payment reminder ke liye make_reminder_message. Kisi section pe le jaana ho toh open_section.",
      "App data abhi (JSON): " + snapshot()
    ].join("\n");
  }

  /* ---------- tools ---------- */
  var S = "STRING", N = "NUMBER";
  function obj(props, req) { return { type: "OBJECT", properties: props, required: req || [] }; }
  var TOOLS = [
    { name: "get_summary", description: "Month ya last 7 din ka summary: kamaya, kharcha, bacha, pending, category-wise kharcha, posts by status, late payers.", parameters: obj({ period: { type: S, description: "'week' (last 7 days) ya 'YYYY-MM' month. Default current month." } }) },
    { name: "search_items", description: "App mein kuch bhi dhundo (notes, videos, clients, income, expense, calendar posts). IDs yahin se milte hain.", parameters: obj({ query: { type: S }, type: { type: S, enum: ["any", "note", "video", "client", "post", "income", "expense"] } }, ["query"]) },
    { name: "get_item", description: "Ek item ki poori detail (script, notes waghera).", parameters: obj({ id: { type: S } }, ["id"]) },
    { name: "add_note", description: "Naya note. kind: note, technique, style, reference, idea.", parameters: obj({ title: { type: S }, body: { type: S }, kind: { type: S, enum: ["note", "technique", "style", "reference", "idea"] }, tags: { type: "ARRAY", items: { type: S } } }, ["title"]) },
    { name: "add_income", description: "Income / payment entry. status paid (mil gaya) ya pending (aana baaki).", parameters: obj({ source: { type: S, description: "Client ya source ka naam" }, amount: { type: N }, date: { type: S, description: "YYYY-MM-DD" }, mode: { type: S, enum: ["upi", "cash", "bank"] }, status: { type: S, enum: ["paid", "pending"] }, note: { type: S } }, ["source", "amount"]) },
    { name: "add_expense", description: "Kharcha entry. category: software, gear, internet, food, travel, other ya koi custom word.", parameters: obj({ title: { type: S }, amount: { type: N }, date: { type: S }, category: { type: S }, note: { type: S } }, ["amount"]) },
    { name: "add_client", description: "Naya client / project. status: lead, active, review, delivered, paused.", parameters: obj({ name: { type: S }, company: { type: S }, project: { type: S }, contact: { type: S, description: "phone ya email" }, deadline: { type: S, description: "YYYY-MM-DD" }, rate: { type: N }, rate_unit: { type: S, enum: ["project", "video", "month", "day", "hour"] }, status: { type: S, enum: ["lead", "active", "review", "delivered", "paused"] }, notes: { type: S } }, ["name"]) },
    { name: "add_calendar_video", description: "Content calendar mein video/reel plan. platform reel, yt, shorts. status idea, script, shoot, edit, posted.", parameters: obj({ title: { type: S }, date: { type: S, description: "YYYY-MM-DD" }, platform: { type: S, enum: ["reel", "yt", "shorts"] }, status: { type: S, enum: ["idea", "script", "shoot", "edit", "posted"] }, hook: { type: S }, script: { type: S }, caption: { type: S }, hashtags: { type: S }, notes: { type: S } }, ["title"]) },
    { name: "add_youtube_link", description: "YouTube Store mein video link save karo.", parameters: obj({ url: { type: S }, title: { type: S }, category: { type: S, enum: ["tutorial", "reference", "inspiration", "client", "music", "other"] }, notes: { type: S } }, ["url"]) },
    { name: "update_item", description: "Existing item badlo (user confirm karega). Sirf jo fields badalni hain wahi bhejo.", parameters: obj({ id: { type: S }, title: { type: S }, status: { type: S }, date: { type: S }, deadline: { type: S }, amount: { type: N }, rate: { type: N }, project: { type: S }, notes: { type: S }, body: { type: S }, category: { type: S }, platform: { type: S }, hook: { type: S }, script: { type: S }, caption: { type: S }, hashtags: { type: S }, contact: { type: S }, mode: { type: S }, source: { type: S } }, ["id"]) },
    { name: "update_status", description: "Sirf status badlo: post (idea/script/shoot/edit/posted), client (lead/active/review/delivered/paused), income (paid/pending).", parameters: obj({ id: { type: S }, status: { type: S } }, ["id", "status"]) },
    { name: "delete_item", description: "Item delete karo (user confirm karega).", parameters: obj({ id: { type: S } }, ["id"]) },
    { name: "open_section", description: "App ka section kholo.", parameters: obj({ section: { type: S, enum: ["dashboard", "notes", "calendar", "paisa", "clients", "youtube", "favorites", "settings"] } }, ["section"]) },
    { name: "make_reminder_message", description: "Client ko polite Hinglish payment reminder (WhatsApp button ke saath).", parameters: obj({ client_name: { type: S }, amount: { type: N, description: "optional; default client ka total pending" } }, ["client_name"]) },
    { name: "set_monthly_goal", description: "Monthly kamai ka target (₹) set karo.", parameters: obj({ amount: { type: N } }, ["amount"]) },
    { name: "show_reel_pack", description: "Reel Factory: user ko hooks + script + caption + hashtags + thumbnail text ka card dikhao (calendar mein save button ke saath).", parameters: obj({ topic: { type: S }, platform: { type: S, enum: ["reel", "yt", "shorts"] }, hooks: { type: "ARRAY", items: { type: S } }, script: { type: S }, caption: { type: S }, hashtags: { type: S }, thumbnail_text: { type: S } }, ["topic", "hooks", "script"]) }
  ];
  function num(v) { var n = +String(v == null ? "" : v).replace(/[₹,\s]/g, ""); return isNaN(n) ? 0 : n; }
  function dateOr(v, d) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? v : d; }
  function addItem(type, o) {
    var ts = B.now(); var it = Object.assign({ id: B.uid(), type: type, tags: [], fav: false, createdAt: ts, updatedAt: ts }, o);
    B.db.items.push(it); B.save(); return it;
  }
  function weekSummary(from, to) {
    var r = { from: from, to: to, kamaya: 0, kharcha: 0, pending_new: 0, cats: {}, posted: 0, planned: 0, posts: [] };
    B.db.items.forEach(function (it) {
      var d = it.date || ""; if (!d || d < from || d > to) return;
      if (it.type === "income") { if (it.status === "pending") r.pending_new += +it.amount || 0; else r.kamaya += +it.amount || 0; }
      if (it.type === "expense") { r.kharcha += +it.amount || 0; var c = it.category || "other"; r.cats[c] = (r.cats[c] || 0) + (+it.amount || 0); }
      if (it.type === "post") { r.planned++; if (it.status === "posted") { r.posted++; r.posts.push(it.title); } }
    });
    var today = B.ymd(new Date());
    r.late_payers = B.db.items.filter(function (it) { return it.type === "income" && it.status === "pending" && it.date && it.date < today; }).map(function (it) { return { name: it.source, amount: +it.amount || 0, due: it.date }; });
    r.bacha = r.kamaya - r.kharcha;
    return r;
  }
  function summary(period) {
    if (period === "week") return weekSummary(B.addDays(-6), B.ymd(new Date()));
    var mk = /^\d{4}-\d{2}$/.test(period || "") ? period : B.monthKey(new Date());
    var t = B.paisa.totals(mk); var st = {};
    B.db.items.forEach(function (it) { if (it.type === "post" && B.monthKey(it.date) === mk) st[it.status] = (st[it.status] || 0) + 1; });
    return { month: mk, kamaya: t.income, kharcha: t.expense, bacha: t.saved, pending_this_month: t.pending, kharcha_by_category: t.cats, goal: B.db.settings.goal || 0,
      posts_by_status: st, pending_by_client: B.paisa.pendingByClient().map(function (p) { return { name: p.name, amount: p.sum }; }), late_payers: weekSummary("0000-01-01", "9999-12-31").late_payers };
  }
  function describe(it) { return (B.TYPES[it.type] ? B.TYPES[it.type].one : it.type) + ": “" + B.titleOf(it) + "”"; }

  function runTool(name, a) {
    var prev = B.actor; return B.asActor("ai", function () { return runTool0(name, a); });
  }
  function runTool0(name, a) {
    a = a || {}; var today = B.ymd(new Date());
    switch (name) {
      case "get_summary": return summary(a.period);
      case "search_items": {
        var q = String(a.query || "").toLowerCase().trim(), words = q.split(/\s+/).filter(Boolean);
        var hits = B.db.items.filter(function (it) { if (a.type && a.type !== "any" && it.type !== a.type) return false; var hs = B.haystack(it) + " " + (it.date || "") + " " + (it.amount || ""); return words.every(function (w) { return hs.indexOf(w) > -1; }); });
        return { count: hits.length, items: hits.slice(0, 15).map(compact) };
      }
      case "get_item": { var g = B.byId(a.id); if (!g) return { error: "not found" }; var c = Object.assign({}, g); delete c.sample; return c; }
      case "add_note": { var n = addItem("note", { title: a.title || "Note", body: a.body || "", kind: ["note", "technique", "style", "reference", "idea"].indexOf(a.kind) > -1 ? a.kind : "note", tags: Array.isArray(a.tags) ? B.parseTags(a.tags.join(",")) : [] }); done(n); return { ok: true, id: n.id }; }
      case "add_income": { var inc = addItem("income", { source: a.source || "Client", amount: num(a.amount), date: dateOr(a.date, today), mode: ["upi", "cash", "bank"].indexOf(a.mode) > -1 ? a.mode : "upi", status: a.status === "pending" ? "pending" : "paid", note: a.note || "" }); done(inc, INR.format(inc.amount)); return { ok: true, id: inc.id }; }
      case "add_expense": { var ex = addItem("expense", { title: a.title || "", amount: num(a.amount), date: dateOr(a.date, today), category: String(a.category || "other").toLowerCase(), note: a.note || "" }); done(ex, INR.format(ex.amount)); return { ok: true, id: ex.id }; }
      case "add_client": { var cl = addItem("client", { name: a.name, company: a.company || "", project: a.project || "", contact: a.contact || "", deadline: dateOr(a.deadline, ""), rate: a.rate == null ? "" : num(a.rate), rateUnit: a.rate_unit || "project", status: a.status || "active", notes: a.notes || "" }); done(cl); return { ok: true, id: cl.id }; }
      case "add_calendar_video": { var pv = addItem("post", { title: a.title, date: dateOr(a.date, today), platform: ["reel", "yt", "shorts"].indexOf(a.platform) > -1 ? a.platform : "reel", status: B.calendar.ST.indexOf(a.status) > -1 ? a.status : "idea", hook: a.hook || "", script: a.script || "", caption: a.caption || "", hashtags: a.hashtags || "", notes: a.notes || "" }); done(pv, B.fmtDate(pv.date)); return { ok: true, id: pv.id }; }
      case "add_youtube_link": { var yv = addItem("video", { url: a.url, title: a.title || "YouTube video", channel: "", category: a.category || "tutorial", notes: a.notes || "" }); done(yv); return { ok: true, id: yv.id }; }
      case "update_item": case "update_status": {
        var u = B.byId(a.id); if (!u) return { error: "id not found — search_items se sahi id lo" };
        var ch = {}; Object.keys(a).forEach(function (k) { if (k !== "id" && a[k] != null && a[k] !== "") ch[k === "rate_unit" ? "rateUnit" : k] = (k === "amount" || k === "rate") ? num(a[k]) : a[k]; });
        if (u.type === "income" && ch.title) { ch.source = ch.title; delete ch.title; }
        if (u.type === "client" && ch.title) { ch.name = ch.title; delete ch.title; }
        var lines = Object.keys(ch).map(function (k) { return k + ": " + String(u[k] == null || u[k] === "" ? "—" : u[k]).slice(0, 40) + " → " + String(ch[k]).slice(0, 60); });
        return askConfirm("Badal du? " + describe(u), lines.join("\n")).then(function (ok) {
          if (!ok) return { cancelled: true, message: "User ne mana kar diya" };
          B.asActor("ai", function () { Object.assign(u, ch, { updatedAt: B.now() }); delete u.sample; B.save(); }); done(u, "updated"); return { ok: true };
        });
      }
      case "delete_item": {
        var d = B.byId(a.id); if (!d) return { error: "id not found" };
        return askConfirm("Delete karu? " + describe(d), "Ye is phone se hat jayega.", true).then(function (ok) {
          if (!ok) return { cancelled: true };
          var idx = B.db.items.indexOf(d); B.asActor("ai", function () { B.db.items.splice(idx, 1); B.save(); }); note("🗑️ Deleted " + describe(d), "Undo", function () { B.db.items.splice(Math.min(idx, B.db.items.length), 0, d); B.save(); B.toast("Wapas aa gaya"); }); return { ok: true };
        });
      }
      case "open_section": { var sec = a.section === "home" ? "dashboard" : a.section; setTimeout(function () { location.hash = "#/" + sec; }, 900); return { ok: true }; }
      case "make_reminder_message": {
        var c2 = B.findClient(a.client_name); var nm = c2 ? c2.name : a.client_name; var pend = B.clientPending(nm);
        var amount = a.amount ? num(a.amount) : pend.sum; var txt = B.reminderText(nm, amount, pend.items.length === 1 ? pend.items[0].note : "");
        reminderCard(nm, txt, B.waLink(B.phoneOf(c2), txt)); return { ok: true, shown_to_user: true, message: txt, phone_found: !!B.phoneOf(c2) };
      }
      case "set_monthly_goal": { B.db.settings.goal = num(a.amount); B.save(); note("🎯 Monthly goal: " + INR.format(B.db.settings.goal)); return { ok: true }; }
      case "show_reel_pack": { reelCard(a); return { ok: true, shown_to_user: true }; }
    }
    return { error: "unknown tool " + name };
  }

  /* ---------- chat state + UI ---------- */
  var conv = [], log = [], chatId = null, chatCreated = null, busy = false, attach = null, rec = null, mediaRec = null;
  function loadChat() { try { var c = JSON.parse(localStorage.getItem(CHAT_KEY) || "null"); if (c) { conv = c.conv || []; log = c.log || []; chatId = c.id || null; chatCreated = c.createdAt || null; } } catch (e) {} if (!chatId) { chatId = B.uid(); chatCreated = B.now(); } }
  function chatTitle(lg) {
    for (var i = 0; i < lg.length; i++) if (lg[i].kind === "user") { var t = String(lg[i].text || "").replace(/\(Voice note[^)]*\)/, "🎙️ Voice note").replace(/📸 \(screenshot\)/, "📸 Screenshot").replace(/\s+/g, " ").trim(); if (!t && lg[i].img) t = "📸 Screenshot"; if (!t && lg[i].audio) t = "🎙️ Voice note"; return t.length > 46 ? t.slice(0, 44) + "…" : (t || "Chat"); }
    return "Chat";
  }
  var archiveSoon = B.debounce(function () { archiveNow(); }, 800);
  function archiveNow(lg, cv) {
    lg = lg || storedLog(); if (!lg.length) return Promise.resolve();
    return B.IDB.put("chats", { id: chatId, title: chatTitle(lg), createdAt: chatCreated || B.now(), updatedAt: B.now(), log: lg, conv: cv || storedConv(), n: lg.filter(function (m) { return m.kind === "user" || m.kind === "ai"; }).length }).catch(function () {});
  }
  function storedConv() {
    var strip = function (parts) { return (parts || []).map(function (p) { return p.inlineData ? { text: "[" + (/audio/.test(p.inlineData.mimeType) ? "voice note" : "image") + " attached earlier]" } : p; }); };
    var c = conv.slice(-30).map(function (m) { return { role: m.role, parts: strip(m.parts) }; });
    while (c.length && (c[0].role !== "user" || c[0].parts.some(function (p) { return p.functionResponse; }))) c.shift();
    return c;
  }
  function storedLog() { return log.slice(-80).map(function (m) { if (m.img) { m = Object.assign({}, m); delete m.img; m.text = (m.text ? m.text + "\n" : "") + "📸 (screenshot)"; } return m; }); }
  function newChat() { if (log.length) archiveNow(); conv = []; log = []; chatId = B.uid(); chatCreated = B.now(); saveChat(); }
  function listChats() { return B.IDB.all("chats").then(function (rows) { return rows.sort(function (a, b) { return b.updatedAt < a.updatedAt ? -1 : 1; }); }); }
  function openChat(id) {
    return B.IDB.get("chats", id).then(function (c) {
      if (!c) return; if (log.length && chatId !== id) archiveNow();
      conv = c.conv || []; log = c.log || []; chatId = c.id; chatCreated = c.createdAt; saveChat(); location.hash = "#/ai"; if (B.ui.route === "ai") B.render();
    });
  }
  function deleteChat(id) { return B.IDB.del("chats", id).then(function () { if (id === chatId) { conv = []; log = []; chatId = B.uid(); chatCreated = B.now(); saveChat(); } }); }
  function saveChat() {
    try { localStorage.setItem(CHAT_KEY, JSON.stringify({ id: chatId, createdAt: chatCreated, conv: storedConv(), log: storedLog() })); } catch (e) {}
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
  function push(m, persist) { if (persist !== false) log.push(m); var cb = $("#chatClear"); if (cb) cb.hidden = false; var f = feed(); if (f) { var e = $(".chat-empty", f); if (e) e.remove(); f.insertAdjacentHTML("beforeend", bubbleHtml(m)); scrollDown(); } saveChat(); }
  function scrollDown() { requestAnimationFrame(function () { window.scrollTo(0, document.documentElement.scrollHeight); }); }
  function note(text, action, fn) {
    var f = feed(); var id = "n" + B.uid();
    log.push({ kind: "note", text: text }); saveChat();
    if (!f) return;
    f.insertAdjacentHTML("beforeend", '<div class="msg-note" id="' + id + '">' + esc(text) + (action ? ' <button type="button" class="mini-btn">' + esc(action) + "</button>" : "") + "</div>");
    if (action) $("#" + id + " button").addEventListener("click", function (e) { e.currentTarget.disabled = true; fn(); });
    scrollDown();
  }
  function done(it, extra) {
    var label = { note: "Note", income: "Income", expense: "Kharcha", client: "Client", post: "Calendar", video: "Video" }[it.type] || "Item";
    var id = "d" + B.uid(); var text = "✓ " + label + ": " + B.titleOf(it) + (extra ? " · " + extra : "");
    log.push({ kind: "note", text: text }); saveChat();
    var f = feed(); if (!f) return;
    f.insertAdjacentHTML("beforeend", '<div class="msg-note done" id="' + id + '"><span>' + esc(text) + '</span><button type="button" class="mini-btn" data-open="' + esc(it.id) + '">Open</button>' + (extra === "updated" ? "" : '<button type="button" class="mini-btn" data-undo>Undo</button>') + "</div>");
    var u = $("#" + id + " [data-undo]"); if (u) u.addEventListener("click", function () { var i = B.db.items.indexOf(it); if (i > -1) { B.db.items.splice(i, 1); B.save(); } u.closest(".msg-note").classList.add("undone"); u.remove(); B.toast("Hata diya"); });
    scrollDown();
  }
  function askConfirm(title, detail, danger) {
    return new Promise(function (resolve) {
      var f = feed(); if (!f) { B.confirmBox(title, detail, [{ label: "Nahi", value: false }, { label: danger ? "Delete" : "Haan", value: true, cls: danger ? "btn-danger" : "btn-primary" }]).then(resolve); return; }
      var id = "c" + B.uid();
      f.insertAdjacentHTML("beforeend", '<div class="msg confirm" id="' + id + '"><p><b>' + esc(title) + "</b></p>" + (detail ? '<p class="cf-detail">' + esc(detail).replace(/\n/g, "<br>") + "</p>" : "") +
        '<div class="cf-actions"><button type="button" class="btn btn-ghost" data-v="0">Nahi</button><button type="button" class="btn ' + (danger ? "btn-danger" : "btn-primary") + '" data-v="1">' + (danger ? "Haan, delete" : "Haan, kar do") + "</button></div></div>");
      scrollDown();
      $$("#" + id + " [data-v]").forEach(function (b) { b.addEventListener("click", function () { var ok = b.getAttribute("data-v") === "1"; $$("#" + id + " button").forEach(function (x) { x.disabled = true; }); $("#" + id).classList.add(ok ? "yes" : "no"); resolve(ok); }); });
    });
  }
  function reminderCard(name, txt, link) {
    var html = '<div class="msg ai card-msg"><p class="cm-title">' + icon("i-chat") + "Reminder for " + esc(name) + '</p><p class="cm-body">' + esc(txt).replace(/\n/g, "<br>") + '</p><div class="cf-actions"><button type="button" class="mini-btn" data-copy-text="' + esc(txt) + '">' + icon("i-copy") + 'Copy</button><a class="btn btn-primary" href="' + esc(link) + '" target="_blank" rel="noopener">WhatsApp pe bhejo</a></div></div>';
    log.push({ kind: "html", html: html }); saveChat(); var f = feed(); if (f) { f.insertAdjacentHTML("beforeend", html); scrollDown(); }
  }
  function reelCard(a) {
    var id = "r" + B.uid(); var hooks = Array.isArray(a.hooks) ? a.hooks.slice(0, 5) : [];
    var html = '<div class="msg ai card-msg reel" id="' + id + '"><p class="cm-title">' + icon("i-spark") + "Reel Factory · " + esc(a.topic || "") + "</p>" +
      '<p class="cm-label">Hooks — ek chuno</p><div class="hook-list">' + hooks.map(function (h, i) { return '<label class="hook"><input type="radio" name="hk' + id + '" value="' + i + '"' + (i === 0 ? " checked" : "") + "><span>" + esc(h) + "</span></label>"; }).join("") + "</div>" +
      '<p class="cm-label">Script <button type="button" class="mini-btn" data-copy-text="' + esc(a.script || "") + '">' + icon("i-copy") + "Copy</button></p><pre class=\"cm-pre\">" + esc(a.script || "") + "</pre>" +
      (a.caption ? '<p class="cm-label">Caption <button type="button" class="mini-btn" data-copy-text="' + esc(a.caption) + '">' + icon("i-copy") + 'Copy</button></p><p class="cm-body">' + esc(a.caption) + "</p>" : "") +
      (a.hashtags ? '<p class="cm-label">Hashtags <button type="button" class="mini-btn" data-copy-text="' + esc(a.hashtags) + '">' + icon("i-copy") + 'Copy</button></p><p class="cm-body tags-p">' + esc(a.hashtags) + "</p>" : "") +
      (a.thumbnail_text ? '<p class="cm-label">Thumbnail text</p><p class="cm-thumb">' + esc(a.thumbnail_text) + "</p>" : "") +
      '<div class="cf-actions save-row"><input class="input" type="date" value="' + B.addDays(1) + '" aria-label="Post date"><button type="button" class="btn btn-primary" data-save-reel>' + icon("i-cal") + "Calendar mein save</button></div></div>";
    var f = feed(); if (f) { f.insertAdjacentHTML("beforeend", html); scrollDown(); bindReel(id, a); }
    log.push({ kind: "html", html: html.replace("data-save-reel", "disabled") }); saveChat();
  }
  function bindReel(id, a) {
    var box = $("#" + id); if (!box) return;
    $("[data-save-reel]", box).addEventListener("click", function (e) {
      var r = $("input[type=radio]:checked", box); var hk = (a.hooks || [])[r ? +r.value : 0] || "";
      var it = addItem("post", { title: a.topic || "Reel", date: dateOr($("input[type=date]", box).value, B.addDays(1)), platform: a.platform || "reel", status: "script", hook: hk, script: a.script || "", caption: a.caption || "", hashtags: a.hashtags || "", notes: a.thumbnail_text ? "Thumbnail: " + a.thumbnail_text : "" });
      e.currentTarget.disabled = true; e.currentTarget.textContent = "Saved ✓"; done(it, B.fmtDate(it.date));
    });
  }
  function setBusy(on, label) {
    busy = on; var t = $("#chatTyping"); if (t) { t.hidden = !on; if (label) $(".ty-label", t).textContent = label; }
    var s = $("#chatSend"); if (s) s.disabled = on;
    if (on) scrollDown();
  }

  function send(text, extraParts, shown) {
    if (busy) return;
    if (!hasKey()) { push({ kind: "user", text: text, img: shown && shown.img }); push({ kind: "err", text: "Pehle apni free Gemini API key daalo 🔑 Settings → Bhav AI (2 minute ka kaam, steps wahan likhe hain)." }); return; }
    if (!navigator.onLine) { push({ kind: "err", text: friendlyError() }); return; }
    var parts = []; if (text) parts.push({ text: text }); (extraParts || []).forEach(function (p) { parts.push(p); });
    if (!parts.length) return;
    push({ kind: "user", text: text, img: shown && shown.img, audio: shown && shown.audio });
    conv.push({ role: "user", parts: parts });
    setBusy(true, "Soch raha hoon…");
    leanNoted = false;
    loop(0).catch(function (e) { push({ kind: "err", text: friendlyError(e) }); conv.pop(); }).then(function () { setBusy(false); saveChat(); });
  }
  var leanNoted = false;
  // Keep each request small: only the newest image/voice note travels with the history, older ones become a short text mark.
  function lighten(contents) {
    var last = -1; contents.forEach(function (c, i) { if ((c.parts || []).some(function (p) { return p.inlineData; })) last = i; });
    return contents.map(function (c, i) {
      if (i === last || !(c.parts || []).some(function (p) { return p.inlineData; })) return c;
      return { role: c.role, parts: c.parts.map(function (p) { return p.inlineData ? { text: "[pehle bheji hui image/voice note]" } : p; }) };
    });
  }
  function loop(round) {
    if (round > 6) return Promise.resolve();
    var body = { systemInstruction: { parts: [{ text: systemText() }] }, contents: conv.slice(-24), tools: [{ functionDeclarations: TOOLS }], toolConfig: { functionCallingConfig: { mode: "AUTO" } }, generationConfig: { temperature: 0.6 } };
    // the history must start with a user turn that is not a function response
    body.contents = lighten(body.contents);
    while (body.contents.length && (body.contents[0].role !== "user" || body.contents[0].parts.some(function (p) { return p.functionResponse; }))) body.contents.shift();
    return callGemini(body, { onProgress: function (t) { setBusy(true, t); } }).then(function (j) {
      if (lastUsed.lean && !leanNoted) { leanNoted = true; note("AI ne bina data-tools ke jawab diya (Google ke models abhi bhari hain) — abhi sirf baat kar sakta hoon, app mein changes baad mein."); }
      var cand = (j.candidates || [])[0];
      if (!cand || !cand.content) { var why = (j.promptFeedback && j.promptFeedback.blockReason) || (cand && cand.finishReason) || "empty"; throw new Error("AI ne jawab nahi diya (" + why + ")"); }
      var content = { role: "model", parts: cand.content.parts || [] }; conv.push(content);
      var texts = content.parts.filter(function (p) { return p.text && !p.thought; }).map(function (p) { return p.text; }).join("\n").trim();
      var calls = content.parts.filter(function (p) { return p.functionCall; });
      if (texts) push({ kind: "ai", text: texts });
      if (!calls.length) { if (!texts) push({ kind: "ai", text: "Ho gaya 👍" }); return; }
      setBusy(true, "Kaam kar raha hoon…");
      var responses = [];
      return calls.reduce(function (p, c) {
        return p.then(function () { return Promise.resolve().then(function () { return runTool(c.functionCall.name, c.functionCall.args); }).catch(function (e) { return { error: String(e && e.message || e) }; })
          .then(function (res) { var fr = { name: c.functionCall.name, response: { result: res } }; if (c.functionCall.id) fr.id = c.functionCall.id; responses.push({ functionResponse: fr }); }); });
      }, Promise.resolve()).then(function () { conv.push({ role: "user", parts: responses }); setBusy(true, "Soch raha hoon…"); return loop(round + 1); });
    });
  }

  /* ---------- voice + image ---------- */
  function blobToB64(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(",")[1]); }; r.onerror = rej; r.readAsDataURL(blob); }); }
  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file); var img = new Image();
      img.onload = function () {
        var max = 1400, w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, max / Math.max(w, h));
        var cv = document.createElement("canvas"); cv.width = Math.round(w * s); cv.height = Math.round(h * s);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
        var data = cv.toDataURL("image/jpeg", 0.85); resolve({ data: data.split(",")[1], preview: data, mime: "image/jpeg" });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("image")); };
      img.src = url;
    });
  }
  function SR() { return window.SpeechRecognition || window.webkitSpeechRecognition; }
  function micState(on) { var m = $("#chatMic"); if (m) { m.classList.toggle("rec", on); m.setAttribute("aria-pressed", on); m.innerHTML = icon(on ? "i-stop" : "i-mic"); } var c = $("#chatInput"); if (c) c.placeholder = on ? "Sun raha hoon… bolo" : placeholder(); }
  function startVoice() {
    if (rec || mediaRec) { stopVoice(); return; }
    var Ctor = SR();
    if (Ctor) {
      try {
        rec = new Ctor(); rec.lang = "hi-IN"; rec.interimResults = true; rec.continuous = false; var finalText = "", gotAny = false;
        rec.onresult = function (e) { var t = ""; for (var i = 0; i < e.results.length; i++) { t += e.results[i][0].transcript; if (e.results[i].isFinal) finalText = t; } gotAny = true; $("#chatInput").value = t; };
        rec.onerror = function (e) { var r0 = rec; rec = null; micState(false); if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "network") { startRecorder(); } else if (e.error !== "no-speech" && e.error !== "aborted") B.toast("Mic: " + e.error); };
        rec.onend = function () { if (!rec) return; rec = null; micState(false); var v = ($("#chatInput").value || "").trim(); if (gotAny && v) { $("#chatInput").value = ""; autosize(); send(v); } };
        rec.start(); micState(true); return;
      } catch (e) { rec = null; }
    }
    startRecorder();
  }
  function startRecorder() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { B.toast("Is app mein mic support nahi mila. Chrome mein kholo ya type karo."); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var chunks = []; var mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].filter(function (m) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m); })[0] || "";
      mediaRec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      mediaRec.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); }); var type = (mediaRec && mediaRec.mimeType) || mime || "audio/webm"; mediaRec = null; micState(false);
        var blob = new Blob(chunks, { type: type }); if (blob.size < 1200) { B.toast("Kuch record nahi hua"); return; }
        blobToB64(blob).then(function (b64) { send("(Voice note — pehle samjho kya bola, phir uske hisaab se kaam karo)", [{ inlineData: { mimeType: type.split(";")[0], data: b64 } }], { audio: true }); });
      };
      mediaRec.start(); micState(true); B.toast("Recording… bolke dobara mic dabao");
      setTimeout(function () { if (mediaRec && mediaRec.state === "recording") mediaRec.stop(); }, 60000);
    }).catch(function (err) { micDenied(err); });
  }
  /* ---------- mic permission help ---------- */
  var MIC_SETTINGS = "Phone Settings → Apps → Bhavnote → Permissions → Microphone → Allow karo, phir app band karke dobara kholo.";
  function isDenied(err) { var n = err && (err.name || err.message || ""); return /NotAllowed|PermissionDenied|Security|denied|not-allowed/i.test(String(n)); }
  function askMic() { // asks the browser/WebView for the mic and lets go of it straight away
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject({ name: "NotSupported" });
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (st) { st.getTracks().forEach(function (t) { t.stop(); }); return true; });
  }
  function micDenied(err) {
    var msg;
    if (err && err.name === "NotFoundError") msg = "Is phone mein mic nahi mila 🎙";
    else if (err && err.name === "NotSupported") msg = "Is app mein mic support nahi mila. Chrome mein kholo ya type karo.";
    else if (!isDenied(err)) msg = "Mic start nahi hua (" + String((err && (err.name || err.message)) || "error").slice(0, 60) + ")";
    if (msg) { if (feed()) note(msg); else B.toast(msg); return; }
    if (feed()) note("Mic ki permission nahi mili 🎙 'Allow mic' dabao, phir jo popup aaye usme Allow karo.", "Allow mic", function () {
      askMic().then(function () { B.toast("Mic allow ho gaya ✅"); note("Mic allow ho gaya ✅ Ab mic button dabake bolo."); })
        .catch(function (e2) { note(isDenied(e2) ? "Abhi bhi band hai. " + MIC_SETTINGS : "Mic start nahi hua. Dobara try karo."); });
    }); else B.toast("Mic ki permission nahi mili. " + MIC_SETTINGS);
  }
  function stopVoice() { if (rec) { try { rec.stop(); } catch (e) {} } if (mediaRec && mediaRec.state === "recording") mediaRec.stop(); }
  function showAttach() {
    var box = $("#chatAttach"); if (!box) return;
    if (!attach) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false; box.innerHTML = '<img alt="Screenshot to send" src="' + attach.preview + '"><span>Screenshot ready</span><button type="button" class="icon-btn" id="attachX" aria-label="Remove screenshot">' + icon("i-x") + "</button>";
    $("#attachX").addEventListener("click", function () { attach = null; showAttach(); });
  }

  /* ---------- view ---------- */
  var QUICK = [
    ["i-image", "Payment screenshot", "pickImage", "Is UPI payment screenshot se income add kar do"],
    ["i-chat", "Client msg → Project", "fill", "Is client message se client + project + checklist bana do:\n\n"],
    ["i-spark", "Reel Factory", "fill", "Reel Factory: topic — "],
    ["i-rupee", "Is hafte ka report", "send", "Is hafte ka report do: kamaya, kharcha, faltu kharcha, reels, late payers"],
    ["i-cal", "Kal ka plan", "send", "Kal ke liye kya plan hai? Posts, deadlines, payments"],
    ["i-mic", "Bol ke batao", "voice", ""]
  ];
  function placeholder() { return hasKey() ? "Bolo ya likho…" : "Pehle Gemini key daalo"; }
  function render() {
    var h = '<div class="ai-head"><div><h1>Bhav AI</h1><p class="sub">' + (hasKey() ? "Notes, paisa, calendar, clients — bolo, main kar dunga." : "Free Gemini key daalo aur shuru karo.") + '</p></div>' +
      '<div class="head-actions"><button class="mini-btn" type="button" id="chatList">' + icon("i-history") + 'Chats</button><button class="mini-btn" type="button" id="chatClear"' + (log.length ? "" : " hidden") + ">+ Nayi</button></div></div>";
    h += '<div class="chat-feed" id="chatFeed" aria-live="polite">';
    if (!log.length) {
      h += '<div class="chat-empty">' + (hasKey() ? "" : '<div class="panel key-cta"><p><b>Bhav AI free hai</b> — bas apni Google Gemini API key chahiye (2 min).</p><a class="btn btn-primary" href="#/settings">Key set karo</a></div>') +
        '<p class="cm-label">Try karo</p><div class="quick">' + QUICK.map(function (q, i) { return '<button type="button" class="quick-btn" data-quick="' + i + '">' + icon(q[0]) + "<span>" + esc(q[1]) + "</span></button>"; }).join("") + "</div></div>";
    }
    h += log.map(bubbleHtml).join("");
    h += '</div><div class="typing" id="chatTyping" hidden><span class="dots3"><i></i><i></i><i></i></span><span class="ty-label">Soch raha hoon…</span></div>';
    h += '<form class="composer" id="chatForm" autocomplete="off"><div class="attach-prev" id="chatAttach" hidden></div><div class="comp-row">' +
      '<button type="button" class="icon-btn" id="chatImg" aria-label="Screenshot attach karo">' + icon("i-image") + '</button><input type="file" id="chatFile" accept="image/*" hidden>' +
      '<label class="sr-only" for="chatInput">Message</label><textarea id="chatInput" rows="1" placeholder="' + esc(placeholder()) + '" enterkeyhint="send"></textarea>' +
      '<button type="button" class="icon-btn" id="chatMic" aria-label="Bol ke batao" aria-pressed="false">' + icon("i-mic") + '</button>' +
      '<button type="submit" class="send-btn" id="chatSend" aria-label="Send">' + icon("i-send") + "</button></div></form>";
    return h;
  }
  function autosize() { var t = $("#chatInput"); if (!t) return; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 140) + "px"; }
  function after() {
    var f = $("#chatForm"), input = $("#chatInput");
    f.addEventListener("submit", function (e) {
      e.preventDefault(); var v = input.value.trim();
      if (!v && !attach) return;
      var parts = [], shown = {};
      if (attach) { parts.push({ inlineData: { mimeType: attach.mime, data: attach.data } }); shown.img = attach.preview; if (!v) v = "Is screenshot ko padho aur sahi action lo (payment ho toh income add karo, client chat ho toh changes ki checklist note banao)."; }
      input.value = ""; autosize(); attach = null; showAttach(); send(v, parts, shown);
    });
    input.addEventListener("input", autosize);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey && matchMedia("(pointer:fine)").matches) { e.preventDefault(); f.requestSubmit(); } });
    $("#chatImg").addEventListener("click", function () { $("#chatFile").click(); });
    $("#chatFile").addEventListener("change", function (e) { var file = e.target.files[0]; e.target.value = ""; if (!file) return; shrinkImage(file).then(function (a) { attach = a; showAttach(); input.focus(); }, function () { B.toast("Ye image khul nahi rahi"); }); });
    $("#chatMic").addEventListener("click", function () { if (!hasKey()) { B.toast("Pehle Settings mein Gemini key daalo"); return; } startVoice(); });
    var cl = $("#chatClear"); if (cl) cl.addEventListener("click", function () { newChat(); B.render(); });
    $("#chatList").addEventListener("click", function () { B.ui.histTab = "chats"; location.hash = "#/history"; });
    $$("[data-quick]").forEach(function (b) { b.addEventListener("click", function () {
      var q = QUICK[+b.getAttribute("data-quick")];
      if (q[2] === "send") send(q[3]);
      else if (q[2] === "fill") { input.value = q[3]; autosize(); input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
      else if (q[2] === "pickImage") { input.value = q[3]; $("#chatFile").click(); }
      else if (q[2] === "voice") { if (!hasKey()) { B.toast("Pehle Settings mein Gemini key daalo"); return; } startVoice(); }
    }); });
    if (busy) setBusy(true);
    scrollDown();
  }
  B.VIEWS.ai = { render: render, after: after };

  /* ---------- Settings panel ---------- */
  // tiny call through the same retry/fallback path; shows which model answered
  function runTest(st, okText) {
    return ensureModel(false).then(function () {
      return callGemini({ contents: [{ role: "user", parts: [{ text: "Sirf 'OK' likho." }] }] }, { onProgress: function (t) { st.textContent = t; } });
    }).then(function () {
      st.textContent = "✓ " + okText + " · jawab dene wala model: " + lastUsed.model + (lastUsed.fellBack ? " (pehla model busy tha, dusra chala)" : "");
      B.toast("Bhav AI ready ✨");
    }).catch(function (e) { st.textContent = friendlyError(e); });
  }
  function mountSettings(slot) {
    if (!slot) return; var c = cfg();
    slot.innerHTML = '<section class="panel" aria-labelledby="aiH"><h2 id="aiH">' + icon("i-spark") + ' Bhav AI (free)</h2>' +
      '<p>Bhav AI tumhari apni <b>Google Gemini API key</b> se chalta hai — free hai, aur key sirf isi phone mein save hoti hai (backup file mein bhi nahi jaati).</p>' +
      '<ol class="steps"><li><a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">aistudio.google.com/app/apikey</a> kholo, Google account se login karo</li><li><b>Create API key</b> / <b>Get API key</b> dabao</li><li>Key copy karo (AIza… se shuru hoti hai) aur neeche paste karke <b>Save</b> karo</li></ol>' +
      '<div class="field"><label for="aiKey">Gemini API key</label><div class="key-row"><input class="input" id="aiKey" type="password" autocomplete="off" spellcheck="false" placeholder="AIza…" value="' + esc(c.key || "") + '"><button type="button" class="icon-btn" id="aiShow" aria-label="Key dikhao">👁</button></div></div>' +
      '<div class="actions"><button class="btn btn-primary" type="button" id="aiSave">Save & test</button><button class="btn" type="button" id="aiTest">Test AI</button><button class="btn" type="button" id="aiMic">Mic check</button>' + (c.key ? '<button class="btn btn-danger-ghost" type="button" id="aiRemove">Key hatao</button>' : "") + "</div>" +
      '<p class="hint" id="aiStatus">' + (c.key ? "Key saved" + (c.model ? " · model: " + esc(c.model) : "") : "Abhi koi key nahi hai") + "</p></section>";
    $("#aiShow").addEventListener("click", function () { var k = $("#aiKey"); k.type = k.type === "password" ? "text" : "password"; });
    var rm = $("#aiRemove"); if (rm) rm.addEventListener("click", function () { setCfg({ key: "", model: "" }); B.toast("Key hata di"); B.render(); });
    $("#aiSave").addEventListener("click", function () {
      var key = ($("#aiKey").value || "").trim(); var st = $("#aiStatus");
      if (!key) { st.textContent = "Key paste karo"; return; }
      setCfg({ key: key, model: "" }); st.textContent = "Check kar raha hoon…";
      ensureModel(true).then(function () { return runTest(st, "Key chal rahi hai"); });
    });
    $("#aiTest").addEventListener("click", function () {
      var st = $("#aiStatus"); if (!hasKey()) { st.textContent = "Pehle key paste karke Save karo"; return; }
      var key = ($("#aiKey").value || "").trim(); if (key && key !== cfg().key) setCfg({ key: key, model: "", preferred: "", pickVer: 0 });
      st.textContent = "Test kar raha hoon…"; runTest(st, "AI chal raha hai");
    });
    $("#aiMic").addEventListener("click", function () {
      var st = $("#aiStatus"); st.textContent = "Mic check…";
      askMic().then(function () { st.textContent = "✓ Mic allowed hai 🎙"; B.toast("Mic theek hai ✅"); })
        .catch(function (e) { st.textContent = e && e.name === "NotFoundError" ? "Is phone mein mic nahi mila." : (isDenied(e) ? "Mic ki permission nahi mili. Phone ne popup dikhaya ho toh Allow dabao, dobara 'Mic check' dabao. Nahi aaye toh: " + MIC_SETTINGS : "Mic start nahi hua (" + String((e && (e.name || e.message)) || "error").slice(0, 60) + ")"); });
    });
  }

  window.BNAI = { mountSettings: mountSettings, runTool: runTool, pickModel: pickModel, cfg: cfg, callGemini: callGemini, friendlyError: friendlyError, lastUsed: function () { return lastUsed; }, _cfg: function (o) { if (o.delays) DELAYS = o.delays; if (o.timeout) TRY_TIMEOUT = o.timeout; }, snapshot: snapshot, lighten: lighten, hasKey: hasKey,
    listChats: listChats, openChat: openChat, deleteChat: deleteChat, newChat: newChat, md: md };
  loadChat();
  if (log.length) archiveSoon();
})();
