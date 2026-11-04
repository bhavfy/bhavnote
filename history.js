/* Bhavnote — History: activity timeline, Trash (30 days) and saved Bhav AI chats. Registers #/history. */
(function () {
  "use strict";
  var B = window.BN; if (!B) return;
  var esc = B.esc, icon = B.icon, $ = B.$, $$ = B.$$;
  var SECTIONS = [["all", "Sab"], ["note", "Notes"], ["post", "Calendar"], ["client", "Clients"], ["money", "Paisa"], ["video", "Videos"], ["settings", "Settings"], ["ai", "AI"]];
  var TYPE_LABEL = { note: "Note", post: "Calendar", client: "Client", income: "Income", expense: "Kharcha", video: "Video", settings: "Settings", book: "Book" };
  var ACT = { create: ["Add kiya", "i-plus"], edit: ["Badla", "i-note"], delete: ["Delete kiya", "i-trash"], restore: ["Wapas laaya", "i-restore"], import: ["Import", "i-upload"] };
  var KEY_LABEL = { status: "Status", title: "Title", name: "Name", source: "Client", amount: "₹", date: "Date", deadline: "Deadline", fav: "Star", body: "Body", notes: "Notes", hook: "Hook", script: "Script", caption: "Caption", hashtags: "Hashtags", category: "Category", platform: "Platform", rate: "Rate", project: "Project", mode: "Mode", note: "Note", kind: "Kind", tags: "Tags", displayName: "Naam", studioName: "Studio", goal: "Goal", link: "Link", url: "URL", contact: "Contact", company: "Company", paidOn: "Paid on" };
  function st() { if (!B.ui.histTab) B.ui.histTab = "timeline"; if (!B.ui.histFilter) B.ui.histFilter = "all"; if (B.ui.histQ == null) B.ui.histQ = ""; return B.ui; }
  function dayKey(iso) { return B.ymd(new Date(iso)); }
  function dayName(k) { var t = B.ymd(new Date()); if (k === t) return "Aaj"; if (k === B.addDays(-1)) return "Kal"; var p = k.split("-"); return B.DAYS[new Date(+p[0], +p[1] - 1, +p[2]).getDay()].slice(0, 3) + ", " + (+p[2]) + " " + B.MON[+p[1] - 1] + (p[0] === String(new Date().getFullYear()) ? "" : " " + p[0]); }
  function timeOf(iso) { var d = new Date(iso); if (isNaN(d)) return ""; var h = d.getHours(), m = d.getMinutes(); return (h % 12 || 12) + ":" + (m < 10 ? "0" : "") + m + " " + (h < 12 ? "am" : "pm"); }
  function matchesFilter(e, f) {
    if (f === "all") return true; if (f === "ai") return e.by === "ai";
    if (f === "money") return e.type === "income" || e.type === "expense"; return e.type === f;
  }
  function render() {
    var u = st();
    var h = '<div class="page-head"><div><h1>History</h1><p class="sub">Jo bhi kiya — sab yahan. Delete hua toh Trash se wapas lao.</p></div></div>';
    h += '<div class="seg" role="tablist">' + [["timeline", "Timeline"], ["trash", "Trash"], ["chats", "AI chats"]].map(function (t) { return '<button type="button" role="tab" class="seg-btn" data-htab="' + t[0] + '" aria-selected="' + (u.histTab === t[0]) + '">' + t[1] + "</button>"; }).join("") + "</div>";
    h += '<div class="filter-search hist-search">' + icon("i-search") + '<label class="sr-only" for="hq">Search history</label><input class="input" id="hq" type="search" placeholder="' + (u.histTab === "chats" ? "Chats mein dhundo…" : u.histTab === "trash" ? "Trash mein dhundo…" : "History mein dhundo…") + '" value="' + esc(u.histQ) + '"></div>';
    if (u.histTab === "timeline") h += '<div class="chips hist-chips" role="group" aria-label="Section">' + SECTIONS.map(function (s) { return '<button type="button" class="chip" data-hf="' + s[0] + '" aria-pressed="' + (u.histFilter === s[0]) + '">' + s[1] + "</button>"; }).join("") + "</div>";
    h += '<div id="histBody"><p class="muted-p" style="padding:20px 4px">Load ho raha hai…</p></div>';
    return h;
  }
  var shown = 150, cache = null;
  function fill() {
    var u = st(), body = $("#histBody"); if (!body) return;
    var q = (u.histQ || "").toLowerCase().trim();
    if (u.histTab === "timeline") {
      B.IDB.all("events").then(function (evs) {
        evs.reverse(); cache = evs;
        var list = evs.filter(function (e) { if (!matchesFilter(e, u.histFilter)) return false; if (!q) return true; return (e.title + " " + (e.changes || []).map(function (c) { return c.k + " " + c.from + " " + c.to; }).join(" ") + " " + (TYPE_LABEL[e.type] || "")).toLowerCase().indexOf(q) > -1; });
        if (!list.length) { body.innerHTML = B.emptyBox(q || u.histFilter !== "all" ? "Kuch nahi mila" : "Abhi koi history nahi", q ? "Dusra word try karo." : "Jo bhi add, edit ya delete karoge, yahan dikhega.", null); return; }
        var h = "", last = "";
        list.slice(0, shown).forEach(function (e) {
          var dk = dayKey(e.at); if (dk !== last) { if (last) h += "</div>"; h += '<h3 class="day-h">' + esc(dayName(dk)) + '</h3><div class="list hist-list">'; last = dk; }
          var a = ACT[e.action] || ACT.edit; var exists = e.itemId && B.byId(e.itemId);
          var ch = (e.changes || []).slice(0, 3).map(function (c) { return (KEY_LABEL[c.k] || c.k) + ": " + c.from + " → " + c.to; }).join(" · ");
          h += '<' + (exists ? 'button type="button" data-open="' + esc(e.itemId) + '"' : "div") + ' class="list-item hist-row"><span class="li-icon act-' + esc(e.action) + '">' + icon(a[1]) + '</span><span class="li-main"><span class="li-title">' + esc(e.title || "Untitled") + '</span><span class="li-sub">' +
            esc((TYPE_LABEL[e.type] || e.type) + " · " + a[0] + (ch ? " · " + ch : "")) + '</span></span><span class="hist-side">' + (e.by === "ai" ? '<span class="ai-tag">AI</span>' : "") + "<small>" + esc(timeOf(e.at)) + "</small></span></" + (exists ? "button" : "div") + ">";
        });
        h += "</div>";
        if (list.length > shown) h += '<div class="more-row"><button type="button" class="btn" id="histMore">Aur dikhao (' + (list.length - shown) + ")</button></div>";
        body.innerHTML = h;
        var m = $("#histMore"); if (m) m.addEventListener("click", function () { shown += 200; fill(); });
      }).catch(function () { body.innerHTML = B.emptyBox("History load nahi hui", "Is browser mein storage band hai.", null); });
    } else if (u.histTab === "trash") {
      B.IDB.all("trash").then(function (rows) {
        rows.sort(function (a, b) { return b.at < a.at ? -1 : 1; });
        rows = rows.filter(function (r) { return !q || (B.titleOf(r.item) + " " + B.bodyOf(r.item)).toLowerCase().indexOf(q) > -1; });
        if (!rows.length) { body.innerHTML = B.emptyBox("Trash khaali hai", "Delete ki hui cheezein 30 din tak yahan rehti hain.", null); return; }
        var h = '<p class="muted-p trash-note">30 din baad apne aap hat jaati hain.</p><div class="list">';
        rows.forEach(function (r) {
          var left = Math.max(0, 30 - Math.floor((Date.now() - new Date(r.at).getTime()) / 86400000));
          h += '<div class="list-item hist-row"><span class="li-icon">' + icon("i-trash") + '</span><span class="li-main"><span class="li-title">' + esc(B.titleOf(r.item)) + '</span><span class="li-sub">' + esc((TYPE_LABEL[r.item.type] || r.item.type) + " · deleted " + B.ago(r.at) + " · " + left + " din baaki" + (r.by === "ai" ? " · by AI" : "")) +
            '</span></span><button type="button" class="mini-btn" data-restore="' + esc(r.id) + '">' + icon("i-restore") + 'Restore</button><button type="button" class="icon-btn sm" data-purge="' + esc(r.id) + '" aria-label="Hamesha ke liye delete">' + icon("i-x") + "</button></div>";
        });
        body.innerHTML = h + "</div>";
        $$("[data-restore]", body).forEach(function (b) { b.addEventListener("click", function () { var r = rows.filter(function (x) { return x.id === b.getAttribute("data-restore"); })[0]; if (!r) return; B.restoreFromTrash(r).then(function () { B.toast("“" + B.titleOf(r.item) + "” wapas aa gaya ✓"); fill(); }); }); });
        $$("[data-purge]", body).forEach(function (b) { b.addEventListener("click", function () { B.confirmBox("Hamesha ke liye delete?", "Ye wapas nahi aayega.", [{ label: "Nahi", value: false }, { label: "Delete", value: true, cls: "btn-danger" }]).then(function (ok) { if (ok) B.IDB.del("trash", b.getAttribute("data-purge")).then(fill); }); }); });
      });
    } else {
      if (!window.BNAI) { body.innerHTML = ""; return; }
      window.BNAI.listChats().then(function (rows) {
        rows = rows.filter(function (c) { if (!q) return true; return (c.title + " " + (c.log || []).map(function (m) { return m.text || ""; }).join(" ")).toLowerCase().indexOf(q) > -1; });
        var h = '<div class="more-row left"><button type="button" class="btn btn-primary" id="chatNew">' + icon("i-plus") + "Nayi chat</button></div>";
        if (!rows.length) { body.innerHTML = h + B.emptyBox(q ? "Koi chat nahi mili" : "Abhi koi chat nahi", "Bhav AI se baat karoge toh har chat yahan save hogi.", null); bindNew(); return; }
        h += '<div class="list">';
        rows.forEach(function (c) { h += '<div class="list-item hist-row"><button type="button" class="as-link chat-open" data-chat="' + esc(c.id) + '"><span class="li-title">' + esc(c.title || "Chat") + '</span><span class="li-sub">' + esc(B.ago(c.updatedAt) + " · " + (c.n || 0) + " messages") + '</span></button><button type="button" class="mini-btn" data-chat="' + esc(c.id) + '">Continue</button><button type="button" class="icon-btn sm" data-chatdel="' + esc(c.id) + '" aria-label="Chat delete karo">' + icon("i-trash") + "</button></div>"; });
        body.innerHTML = h + "</div>"; bindNew();
        $$("[data-chat]", body).forEach(function (b) { b.addEventListener("click", function () { window.BNAI.openChat(b.getAttribute("data-chat")); }); });
        $$("[data-chatdel]", body).forEach(function (b) { b.addEventListener("click", function () { B.confirmBox("Ye chat delete karu?", "", [{ label: "Nahi", value: false }, { label: "Delete", value: true, cls: "btn-danger" }]).then(function (ok) { if (ok) window.BNAI.deleteChat(b.getAttribute("data-chatdel")).then(fill); }); }); });
      });
    }
  }
  function bindNew() { var n = $("#chatNew"); if (n) n.addEventListener("click", function () { window.BNAI.newChat(); location.hash = "#/ai"; }); }
  function after() {
    shown = 150; fill();
    $$("[data-htab]").forEach(function (b) { b.addEventListener("click", function () { B.ui.histTab = b.getAttribute("data-htab"); B.ui.histQ = ""; B.render(); }); });
    $$("[data-hf]").forEach(function (b) { b.addEventListener("click", function () { B.ui.histFilter = b.getAttribute("data-hf"); $$("[data-hf]").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); shown = 150; fill(); }); });
    $("#hq").addEventListener("input", B.debounce(function () { B.ui.histQ = $("#hq").value; shown = 150; fill(); }, 160));
  }
  B.VIEWS.history = { render: render, after: after };
})();
