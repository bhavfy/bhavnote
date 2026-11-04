/* Bhavnote — Books: your own PDF library. Upload a PDF, read it, delete it. No AI here.
   The original PDF file is kept in IndexedDB ("kv" store, id "pdf:<bookId>"); the book row lives in "books".
   Older books (made by earlier versions, text only) are still listed and open in a plain text reader.
   pdf.js is loaded only when a PDF is opened. Registers #/books. */
(function () {
  "use strict";
  var B = window.BN; if (!B) return;
  var esc = B.esc, icon = B.icon, $ = B.$, $$ = B.$$;
  var pdfjsP = null;
  function pdfjs() {
    if (!pdfjsP) pdfjsP = import("./vendor/pdfjs/pdf.min.mjs").then(function (m) { m.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", location.href).href; return m; });
    pdfjsP.catch(function () { pdfjsP = null; });
    return pdfjsP;
  }
  function pad(i) { return String(i).padStart(5, "0"); }
  function chunkId(bid, i) { return bid + ":" + pad(i); }
  function pdfKey(bid) { return "pdf:" + bid; }
  function getBook(id) { return B.IDB.get("books", id); }
  function putBook(b) { b.updatedAt = B.now(); return B.IDB.put("books", b); }
  function mb(n) { return n >= 1048576 ? (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
  function isPdf(f) { return f && (f.type === "application/pdf" || /\.pdf$/i.test(f.name || "")); }
  function isLegacy(b) { return b.kind !== "pdf"; }

  /* ---------- upload: keep the original file ---------- */
  function importPdf(file, onProgress) {
    var bid = "b" + B.uid(), blob = null, buf = null;
    return file.arrayBuffer().then(function (ab) {
      buf = ab; blob = new Blob([ab], { type: "application/pdf" }); // the Blob snapshots the bytes before pdf.js gets the buffer
      onProgress && onProgress("open");
      return pdfjs();
    }).then(function (lib) {
      return lib.getDocument({ data: buf, isEvalSupported: false }).promise;
    }).then(function (pdf) {
      var n = pdf.numPages;
      return pdf.getMetadata().catch(function () { return {}; }).then(function (meta) {
        var title = (meta && meta.info && meta.info.Title && String(meta.info.Title).trim()) || String(file.name || "PDF").replace(/\.pdf$/i, "").replace(/[_-]+/g, " ");
        var book = { id: bid, kind: "pdf", title: title.slice(0, 120), fileName: file.name, pageCount: n, size: blob.size, createdAt: B.now(), updatedAt: B.now(), read: { page: 1, zoom: 1 } };
        try { pdf.destroy(); } catch (e) {}
        onProgress && onProgress("save");
        return B.IDB.put("kv", { id: pdfKey(bid), blob: blob, size: blob.size, at: B.now() }).then(function () { return putBook(book); }).then(function () {
          B.logEvent("create", "book", "Book: " + book.title);
          try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
          return book;
        }, function (err) { B.IDB.del("kv", pdfKey(bid)).catch(function () {}); throw err; });
      });
    });
  }
  function deleteBook(b) {
    return B.confirmBox("Delete “" + b.title + "”?", "Ye PDF is phone se hat jayegi. Dobara chahiye toh phir upload karni padegi.", [{ label: "Cancel", value: null }, { label: "Delete", value: true, cls: "btn-danger" }]).then(function (ok) {
      if (!ok) return false;
      return B.IDB.range("chunks", chunkId(b.id, 0), chunkId(b.id, 99999)).then(function (cs) { return B.IDB.delMany("chunks", cs.map(function (c) { return c.id; })); }).catch(function () {})
        .then(function () { return B.IDB.del("kv", pdfKey(b.id)).catch(function () {}); })
        .then(function () { return B.IDB.del("books", b.id); })
        .then(function () { B.logEvent("delete", "book", "Book: " + b.title); B.toast("Delete ho gayi"); fillList(); return true; });
    });
  }

  /* ---------- list ---------- */
  function renderList() {
    var h = '<div class="page-head"><div><h1>Books</h1><p class="sub">Apni PDF upload karo, jab man kare padho.</p></div></div>';
    h += '<label class="upload-box" for="pdfInput">' + icon("i-upload") + '<span><b>PDF upload karo</b><small>Jo upload karoge wahi yahan dikhegi</small></span></label><input type="file" id="pdfInput" accept="application/pdf,.pdf" hidden>';
    h += '<div id="importProg" class="panel" hidden><p class="muted-p" id="importMsg">PDF khol raha hoon…</p></div>';
    h += '<div id="bookList"><p class="muted-p" style="padding:16px 4px">Load ho raha hai…</p></div>';
    return h;
  }
  function bookRow(b) {
    var legacy = isLegacy(b), pct = 0;
    if (legacy) pct = b.chunkCount ? Math.round(((b.read && b.read.chunk) || 0) * 100 / Math.max(1, b.chunkCount - 1)) : 0;
    else pct = b.pageCount > 1 ? Math.round((((b.read && b.read.page) || 1) - 1) * 100 / (b.pageCount - 1)) : 0;
    var sub = b.pageCount + " pages" + (b.size ? " · " + mb(b.size) : "") + (pct ? " · " + pct + "% padha" : "") + (legacy ? " · text mode" : "");
    return '<article class="book-card bk-row"><button type="button" class="book-open" data-book="' + esc(b.id) + '"><span class="book-cover">' + esc((b.title || "B").charAt(0).toUpperCase()) + '</span><span class="book-meta"><b>' + esc(b.title) + "</b><small>" + esc(sub) + "</small></span></button>" +
      '<button type="button" class="icon-btn bk-del" data-del="' + esc(b.id) + '" aria-label="Delete ' + esc(b.title) + '">' + icon("i-trash") + "</button></article>";
  }
  function fillList() {
    B.IDB.all("books").then(function (books) {
      var el = $("#bookList"); if (!el) return;
      books.sort(function (a, b) { return (b.lastOpened || b.createdAt) < (a.lastOpened || a.createdAt) ? -1 : 1; });
      if (!books.length) { el.innerHTML = B.emptyBox("Abhi koi PDF nahi", "Upar se apni PDF upload karo.", null); return; }
      el.innerHTML = '<div class="book-list">' + books.map(bookRow).join("") + "</div>";
    });
  }

  /* ---------- reader shell (full-screen overlay, Android back closes it) ---------- */
  var R = null; // current reader state
  function shell(book) {
    var el = document.createElement("div"); el.className = "bkr"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", book.title);
    el.innerHTML = '<div class="bkr-top"><button type="button" class="ne-btn" id="bkBack" aria-label="Back">' + icon("i-chev-l") + '</button><div class="bkr-title"><b></b><small id="bkSub"></small></div><span id="bkTools"></span></div><div class="bkr-scroll" id="bkScroll"><p class="muted-p bkr-msg">Khol raha hoon…</p></div>';
    el.querySelector(".bkr-title b").textContent = book.title;
    document.body.appendChild(el);
    document.documentElement.classList.add("ne-lock");
    $$(".shell, .bottomnav, .fab").forEach(function (n) { try { n.inert = true; } catch (e) {} });
    try { history.pushState({ bnBook: 1 }, "", location.href); } catch (e) {}
    void el.offsetWidth; el.classList.add("open");
    $("#bkBack", el).addEventListener("click", requestClose);
    return el;
  }
  function requestClose() { if (!R) return; if (history.state && history.state.bnBook) history.back(); else closeNow(); }
  function closeNow() {
    if (!R) return; var r = R; R = null;
    try { r.destroy && r.destroy(); } catch (e) {}
    r.el.remove();
    document.documentElement.classList.remove("ne-lock");
    $$(".shell, .bottomnav, .fab").forEach(function (n) { try { n.inert = false; } catch (e) {} });
    if (B.ui.route === "books") fillList();
  }
  window.addEventListener("popstate", function () { if (R) closeNow(); });
  function flushPos() { if (R && R.flush) R.flush(); }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flushPos(); });
  window.addEventListener("pagehide", flushPos);

  function openBook(bid) {
    if (R) return;
    getBook(bid).then(function (book) {
      if (!book) { B.toast("Ye PDF nahi mili"); fillList(); return; }
      book.lastOpened = B.now(); putBook(book);
      var el = shell(book); R = { el: el, book: book };
      if (isLegacy(book)) openLegacy(book); else openPdf(book);
    });
  }

  /* ---------- PDF reader (pdf.js, pages drawn only near the screen) ---------- */
  var ZOOMS = [0.6, 0.8, 1, 1.25, 1.5, 2, 2.5, 3];
  function openPdf(book) {
    var r = R, el = r.el, sc = $("#bkScroll", el), lib = null, pdf = null, zoom = (book.read && book.read.zoom) || 1;
    var N = book.pageCount, pages = [], vw = 0, aspect = 1.414, curPage = (book.read && book.read.page) || 1, rendered = [], queue = [], busy = false, dead = false, gen = 0, io = null;
    $("#bkTools", el).innerHTML = '<button type="button" class="ne-btn" id="bkZout" aria-label="Zoom out"><span class="aa">−</span></button><button type="button" class="ne-btn bk-zl" id="bkZfit" aria-label="Fit width">100%</button><button type="button" class="ne-btn" id="bkZin" aria-label="Zoom in"><span class="aa">+</span></button>';
    $("#bkSub", el).innerHTML = '<input type="number" inputmode="numeric" min="1" max="' + N + '" id="bkPg" aria-label="Page number"> / ' + N;
    var pgIn = $("#bkPg", el);
    r.destroy = function () { dead = true; gen++; if (io) io.disconnect(); queue = []; rendered.forEach(function (i) { release(i); }); try { pdf && pdf.destroy(); } catch (e) {} };
    function pageW() { return Math.round((sc.clientWidth - 16) * zoom); }
    function sizePage(p, w, h) { p.el.style.width = w + "px"; p.el.style.height = h + "px"; }
    function relayout() { vw = sc.clientWidth; var w = pageW(); pages.forEach(function (p) { sizePage(p, w, Math.round(w * (p.ratio || aspect))); }); $("#bkZfit", el).textContent = Math.round(zoom * 100) + "%"; }
    function scrollToPage(n, frac) { var p = pages[n - 1]; if (!p) return; sc.scrollTop = p.el.offsetTop - 8 + (frac || 0) * p.el.offsetHeight; }
    function pageAtTop() { // page under the upper third of the screen + how far into it
      var t = sc.scrollTop + sc.clientHeight * 0.3, lo = 0, hi = pages.length - 1;
      while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (pages[mid].el.offsetTop <= t) lo = mid; else hi = mid - 1; }
      var p = pages[lo]; return { n: lo + 1, frac: Math.max(0, Math.min(1, (sc.scrollTop - p.el.offsetTop + 8) / Math.max(1, p.el.offsetHeight))) };
    }
    var saveT = 0;
    function save() { if (!pages.length) return; var a = pageAtTop(); book.read = { page: a.n, frac: Math.round(a.frac * 1000) / 1000, zoom: zoom, at: B.now() }; putBook(book).catch(function () {}); }
    r.flush = function () { clearTimeout(saveT); saveT = 0; if (!dead) save(); };
    function onScroll() {
      var a = pageAtTop(); curPage = a.n; if (document.activeElement !== pgIn) pgIn.value = curPage;
      clearTimeout(saveT); saveT = setTimeout(function () { saveT = 0; save(); }, 800);
    }
    function release(i) { var p = pages[i - 1]; if (!p) return; if (p.task) { try { p.task.cancel(); } catch (e) {} p.task = null; } if (p.cv) { p.cv.width = 0; p.cv.height = 0; p.cv.remove(); p.cv = null; } p.done = false; p.busyGen = -1; var k = rendered.indexOf(i); if (k > -1) rendered.splice(k, 1); }
    function want(i) { var p = pages[i - 1]; if (!p || p.done || p.queued) return; p.queued = true; queue.push(i); pump(); }
    function pump() {
      if (busy || dead || !queue.length) return;
      var mid = curPage; queue.sort(function (a, b) { return Math.abs(a - mid) - Math.abs(b - mid); });
      var i = queue.shift(), p = pages[i - 1]; p.queued = false;
      if (!p.vis && Math.abs(i - mid) > 1) return pump();
      busy = true; var g = gen;
      pdf.getPage(i).then(function (page) {
        if (dead || g !== gen) { busy = false; return pump(); }
        var base = page.getViewport({ scale: 1 }); p.ratio = base.height / base.width;
        var w = pageW(), cssH = Math.round(w * p.ratio), oldH = p.el.offsetHeight;
        var dpr = Math.min(window.devicePixelRatio || 1, 2.5), scale = (w / base.width) * dpr, pix = base.width * base.height * scale * scale;
        if (pix > 14e6) scale *= Math.sqrt(14e6 / pix); // keep canvases phone-sized at high zoom
        var vp = page.getViewport({ scale: scale }), cv = document.createElement("canvas"); cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
        cv.style.width = "100%"; cv.style.height = "100%";
        if (cssH !== oldH) { var above = p.el.offsetTop + oldH <= sc.scrollTop; sizePage(p, w, cssH); if (above) sc.scrollTop += cssH - oldH; }
        var task = page.render({ canvasContext: cv.getContext("2d", { alpha: false }), viewport: vp, background: "#fff" }); p.task = task;
        return task.promise.then(function () {
          p.task = null; if (dead || g !== gen) { cv.width = 0; return; }
          p.el.appendChild(cv); p.cv = cv; p.done = true; p.el.classList.add("ready"); rendered.push(i);
          while (rendered.length > 7) { var far = rendered.slice().sort(function (a, b) { return Math.abs(b - mid) - Math.abs(a - mid); })[0]; if (far === i) break; release(far); }
          page.cleanup();
        });
      }).catch(function (e) { if (!(e && e.name === "RenderingCancelledException")) console.warn(e); }).then(function () { busy = false; pump(); });
    }
    function build() {
      sc.innerHTML = ""; var frag = document.createDocumentFragment(); pages = [];
      for (var i = 1; i <= N; i++) { var d = document.createElement("div"); d.className = "bkr-page"; d.setAttribute("data-i", i); frag.appendChild(d); pages.push({ el: d, i: i, ratio: 0, vis: false, done: false }); }
      sc.appendChild(frag); relayout();
      io = new IntersectionObserver(function (es) { es.forEach(function (e) { var p = pages[+e.target.getAttribute("data-i") - 1]; p.vis = e.isIntersecting; if (e.isIntersecting) want(p.i); }); }, { root: sc, rootMargin: "120% 0px" });
      pages.forEach(function (p) { io.observe(p.el); });
    }
    function setZoom(z) {
      z = Math.max(ZOOMS[0], Math.min(ZOOMS[ZOOMS.length - 1], z)); if (z === zoom) return;
      var a = pageAtTop(); zoom = z; gen++; queue = []; rendered.slice().forEach(release); pages.forEach(function (p) { p.queued = false; p.vis = false; });
      relayout(); scrollToPage(a.n, a.frac); pages.forEach(function (p) { io.unobserve(p.el); io.observe(p.el); }); save();
    }
    function stepZoom(dir) { var k = 0; for (var j = 0; j < ZOOMS.length; j++) if (ZOOMS[j] <= zoom + 0.001) k = j; setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, k + dir))]); }
    $("#bkZin", el).addEventListener("click", function () { stepZoom(1); });
    $("#bkZout", el).addEventListener("click", function () { stepZoom(-1); });
    $("#bkZfit", el).addEventListener("click", function () { setZoom(1); });
    pgIn.addEventListener("change", function () { var n = Math.max(1, Math.min(N, parseInt(pgIn.value, 10) || curPage)); pgIn.value = n; curPage = n; scrollToPage(n, 0); pgIn.blur(); });
    pgIn.addEventListener("focus", function () { pgIn.select(); });
    sc.addEventListener("scroll", onScroll, { passive: true });
    var rzT = 0; window.addEventListener("resize", function () { if (dead) return; clearTimeout(rzT); rzT = setTimeout(function () { if (dead || sc.clientWidth === vw) return; var a = pageAtTop(); gen++; queue = []; rendered.slice().forEach(release); relayout(); scrollToPage(a.n, a.frac); pages.forEach(function (p) { io.unobserve(p.el); io.observe(p.el); }); }, 250); });
    pgIn.value = curPage;
    Promise.all([B.IDB.get("kv", pdfKey(book.id)), pdfjs()]).then(function (a) {
      var row = a[0]; lib = a[1];
      if (!row || !row.blob) throw new Error("PDF file missing");
      return row.blob.arrayBuffer();
    }).then(function (buf) { return lib.getDocument({ data: buf, isEvalSupported: false }).promise; }).then(function (doc) {
      if (dead) { doc.destroy(); return; }
      pdf = doc; N = pdf.numPages; return pdf.getPage(1).then(function (p1) {
        var v = p1.getViewport({ scale: 1 }); aspect = v.height / v.width;
        build(); curPage = Math.max(1, Math.min(N, curPage)); scrollToPage(curPage, (book.read && book.read.frac) || 0); onScroll();
      });
    }).catch(function (e) {
      console.warn(e); if (dead) return;
      sc.innerHTML = '<p class="muted-p bkr-msg">Ye PDF khul nahi payi' + (/missing/i.test(String(e && e.message)) ? " (file phone mein nahi mili — dobara upload karo)" : "") + ".</p>";
    });
  }

  /* ---------- older text-only books (kept readable; the original PDF was never stored for these) ---------- */
  function openLegacy(book) {
    var r = R, el = r.el, sc = $("#bkScroll", el), chs = book.chapters && book.chapters.length ? book.chapters : [{ title: "", chunk: 0 }], ch = 0, dead = false;
    function rs() { var s = B.db.settings.reader || {}; return { size: s.size || 18, lh: s.lh || 1.7 }; }
    function applyFont() { var s = rs(); el.style.setProperty("--rs", s.size + "px"); el.style.setProperty("--rlh", s.lh); }
    applyFont();
    $("#bkTools", el).innerHTML = '<button type="button" class="ne-btn" id="bkCh" aria-label="Chapters">' + icon("i-note") + '</button><button type="button" class="ne-btn" id="bkFs" aria-label="Font size"><span class="aa">Aa</span></button>';
    var rd = book.read || {}; var startChunk = rd.chunk || 0;
    for (var i = 0; i < chs.length; i++) if (chs[i].chunk <= startChunk) ch = i;
    r.destroy = function () { dead = true; };
    function range(c) { var from = chs[c] ? chs[c].chunk : 0, to = chs[c + 1] ? chs[c + 1].chunk - 1 : Math.max(0, (book.chunkCount || 1) - 1); return [from, Math.max(from, to)]; }
    function para(p) { var head = /^#\s/.test(p); return '<p class="rp' + (head ? " rh" : "") + '">' + esc(head ? p.replace(/^#+\s*/, "") : p) + "</p>"; }
    function show(jump) {
      var rg = range(ch); $("#bkSub", el).textContent = (chs[ch].title ? chs[ch].title + " · " : "") + (ch + 1) + "/" + chs.length;
      B.IDB.range("chunks", chunkId(book.id, rg[0]), chunkId(book.id, rg[1])).then(function (cs) {
        if (dead) return;
        var h = cs.map(function (c) {
          var s = '<section class="rchunk" data-c="' + c.i + '">';
          if (c.img && !(c.paras && c.paras.length)) s += '<img class="bkr-scan" alt="Scanned page ' + esc(c.pageFrom) + '" src="' + esc(c.img) + '">';
          else s += (c.paras || []).map(para).join("");
          return s + "</section>";
        }).join("") || '<p class="muted-p bkr-msg">Is hisse mein text nahi mila.</p>';
        h = '<div class="bkr-text">' + '<p class="muted-p bkr-note">Ye purani book text mode mein khuli hai. Asli PDF dekhni ho toh dobara upload kar do.</p>' + h +
          '<div class="reader-nav"><button type="button" class="btn" id="bkPrev"' + (ch <= 0 ? " disabled" : "") + '>' + icon("i-chev-l") + 'Pichla</button><button type="button" class="btn" id="bkNext"' + (ch >= chs.length - 1 ? " disabled" : "") + '>Agla' + icon("i-chev-r") + "</button></div></div>";
        sc.innerHTML = h; sc.scrollTop = 0;
        if (jump != null) { var t = sc.querySelector('[data-c="' + jump + '"]'); if (t) sc.scrollTop = t.offsetTop - 8; }
      });
    }
    function savePos() { var cs = $$(".rchunk", sc), top = null, base = sc.getBoundingClientRect().top; for (var i = 0; i < cs.length; i++) { if (cs[i].getBoundingClientRect().bottom > base + 40) { top = cs[i]; break; } } if (top) { book.read = { chunk: +top.getAttribute("data-c"), para: 0, at: B.now() }; putBook(book).catch(function () {}); } }
    r.flush = function () { if (!dead) savePos(); };
    var t = 0; sc.addEventListener("scroll", function () { clearTimeout(t); t = setTimeout(savePos, 800); }, { passive: true });
    sc.addEventListener("click", function (e) {
      var b = e.target.closest("#bkPrev,#bkNext"); if (!b || b.disabled) return;
      ch += b.id === "bkNext" ? 1 : -1; show(null); savePos();
    });
    $("#bkFs", el).addEventListener("click", function () {
      var s = Object.assign({ size: 18, lh: 1.7 }, B.db.settings.reader || {}); s.size = s.size >= 26 ? 14 : s.size + 2; B.db.settings.reader = s; B.save(); applyFont();
    });
    $("#bkCh", el).addEventListener("click", function () {
      var old = $(".bkr-chs", el); if (old) { old.remove(); return; }
      var d = document.createElement("div"); d.className = "bkr-chs";
      d.innerHTML = chs.map(function (c, i) { return '<button type="button" class="list-item' + (i === ch ? " on" : "") + '" data-ch="' + i + '">' + esc(c.title || "Shuruaat") + "</button>"; }).join("");
      d.addEventListener("click", function (e) { var b = e.target.closest("[data-ch]"); if (!b) return; ch = +b.getAttribute("data-ch"); d.remove(); show(null); savePos(); });
      el.appendChild(d);
    });
    show(startChunk);
  }

  /* ---------- view wiring ---------- */
  function render() { return renderList(); }
  var bound = false;
  function after() {
    if (!bound) {
      bound = true;
      $("#view").addEventListener("click", function (e) {
        if (B.ui.route !== "books") return;
        var d = e.target.closest("[data-del]"); if (d) { var id = d.getAttribute("data-del"); getBook(id).then(function (b) { if (b) deleteBook(b); }); return; }
        var t = e.target.closest("[data-book]"); if (t) openBook(t.getAttribute("data-book"));
      });
    }
    fillList();
    $("#pdfInput").addEventListener("change", function (e) {
      var f = e.target.files[0]; e.target.value = ""; if (!f) return;
      if (!isPdf(f)) { B.toast("Ye PDF file nahi hai"); return; }
      var box = $("#importProg"), msg = $("#importMsg"); box.hidden = false; msg.textContent = "PDF khol raha hoon…";
      importPdf(f, function (st) { var m = $("#importMsg"); if (m) m.textContent = st === "save" ? "Phone mein save ho rahi hai…" : "PDF check kar raha hoon…"; })
        .then(function (book) { var bx = $("#importProg"); if (bx) bx.hidden = true; B.toast("“" + book.title + "” add ho gayi ✓"); if (B.ui.route === "books") { fillList(); openBook(book.id); } })
        .catch(function (err) {
          console.warn(err); var m = $("#importMsg"); if (!m) return;
          m.textContent = err && err.name === "QuotaExceededError" ? "Phone mein jagah kam hai, ye PDF save nahi ho payi." : "Ye PDF nahi khul payi" + (/password/i.test(String(err && err.message)) ? " (password wali hai)" : "") + ". Dusri file try karo.";
        });
    });
  }
  B.VIEWS.books = { render: render, after: after };
  window.BNBooks = { importPdf: importPdf, openBook: openBook };
})();
