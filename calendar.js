/* Bhavnote — Content Calendar. Registers the #/calendar view. */
(function () {
  "use strict";
  var B = window.BN; if (!B) return;
  var esc = B.esc, icon = B.icon;
  var ST = B.TYPES.post.opts; // idea → script → shoot → edit → posted
  var ST_LABEL = { idea: "Idea", script: "Script", shoot: "Shoot", edit: "Edit", posted: "Posted" };
  function today() { return B.ymd(new Date()); }
  function calMonth() { if (!B.ui.calMonth) B.ui.calMonth = B.monthKey(new Date()); return B.ui.calMonth; }
  function calDate() { if (!B.ui.calDate) B.ui.calDate = today(); return B.ui.calDate; }
  function shiftMonth(mk, d) { var p = mk.split("-"); return B.monthKey(new Date(+p[0], +p[1] - 1 + d, 1)); }
  function monthLabel(mk) { var p = mk.split("-"); return B.MONTHS[+p[1] - 1] + " " + p[0]; }
  function dayLabel(d) { var p = d.split("-"); return B.DAYS[new Date(+p[0], +p[1] - 1, +p[2]).getDay()] + ", " + (+p[2]) + " " + B.MON[+p[1] - 1]; }
  function posts() { return B.db.items.filter(function (it) { return it.type === "post"; }); }
  function byDate() { var m = {}; posts().forEach(function (p) { if (!p.date) return; (m[p.date] = m[p.date] || []).push(p); }); return m; }
  function postRow(p) {
    var i = ST.indexOf(p.status), next = ST[i + 1];
    return '<article class="post-row"><div class="post-top"><span class="dot st-' + esc(p.status) + '"></span><button type="button" class="post-title" data-open="' + esc(p.id) + '">' + esc(p.title || "Untitled") + '</button><span class="badge">' + esc(B.PLATFORM_LABEL[p.platform] || "") + "</span></div>" +
      (p.hook ? '<p class="post-hook">“' + esc(p.hook) + "”</p>" : "") +
      '<div class="post-actions"><span class="badge st-b-' + esc(p.status) + '">' + esc(ST_LABEL[p.status] || p.status) + "</span>" +
      (next ? '<button type="button" class="mini-btn" data-advance="' + esc(p.id) + '">' + icon("i-arrow") + esc(ST_LABEL[next]) + "</button>" : "") +
      (p.caption ? '<button type="button" class="mini-btn" data-copy-text="' + esc(p.caption) + '">' + icon("i-copy") + "Caption</button>" : "") +
      (p.hashtags ? '<button type="button" class="mini-btn" data-copy-text="' + esc(p.hashtags) + '">' + icon("i-copy") + "#Tags</button>" : "") +
      (p.script ? '<button type="button" class="mini-btn" data-copy-text="' + esc(p.script) + '">' + icon("i-copy") + "Script</button>" : "") +
      "</div></article>";
  }
  function render() {
    var mk = calMonth(), sel = calDate(), t = today(), map = byDate();
    var h = '<div class="page-head"><div><h1>Calendar</h1><p class="sub">Reel, YouTube, Shorts — idea se post tak.</p></div>' +
      '<button class="btn btn-primary" type="button" data-newpost="' + esc(sel) + '">' + icon("i-plus") + "New video</button></div>";
    h += '<section class="panel cal" aria-label="Calendar"><div class="month-bar"><button class="icon-btn" type="button" data-cm="-1" aria-label="Pichla mahina">' + icon("i-chev-l") + '</button><h2 class="month-name">' + esc(monthLabel(mk)) + '</h2><button class="icon-btn" type="button" data-cm="1" aria-label="Agla mahina">' + icon("i-chev-r") + "</button></div>";
    h += '<div class="cal-grid" role="grid"><div class="cal-wd" role="row">' + ["M", "T", "W", "T", "F", "S", "S"].map(function (d) { return '<span role="columnheader">' + d + "</span>"; }).join("") + "</div><div class=\"cal-days\">";
    var p = mk.split("-"), first = new Date(+p[0], +p[1] - 1, 1), lead = (first.getDay() + 6) % 7, days = new Date(+p[0], +p[1], 0).getDate();
    var cells = Math.ceil((lead + days) / 7) * 7;
    for (var i = 0; i < cells; i++) {
      var d = new Date(+p[0], +p[1] - 1, 1 - lead + i), ds = B.ymd(d), inM = d.getMonth() === +p[1] - 1, list = map[ds] || [];
      var dots = list.slice(0, 4).map(function (x) { return '<i class="dot st-' + esc(x.status) + '"></i>'; }).join("");
      h += '<button type="button" class="cal-day' + (inM ? "" : " out") + (ds === t ? " today" : "") + (ds === sel ? " sel" : "") + '" data-day="' + ds + '" aria-label="' + esc(dayLabel(ds)) + (list.length ? ", " + list.length + " video" : "") + '" aria-pressed="' + (ds === sel) + '"><span class="n">' + d.getDate() + '</span><span class="dots">' + dots + "</span></button>";
    }
    h += '</div></div><div class="legend-row">' + ST.map(function (s) { return '<span><i class="dot st-' + s + '"></i>' + ST_LABEL[s] + "</span>"; }).join("") + "</div></section>";
    // selected day
    var dayList = map[sel] || [];
    h += '<div class="section-label"><h2>' + esc(dayLabel(sel)) + (sel === t ? " · Aaj" : "") + '</h2><button class="link-plain" type="button" data-newpost="' + esc(sel) + '">+ Add</button></div>';
    h += dayList.length ? '<div class="post-list">' + dayList.map(postRow).join("") + "</div>" : '<div class="empty slim"><p>Is din kuch plan nahi hai.</p><button class="btn" type="button" data-newpost="' + esc(sel) + '">' + icon("i-plus") + "Is din video add karo</button></div>";
    // upcoming
    var up = posts().filter(function (x) { return x.date && x.date >= t && x.date <= B.addDays(14) && x.status !== "posted" && x.date !== sel; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (up.length) {
      h += '<div class="section-label"><h2>Agle 2 hafte</h2></div><div class="list">';
      up.forEach(function (x) { h += '<button type="button" class="list-item" data-open="' + esc(x.id) + '"><span class="li-icon"><i class="dot st-' + esc(x.status) + '"></i></span><span class="li-main"><span class="li-title">' + esc(x.title) + '</span><span class="li-sub">' + esc([B.fmtDate(x.date), B.PLATFORM_LABEL[x.platform], ST_LABEL[x.status]].filter(Boolean).join(" · ")) + "</span></span></button>"; });
      h += "</div>";
    }
    var noDate = posts().filter(function (x) { return !x.date; });
    if (noDate.length) { h += '<div class="section-label"><h2>Bina date ke</h2></div><div class="post-list">' + noDate.map(postRow).join("") + "</div>"; }
    return h;
  }
  function after() {
    var v = B.$("#view");
    v.querySelector(".cal-days").addEventListener("click", function (e) {
      var b = e.target.closest("[data-day]"); if (!b) return; var d = b.getAttribute("data-day");
      B.ui.calDate = d; if (B.monthKey(d) !== calMonth()) B.ui.calMonth = B.monthKey(d); B.render();
    });
    B.$$("[data-cm]", v).forEach(function (b) { b.addEventListener("click", function () { B.ui.calMonth = shiftMonth(calMonth(), +b.getAttribute("data-cm")); var d = B.ui.calMonth + "-01"; if (B.monthKey(today()) === B.ui.calMonth) d = today(); B.ui.calDate = d; B.render(); }); });
    B.$$("[data-newpost]", v).forEach(function (b) { b.addEventListener("click", function () { B.openEditor("post", null, { date: b.getAttribute("data-newpost"), platform: "reel", status: "idea" }); }); });
    B.$$("[data-advance]", v).forEach(function (b) { b.addEventListener("click", function () {
      var it = B.byId(b.getAttribute("data-advance")); if (!it) return; var i = ST.indexOf(it.status); if (i < 0 || i >= ST.length - 1) return;
      var prev = it.status; it.status = ST[i + 1]; it.updatedAt = B.now(); delete it.sample; B.save(); B.render();
      B.toast("“" + (it.title || "Video") + "” → " + ST_LABEL[it.status] + (it.status === "posted" ? " 🎉" : ""), "Undo", function () { it.status = prev; B.save(); B.render(); });
    }); });
  }
  B.VIEWS.calendar = { render: render, after: after };
  B.calendar = { ST: ST, ST_LABEL: ST_LABEL };
})();
