/* Bhavnote — Paisa (earnings dashboard). Registers the #/paisa view. */
(function () {
  "use strict";
  var B = window.BN; if (!B) return;
  var esc = B.esc, icon = B.icon, INR = B.INR;
  var GREYS = ["#f5f5f7", "#c7c7cc", "#9a9aa0", "#7c7c82", "#5f5f65", "#48484c", "#38383b"];
  function curMonth() { if (!B.ui.month) B.ui.month = B.monthKey(new Date()); return B.ui.month; }
  function shiftMonth(mk, d) { var p = mk.split("-"); var dt = new Date(+p[0], +p[1] - 1 + d, 1); return B.monthKey(dt); }
  function monthLabel(mk, short) { var p = mk.split("-"); return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString("en-IN", short ? { month: "short" } : { month: "long", year: "numeric" }); }
  function amt(it) { return +it.amount || 0; }
  function totals(mk) {
    var t = { income: 0, expense: 0, pending: 0, cats: {}, count: 0 };
    B.db.items.forEach(function (it) {
      if ((it.type !== "income" && it.type !== "expense") || B.monthKey(it.date) !== mk) return;
      t.count++;
      if (it.type === "income") { if (it.status === "pending") t.pending += amt(it); else t.income += amt(it); }
      else { t.expense += amt(it); var c = (it.category || "other").toLowerCase(); t.cats[c] = (t.cats[c] || 0) + amt(it); }
    });
    t.saved = t.income - t.expense;
    return t;
  }
  function short(n) { n = Math.round(n); if (Math.abs(n) >= 100000) return "₹" + (n / 100000).toFixed(n % 100000 ? 1 : 0) + "L"; if (Math.abs(n) >= 1000) return "₹" + (n / 1000).toFixed(n % 1000 && Math.abs(n) < 10000 ? 1 : 0) + "k"; return "₹" + n; }

  function barChart(mk) {
    var months = []; for (var i = 5; i >= 0; i--) months.push(shiftMonth(mk, -i));
    var data = months.map(function (m) { var t = totals(m); return { m: m, inc: t.income, exp: t.expense }; });
    var max = Math.max.apply(null, data.map(function (d) { return Math.max(d.inc, d.exp); }).concat([1]));
    var W = 320, H = 150, top = 14, base = 122, bw = 14, gap = W / 6;
    var s = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Last 6 months income vs kharcha">';
    [0.5, 1].forEach(function (f) { var y = base - (base - top) * f; s += '<line x1="0" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="rgba(255,255,255,.07)"/>'; });
    s += '<line x1="0" x2="' + W + '" y1="' + base + '" y2="' + base + '" stroke="rgba(255,255,255,.14)"/>';
    data.forEach(function (d, i) {
      var cx = gap * i + gap / 2, hi = (base - top) * d.inc / max, he = (base - top) * d.exp / max, cur = d.m === mk;
      s += '<rect x="' + (cx - bw - 1) + '" y="' + (base - hi) + '" width="' + bw + '" height="' + Math.max(hi, 0) + '" rx="4" fill="' + (cur ? "#f5f5f7" : "#c7c7cc") + '" opacity="' + (cur ? 1 : .75) + '"><title>Kamaya ' + INR.format(d.inc) + "</title></rect>";
      s += '<rect x="' + (cx + 1) + '" y="' + (base - he) + '" width="' + bw + '" height="' + Math.max(he, 0) + '" rx="4" fill="#5f5f65" opacity="' + (cur ? 1 : .8) + '"><title>Kharcha ' + INR.format(d.exp) + "</title></rect>";
      s += '<text x="' + cx + '" y="' + (base + 18) + '" text-anchor="middle" font-size="11" fill="' + (cur ? "#f5f5f7" : "#8e8e93") + '" font-weight="' + (cur ? 700 : 500) + '">' + esc(monthLabel(d.m, true)) + "</text>";
    });
    s += '<text x="0" y="10" font-size="10" fill="#6e6e73">' + esc(short(max)) + "</text>";
    return s + "</svg>";
  }
  function donut(cats) {
    var keys = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; });
    var total = keys.reduce(function (s, k) { return s + cats[k]; }, 0);
    if (!total) return '<p class="muted-p">Is mahine koi kharcha nahi likha.</p>';
    var R = 52, C = 2 * Math.PI * R, off = 0;
    var s = '<div class="donut-wrap"><svg class="donut" viewBox="0 0 140 140" role="img" aria-label="Kharcha by category"><circle cx="70" cy="70" r="' + R + '" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="18"/>';
    keys.forEach(function (k, i) {
      var len = C * cats[k] / total;
      s += '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="' + GREYS[i % GREYS.length] + '" stroke-width="18" stroke-dasharray="' + Math.max(len - 1.5, 0.5) + " " + C + '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90 70 70)"/>';
      off += len;
    });
    s += '<text x="70" y="66" text-anchor="middle" font-size="11" fill="#8e8e93">Kharcha</text><text x="70" y="84" text-anchor="middle" font-size="16" font-weight="700" fill="#f5f5f7">' + esc(short(total)) + "</text></svg><ul class=\"legend\">";
    keys.forEach(function (k, i) { s += '<li><span class="sw" style="background:' + GREYS[i % GREYS.length] + '"></span><span class="lg-name">' + esc(B.cap(k)) + '</span><b>' + esc(INR.format(cats[k])) + "</b><small>" + Math.round(cats[k] * 100 / total) + "%</small></li>"; });
    return s + "</ul></div>";
  }
  function pendingByClient() {
    var map = {};
    B.db.items.forEach(function (it) { if (it.type === "income" && it.status === "pending") { var k = String(it.source || "Unknown").trim(); var key = k.toLowerCase(); if (!map[key]) map[key] = { name: k, sum: 0, items: [] }; map[key].sum += amt(it); map[key].items.push(it); } });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.sum - a.sum; });
  }
  function render() {
    var mk = curMonth(), t = totals(mk), goal = +B.db.settings.goal || 0;
    var h = '<div class="page-head"><div><h1>Paisa</h1><p class="sub">Kamaya, kharcha, bacha — sab ek jagah.</p></div></div>' +
      '<div class="action-row"><button class="btn btn-primary" type="button" data-new="income">' + icon("i-plus") + 'Income</button><button class="btn" type="button" data-new="expense">' + icon("i-plus") + "Kharcha</button></div>";
    h += '<div class="month-bar"><button class="icon-btn" type="button" data-month="-1" aria-label="Pichla mahina">' + icon("i-chev-l") + '</button><h2 class="month-name">' + esc(monthLabel(mk)) + '</h2><button class="icon-btn" type="button" data-month="1" aria-label="Agla mahina">' + icon("i-chev-r") + "</button></div>";
    h += '<div class="money-grid">' +
      '<div class="money hero-m"><span class="lbl">Kamaya</span><span class="num">' + esc(INR.format(t.income)) + "</span><span class=\"cap\">received</span></div>" +
      '<div class="money"><span class="lbl">Kharcha</span><span class="num">' + esc(INR.format(t.expense)) + '</span><span class="cap">spent</span></div>' +
      '<div class="money"><span class="lbl">Bacha</span><span class="num' + (t.saved < 0 ? " neg" : "") + '">' + esc((t.saved < 0 ? "−" : "") + INR.format(Math.abs(t.saved))) + '</span><span class="cap">saved</span></div>' +
      '<div class="money"><span class="lbl">Pending</span><span class="num">' + esc(INR.format(t.pending)) + '</span><span class="cap">aana baaki</span></div></div>';
    // goal
    h += '<section class="panel goal" aria-labelledby="goalH"><div class="plan-head"><h2 id="goalH">Monthly goal</h2><button class="link-plain" type="button" id="goalEdit">' + (goal ? "Change" : "Set goal") + "</button></div>";
    if (goal) {
      var pct = Math.min(100, Math.round(t.income * 100 / goal));
      h += '<div class="goal-nums"><b>' + esc(INR.format(t.income)) + '</b><span>of ' + esc(INR.format(goal)) + "</span><em>" + pct + '%</em></div><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><span style="transform:scaleX(' + (pct / 100) + ')"></span></div>' +
        '<p class="muted-p">' + (t.income >= goal ? "Goal pura! 🎉 Badhiya mahina." : esc(INR.format(goal - t.income)) + " aur chahiye is mahine.") + "</p>";
    } else h += '<p class="muted-p">Is mahine kitna kamana hai? Target set karo, progress yahan dikhega.</p>';
    h += '<form class="goal-form" id="goalForm" hidden><input class="input" id="goalInput" inputmode="numeric" placeholder="50000" value="' + (goal || "") + '" aria-label="Monthly goal in rupees"><button class="btn btn-primary" type="submit">Save</button></form></section>';
    // charts
    h += '<div class="two-col"><section class="panel" aria-labelledby="chH"><div class="plan-head"><h2 id="chH">6 mahine</h2><span class="key"><i class="k1"></i>Kamaya <i class="k2"></i>Kharcha</span></div><div id="barBox" class="chart-ph"></div></section>';
    h += '<section class="panel" aria-labelledby="dnH"><div class="plan-head"><h2 id="dnH">Kharcha kahan gaya</h2></div><div id="donutBox" class="chart-ph"></div></section></div>';
    // pending per client
    var pend = pendingByClient();
    h += '<section class="panel" aria-labelledby="pnH"><div class="plan-head"><h2 id="pnH">Kisse paisa lena hai</h2><span class="key">' + esc(INR.format(pend.reduce(function (s, p) { return s + p.sum; }, 0))) + "</span></div>";
    if (!pend.length) h += '<p class="muted-p">Sab clear 👌 Koi pending payment nahi.</p>';
    pend.forEach(function (p) {
      var c = B.findClient(p.name); var note = p.items.length === 1 ? p.items[0].note : "";
      var link = B.waLink(B.phoneOf(c), B.reminderText(p.name, p.sum, note));
      h += '<div class="pend-row"><div class="pr-main"><b>' + esc(p.name) + "</b><small>" + p.items.length + " payment" + (p.items.length > 1 ? "s" : "") + (c ? " · " + esc(c.company || c.project || "") : "") + '</small></div><span class="pr-amt">' + esc(INR.format(p.sum)) + "</span>" +
        '<a class="mini-btn" href="' + esc(link) + '" target="_blank" rel="noopener">' + icon("i-chat") + "Remind</a>" +
        '<button class="mini-btn" type="button" data-paid="' + esc(p.items.map(function (i) { return i.id; }).join(",")) + '">' + icon("i-check") + "Mila</button></div>";
    });
    h += "</section>";
    // transactions
    var tx = B.db.items.filter(function (it) { return (it.type === "income" || it.type === "expense") && B.monthKey(it.date) === mk; })
      .sort(function (a, b) { return (b.date || "") < (a.date || "") ? -1 : (b.date || "") > (a.date || "") ? 1 : (b.updatedAt < a.updatedAt ? -1 : 1); });
    h += '<div class="section-label"><h2>' + esc(monthLabel(mk, true)) + " ki entries</h2></div>";
    if (!tx.length) h += B.emptyBox("Is mahine kuch nahi likha", "Income ya kharcha add karo.", "income");
    else {
      h += '<div class="list">';
      tx.forEach(function (it) {
        var inc = it.type === "income";
        h += '<button type="button" class="list-item tx" data-open="' + esc(it.id) + '"><span class="li-icon">' + icon(inc ? "i-rupee" : "i-wallet") + '</span><span class="li-main"><span class="li-title">' + esc(B.titleOf(it)) + '</span><span class="li-sub">' +
          esc([B.fmtDate(it.date), inc ? (it.mode || "").toUpperCase() : B.cap(it.category || ""), inc && it.status === "pending" ? "Pending" : "", it.note].filter(Boolean).join(" · ")) + '</span></span><span class="tx-amt ' + (inc ? (it.status === "pending" ? "pend" : "in") : "out") + '">' + (inc ? "+" : "−") + esc(INR.format(amt(it))) + "</span></button>";
      });
      h += "</div>";
    }
    return h;
  }
  function after() {
    var v = B.$("#view");
    // charts paint after the first frame so the tab switch itself stays light
    var mk0 = curMonth();
    requestAnimationFrame(function () { setTimeout(function () {
      if (B.ui.route !== "paisa" || curMonth() !== mk0) return;
      var bb = B.$("#barBox"), db = B.$("#donutBox"); if (bb) bb.innerHTML = barChart(mk0); if (db) db.innerHTML = donut(totals(mk0).cats);
    }, 0); });
    B.$$("[data-month]", v).forEach(function (b) { b.addEventListener("click", function () { B.ui.month = shiftMonth(curMonth(), +b.getAttribute("data-month")); B.render(); }); });
    var ge = B.$("#goalEdit"), gf = B.$("#goalForm");
    ge.addEventListener("click", function () { gf.hidden = !gf.hidden; if (!gf.hidden) B.$("#goalInput").focus(); });
    gf.addEventListener("submit", function (e) { e.preventDefault(); var n = +String(B.$("#goalInput").value).replace(/[₹,\s]/g, ""); if (isNaN(n) || n < 0) { B.toast("Sahi amount daalo"); return; } B.db.settings.goal = n; B.save(); B.render(); B.toast(n ? "Goal set: " + INR.format(n) : "Goal hata diya"); });
    B.$$("[data-paid]", v).forEach(function (b) { b.addEventListener("click", function () {
      var ids = b.getAttribute("data-paid").split(","); var ts = B.now(); var today = B.ymd(new Date());
      ids.forEach(function (id) { var it = B.byId(id); if (it) { it.status = "paid"; it.paidOn = today; it.updatedAt = ts; delete it.sample; } });
      B.save(); B.render(); B.toast("Payment mil gaya ✓", "Undo", function () { ids.forEach(function (id) { var it = B.byId(id); if (it) { it.status = "pending"; delete it.paidOn; } }); B.save(); B.render(); });
    }); });
  }
  B.VIEWS.paisa = { render: render, after: after };
  B.paisa = { totals: totals, pendingByClient: pendingByClient, curMonth: curMonth };
})();
