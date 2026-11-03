/* Bhavnote — Books: PDF → easy Hinglish reader. pdf.js is loaded only when a PDF is opened.
   Books and their text live in IndexedDB; conversion runs part by part through the user's Gemini key,
   saves after every part, and can pause / resume (also after the app was closed). Registers #/books. */
(function () {
  "use strict";
  var B = window.BN; if (!B) return;
  var esc = B.esc, icon = B.icon, $ = B.$, $$ = B.$$;
  var CHUNK_CHARS = 3200, MIN_GAP_MS = 4500;
  var pdfjsP = null;
  function pdfjs() {
    if (!pdfjsP) pdfjsP = import("./vendor/pdfjs/pdf.min.mjs").then(function (m) { m.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", location.href).href; return m; });
    pdfjsP.catch(function () { pdfjsP = null; });
    return pdfjsP;
  }
  function pad(i) { return String(i).padStart(5, "0"); }
  function chunkId(bid, i) { return bid + ":" + pad(i); }
  function getBook(id) { return B.IDB.get("books", id); }
  function putBook(b) { b.updatedAt = B.now(); return B.IDB.put("books", b); }
  function getChunks(bid, from, to) { return B.IDB.range("chunks", chunkId(bid, from), chunkId(bid, to)); }
  function ui() { return B.ui; }
  function ai() { return window.BNAI; }
  function rs() { var s = B.db.settings.reader || {}; return { size: s.size || 18, lh: s.lh || 1.7 }; }

  /* ---------- PDF → paragraphs ---------- */
  function pageParas(tc) {
    var items = tc.items.filter(function (it) { return it.str != null; }); if (!items.length) return [];
    var lines = [], cur = null;
    items.forEach(function (it) {
      var y = it.transform[5], x = it.transform[4], hgt = Math.abs(it.transform[3]) || it.height || 10;
      if (!cur || Math.abs(cur.y - y) > Math.max(2, hgt * 0.45)) { cur = { y: y, x: x, h: hgt, text: "", right: x }; lines.push(cur); }
      cur.text += (cur.text && !/\s$/.test(cur.text) && it.str && !/^\s/.test(it.str) && (x - cur.right) > hgt * 0.15 ? " " : "") + it.str;
      cur.right = x + (it.width || 0); cur.h = Math.max(cur.h, hgt);
    });
    lines = lines.filter(function (l) { return l.text.trim(); });
    if (!lines.length) return [];
    var hs = lines.map(function (l) { return l.h; }).sort(function (a, b) { return a - b; }), medH = hs[Math.floor(hs.length / 2)];
    var gaps = []; for (var i = 1; i < lines.length; i++) { var g = lines[i - 1].y - lines[i].y; if (g > 0) gaps.push(g); } gaps.sort(function (a, b) { return a - b; });
    var medGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : medH * 1.4;
    var maxRight = Math.max.apply(null, lines.map(function (l) { return l.right; }));
    var paras = [], buf = "", prev = null;
    function flush() { var t = buf.replace(/\s+/g, " ").trim(); if (t) paras.push(t); buf = ""; }
    lines.forEach(function (l) {
      var t = l.text.replace(/\s+/g, " ").trim(); var heading = l.h > medH * 1.25 && t.length < 90;
      var brk = !prev || heading || prev.heading || (prev.y - l.y) > medGap * 1.45 || prev.right < maxRight * 0.72;
      if (brk) flush();
      if (heading) { buf = "# " + t; flush(); }
      else if (buf && /[A-Za-z]-$/.test(buf)) buf = buf.slice(0, -1) + t;
      else buf += (buf ? " " : "") + t;
      prev = { y: l.y, right: l.right, heading: heading };
    });
    flush();
    return paras;
  }
  function splitLong(p) {
    if (p.length <= CHUNK_CHARS) return [p];
    var out = [], s = p.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [p], buf = "";
    s.forEach(function (x) { if ((buf + x).length > CHUNK_CHARS && buf) { out.push(buf.trim()); buf = ""; } buf += x; }); if (buf.trim()) out.push(buf.trim());
    return out;
  }
  function importPdf(file, onProgress) {
    var bid = "b" + B.uid();
    return pdfjs().then(function (lib) {
      return file.arrayBuffer().then(function (buf) { return lib.getDocument({ data: buf, isEvalSupported: false }).promise; });
    }).then(function (pdf) {
      var n = pdf.numPages, chunks = [], cur = null, pageChunk = {};
      function newChunk(page) { cur = { id: chunkId(bid, chunks.length), bookId: bid, i: chunks.length, pageFrom: page, pageTo: page, paras: [], hi: null, img: null, chars: 0 }; chunks.push(cur); }
      var p = Promise.resolve();
      for (var pg = 1; pg <= n; pg++) (function (pg) {
        p = p.then(function () { onProgress && onProgress(pg, n); return pdf.getPage(pg); }).then(function (page) {
          return page.getTextContent().then(function (tc) {
            var paras = pageParas(tc); var chars = paras.join("").length;
            if (chars < 25) { // scanned page → keep an image for Gemini OCR
              var vp = page.getViewport({ scale: 1 }); var scale = Math.min(2, 1100 / vp.width); var v2 = page.getViewport({ scale: scale });
              var cv = document.createElement("canvas"); cv.width = Math.round(v2.width); cv.height = Math.round(v2.height);
              return page.render({ canvasContext: cv.getContext("2d"), viewport: v2 }).promise.then(function () {
                newChunk(pg); cur.img = cv.toDataURL("image/jpeg", 0.72); cur.chars = 1500; pageChunk[pg] = cur.i; cur = null; page.cleanup();
              });
            }
            paras.forEach(function (para) {
              var isHead = /^# /.test(para);
              splitLong(para).forEach(function (pp) {
                // a heading starts a fresh part so chapters line up with parts
                if (!cur || cur.img || cur.chars + pp.length > CHUNK_CHARS || (isHead && cur.chars > 600)) newChunk(pg);
                cur.paras.push(pp); cur.chars += pp.length; cur.pageTo = pg;
                if (pageChunk[pg] == null) pageChunk[pg] = cur.i;
              });
            });
            page.cleanup();
          });
        });
      })(pg);
      return p.then(function () { return pdf.getMetadata().catch(function () { return {}; }); }).then(function (meta) {
        return chapterList(pdf, chunks, pageChunk).then(function (chapters) {
          var title = (meta && meta.info && meta.info.Title && String(meta.info.Title).trim()) || file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ");
          var book = { id: bid, title: title.slice(0, 120), fileName: file.name, pageCount: n, chunkCount: chunks.length, createdAt: B.now(), updatedAt: B.now(), chapters: chapters,
            conv: { state: "idle", done: 0, next: 0, msg: "" }, read: { chunk: 0, para: 0 }, bookmarks: [], tools: {}, scanned: chunks.filter(function (c) { return c.img; }).length };
          pdf.destroy();
          return B.IDB.putMany("chunks", chunks).then(function () { return putBook(book); }).then(function () { B.logEvent("create", "book", "Book: " + book.title); return book; });
        });
      });
    });
  }
  function chapterList(pdf, chunks, pageChunk) {
    function chunkForPage(pg) { for (var p = pg; p >= 1; p--) if (pageChunk[p] != null) return pageChunk[p]; return 0; }
    return pdf.getOutline().then(function (ol) {
      if (!ol || ol.length < 2) return null;
      return Promise.all(ol.slice(0, 120).map(function (o) {
        var d = o.dest; var dp = typeof d === "string" ? pdf.getDestination(d) : Promise.resolve(d);
        return dp.then(function (dest) { if (!dest || !dest[0]) return null; return pdf.getPageIndex(dest[0]).then(function (ix) { return { title: String(o.title || "").trim().slice(0, 80) || "Chapter", chunk: chunkForPage(ix + 1) }; }); }).catch(function () { return null; });
      })).then(function (list) { list = list.filter(Boolean); return list.length >= 2 ? list : null; });
    }).catch(function () { return null; }).then(function (list) {
      if (!list) {
        list = [];
        chunks.forEach(function (c) { c.paras.forEach(function (p, j) { if (/^# /.test(p) && (j === 0 || list.length === 0 || /^# (chapter|part|section|adhyay|lesson|\d+[\.\):]?\s)/i.test(p))) { var t = p.slice(2).slice(0, 80); if (!list.length || list[list.length - 1].chunk !== c.i) list.push({ title: t, chunk: c.i }); } }); });
        if (list.length < 2 || list.length > 80) { list = []; for (var i = 0; i < chunks.length; i += 6) list.push({ title: "Part " + (list.length + 1), chunk: i }); }
      }
      list.sort(function (a, b) { return a.chunk - b.chunk; });
      if (list[0].chunk !== 0) list.unshift({ title: "Shuruaat", chunk: 0 });
      var seen = {}; return list.filter(function (c) { if (seen[c.chunk]) return false; seen[c.chunk] = 1; return true; });
    });
  }

  /* ---------- conversion runner ---------- */
  var runner = { bookId: null, stop: false, lastCall: 0, wait: "" };
  var SYS = "Tum ek bahut achhe translator ho. Diye gaye text ko EASY HINGLISH mein badlo: Roman script ki Hindi + simple English words jahan natural lage, jaise ek dost samjha raha ho. Meaning bilkul same rakho — kuch add, skip ya summarize mat karo. Naam, numbers, technical terms same rakho. '# ' se shuru hone wali heading ko heading hi rakho ('# ' ke saath). Lists ko list rakho. Har input paragraph ka EXACTLY ek output paragraph, same order mein.";
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function retryDelay(e) {
    try { var d = (e.body.error.details || []).filter(function (x) { return x.retryDelay; })[0]; if (d) return Math.ceil(parseFloat(d.retryDelay) * 1000); } catch (x) {}
    return 0;
  }
  function gem(body) {
    var wait = Math.max(0, runner.lastCall + MIN_GAP_MS - Date.now());
    return sleep(wait).then(function () { runner.lastCall = Date.now(); return ai().callGemini(body); });
  }
  function textOf(j) { var parts = (((j.candidates || [])[0] || {}).content || {}).parts || []; return parts.filter(function (p) { return p.text && !p.thought; }).map(function (p) { return p.text; }).join("").trim(); }
  function parseJSON(t) { try { return JSON.parse(t); } catch (e) { var m = t.match(/\{[\s\S]*\}/); if (m) try { return JSON.parse(m[0]); } catch (x) {} } return null; }
  function convertChunk(c) {
    if (c.img) {
      return gem({ systemInstruction: { parts: [{ text: SYS }] }, contents: [{ role: "user", parts: [{ text: "Ye ek scanned book page hai. Pehle iska poora text padho (paragraph-wise, headings '# ' ke saath) — woh 'en' mein do. Phir har paragraph ka easy Hinglish version 'hi' mein do (same count). Sirf JSON." }, { inlineData: { mimeType: "image/jpeg", data: c.img.split(",")[1] } }] }],
        generationConfig: { temperature: 0.3, responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { en: { type: "ARRAY", items: { type: "STRING" } }, hi: { type: "ARRAY", items: { type: "STRING" } } }, required: ["en", "hi"] } } })
        .then(function (j) { var o = parseJSON(textOf(j)); if (!o || !Array.isArray(o.hi)) throw new Error("bad output"); c.paras = (o.en || []).map(String); c.hi = o.hi.map(String); c.aligned = c.paras.length === c.hi.length; c.ocr = true; return c; });
    }
    if (!c.paras.length) { c.hi = []; c.aligned = true; return Promise.resolve(c); }
    return gem({ systemInstruction: { parts: [{ text: SYS }] }, contents: [{ role: "user", parts: [{ text: "In " + c.paras.length + " paragraphs ko easy Hinglish mein badlo. JSON do: {\"hi\": [ ...exactly " + c.paras.length + " strings... ]}\n\n" + JSON.stringify(c.paras) }] }],
      generationConfig: { temperature: 0.3, responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { hi: { type: "ARRAY", items: { type: "STRING" } } }, required: ["hi"] } } })
      .then(function (j) { var o = parseJSON(textOf(j)); if (!o || !Array.isArray(o.hi) || !o.hi.length) throw new Error("bad output"); c.hi = o.hi.map(String); c.aligned = c.hi.length === c.paras.length; return c; });
  }
  function setStatus(book, msg) { runner.wait = msg || ""; var el = $("#convStatus"); if (el && ui().bookId === book.id) el.textContent = msg || statusText(book); var el2 = $("#bk-st-" + book.id); if (el2) el2.textContent = msg || statusText(book); }
  function statusText(b) {
    var c = b.conv || {};
    if (c.state === "done") return "Hinglish ready ✓";
    if (runner.bookId === b.id && !runner.stop) return "Hinglish bana raha hoon… " + c.done + "/" + b.chunkCount + " parts";
    if (c.state === "error") return c.msg || "Ruk gaya";
    if (c.done) return "Hinglish: " + c.done + "/" + b.chunkCount + " parts (paused)";
    return "Hinglish abhi nahi bana";
  }
  function startConvert(bid) {
    if (!ai() || !ai().hasKey()) { B.toast("Pehle Settings → Bhav AI mein free Gemini key daalo"); return; }
    if (runner.bookId && runner.bookId !== bid) { B.toast("Ek book pehle se convert ho rahi hai — wo khatam hone do ya pause karo"); return; }
    if (runner.bookId === bid && !runner.stop) return;
    runner.bookId = bid; runner.stop = false;
    getBook(bid).then(function (book) {
      book.conv.state = "running"; book.conv.msg = ""; putBook(book); refreshBits(book);
      var backoff = 15000, fails = 0;
      function step() {
        if (runner.stop) { book.conv.state = "paused"; return putBook(book).then(function () { finish(book); }); }
        if (book.conv.next >= book.chunkCount) { book.conv.state = "done"; return putBook(book).then(function () { B.logEvent("edit", "book", "Hinglish ready: " + book.title); B.toast("“" + book.title + "” Hinglish mein ready ✓"); finish(book); }); }
        return B.IDB.get("chunks", chunkId(bid, book.conv.next)).then(function (c) {
          if (!c) { book.conv.next++; return step(); }
          if (c.hi) { book.conv.next++; book.conv.done = Math.max(book.conv.done, book.conv.next); return step(); }
          setStatus(book, "Hinglish bana raha hoon… " + book.conv.done + "/" + book.chunkCount + " parts (page " + c.pageFrom + ")");
          return convertChunk(c).then(function (c2) {
            fails = 0; backoff = 15000; delete c2.img;
            return B.IDB.put("chunks", c2).then(function () { book.conv.next++; book.conv.done = book.conv.next; return putBook(book); }).then(function () { refreshBits(book); if (ui().route === "books" && ui().bookId === bid) refreshReaderChunk(c2); return step(); });
          }, function (e) {
            var st = e && e.status;
            if (st === 429 || st === 503 || st >= 500 || /Failed to fetch|NetworkError/i.test(String(e && e.message))) {
              if (!navigator.onLine) { book.conv.state = "paused"; book.conv.msg = "Internet gaya — wapas aane pe Resume dabao"; return putBook(book).then(function () { finish(book); }); }
              var ms = Math.max(retryDelay(e), backoff); backoff = Math.min(backoff * 2, 300000); fails++;
              if (fails > 8) { book.conv.state = "error"; book.conv.msg = "Bahut baar limit lagi — thodi der baad Resume karo"; return putBook(book).then(function () { finish(book); }); }
              var until = Date.now() + ms;
              return (function tick() { if (runner.stop) return Promise.resolve(); var left = Math.ceil((until - Date.now()) / 1000); if (left <= 0) return Promise.resolve(); setStatus(book, (st === 429 ? "Free limit lag gayi ⏳ " : "Google busy hai ⏳ ") + left + " sec ruk ke phir shuru…"); return sleep(1000).then(tick); })().then(step);
            }
            if (/bad output/.test(String(e && e.message)) && fails < 2) { fails++; return step(); }
            book.conv.state = "error"; book.conv.msg = ai().friendlyError(e); return putBook(book).then(function () { finish(book); });
          });
        });
      }
      return step();
    });
  }
  function finish(book) { if (runner.bookId === book.id) { runner.bookId = null; runner.stop = false; } setStatus(book, ""); refreshBits(book); }
  function pauseConvert() { runner.stop = true; }
  function refreshBits(book) {
    setStatus(book, runner.wait && runner.bookId === book.id ? runner.wait : "");
    var bar = $("#bk-bar-" + book.id); if (bar) bar.style.transform = "scaleX(" + (book.chunkCount ? book.conv.done / book.chunkCount : 0) + ")";
    var btn = $("#convBtn"); if (btn && ui().bookId === book.id) btn.outerHTML = convButton(book);
    var lb = $("#bk-btn-" + book.id); if (lb) lb.outerHTML = convButton(book, true);
  }
  function convButton(b, list) {
    var id = list ? "bk-btn-" + b.id : "convBtn";
    if (b.conv.state === "done") return '<span id="' + id + '"></span>';
    if (runner.bookId === b.id && !runner.stop) return '<button type="button" class="mini-btn" id="' + id + '" data-pause="' + esc(b.id) + '">' + icon("i-stop") + "Pause</button>";
    return '<button type="button" class="mini-btn primary" id="' + id + '" data-convert="' + esc(b.id) + '">' + icon("i-spark") + (b.conv.done ? "Resume" : "Hinglish banao") + "</button>";
  }

  /* ---------- list view ---------- */
  function renderList() {
    var h = '<div class="page-head"><div><h1>Books</h1><p class="sub">PDF daalo — poori book easy Hinglish mein padho.</p></div></div>';
    h += '<label class="upload-box" for="pdfInput">' + icon("i-upload") + '<span><b>PDF upload karo</b><small>Book ka text yahin phone pe nikalta hai, phir AI Hinglish banata hai</small></span></label><input type="file" id="pdfInput" accept="application/pdf,.pdf" hidden>';
    h += '<div id="importProg" class="panel" hidden><p class="muted-p" id="importMsg">PDF khol raha hoon…</p><div class="bar"><span id="importBar" style="transform:scaleX(0)"></span></div></div>';
    h += '<div id="bookList"><p class="muted-p" style="padding:16px 4px">Load ho raha hai…</p></div>';
    return h;
  }
  function fillList() {
    B.IDB.all("books").then(function (books) {
      var el = $("#bookList"); if (!el) return;
      books.sort(function (a, b) { return (b.lastOpened || b.createdAt) < (a.lastOpened || a.createdAt) ? -1 : 1; });
      if (!books.length) { el.innerHTML = B.emptyBox("Abhi koi book nahi", "Upar se PDF upload karo. English book bhi chalegi — Hinglish mein padhne milegi.", null); return; }
      el.innerHTML = '<div class="book-list">' + books.map(function (b) {
        var readPct = b.chunkCount ? Math.round(((b.read && b.read.chunk) || 0) * 100 / Math.max(1, b.chunkCount - 1)) : 0;
        return '<article class="book-card"><button type="button" class="book-open" data-book="' + esc(b.id) + '"><span class="book-cover">' + esc((b.title || "B").charAt(0).toUpperCase()) + '</span><span class="book-meta"><b>' + esc(b.title) + "</b><small>" + b.pageCount + " pages · " + readPct + "% padha" + (b.scanned ? " · " + b.scanned + " scanned" : "") + '</small></span></button>' +
          '<div class="book-conv"><div class="bar thin"><span id="bk-bar-' + esc(b.id) + '" style="transform:scaleX(' + (b.chunkCount ? b.conv.done / b.chunkCount : 0) + ')"></span></div><div class="book-conv-row"><small id="bk-st-' + esc(b.id) + '">' + esc(statusText(b)) + "</small>" + convButton(b, true) + "</div></div></article>";
      }).join("") + "</div>";
    });
  }

  /* ---------- reader ---------- */
  var cur = { book: null, chapter: 0, chunks: [], showEn: {} };
  function chapterOf(book, chunkIx) { var ch = 0; (book.chapters || []).forEach(function (c, i) { if (c.chunk <= chunkIx) ch = i; }); return ch; }
  function chapterRange(book, ch) { var c = book.chapters || [{ chunk: 0 }]; var from = c[ch] ? c[ch].chunk : 0; var to = c[ch + 1] ? c[ch + 1].chunk - 1 : book.chunkCount - 1; return [from, Math.max(from, to)]; }
  function renderReader() {
    var s = rs();
    return '<div class="reader" style="--rs:' + s.size + 'px;--rlh:' + s.lh + '"><div class="reader-top"><button type="button" class="icon-btn" id="rBack" aria-label="Books">' + icon("i-chev-l") + '</button><div class="rt-title"><b id="rTitle">…</b><small id="rSub"></small></div>' +
      '<button type="button" class="icon-btn" id="rChapters" aria-label="Chapters">' + icon("i-note") + '</button><button type="button" class="icon-btn" id="rMarks" aria-label="Bookmarks">' + icon("i-bookmark") + '</button><button type="button" class="icon-btn" id="rFont" aria-label="Font size">Aa</button><button type="button" class="icon-btn" id="rTools" aria-label="Smart tools">' + icon("i-spark") + "</button></div>" +
      '<div class="bar thin rprog"><span id="rProg" style="transform:scaleX(0)"></span></div>' +
      '<div class="conv-banner" id="convBanner" hidden><small id="convStatus"></small><span id="convBtn"></span></div>' +
      '<div class="font-pop" id="fontPop" hidden><button type="button" class="mini-btn" data-fs="-1">A−</button><button type="button" class="mini-btn" data-fs="1">A+</button><button type="button" class="mini-btn" data-lh="1">Line spacing</button></div>' +
      '<article class="reader-body" id="rBody"><p class="muted-p">Khol raha hoon…</p></article>' +
      '<div class="reader-nav"><button type="button" class="btn" id="rPrev">' + icon("i-chev-l") + 'Pichla</button><button type="button" class="btn" id="rNext">Agla' + icon("i-chev-r") + "</button></div>" +
      '<div class="sel-pill" id="selPill" hidden><button type="button" class="btn btn-primary" id="selSave">' + icon("i-note") + "Selected text → Notes</button></div></div>";
  }
  function paraHtml(c, j, text, en) {
    var head = /^#\s/.test(text); var t = head ? text.replace(/^#+\s*/, "") : text;
    return '<p class="rp' + (head ? " rh" : "") + (en ? " en" : "") + '" data-c="' + c.i + '" data-p="' + j + '">' + esc(t) + "</p>";
  }
  function chunkHtml(c) {
    var h = '<section class="rchunk" id="rc-' + c.i + '" data-c="' + c.i + '">';
    if (c.img && !c.hi) return h + '<div class="scan-note">📷 Page ' + c.pageFrom + " scanned hai — Hinglish banate waqt AI ise padh lega.</div></section>";
    var showEn = cur.showEn[c.i] || !c.hi;
    if (c.hi && !c.aligned && cur.showEn[c.i]) { h += c.paras.map(function (p, j) { return paraHtml(c, j, p, true); }).join(""); }
    else if (showEn) { if (!c.hi) h += '<div class="scan-note subtle">Ye hissa abhi English mein hai (Hinglish nahi bana)</div>'; h += c.paras.map(function (p, j) { return paraHtml(c, j, p, !!c.hi || true); }).join(""); }
    else h += c.hi.map(function (p, j) { return paraHtml(c, j, (cur.showEn[c.i + ":" + j] && c.aligned) ? c.paras[j] : p, cur.showEn[c.i + ":" + j] && c.aligned); }).join("");
    return h + "</section>";
  }
  function openBook(bid) { ui().bookId = bid; location.hash = "#/books"; if (ui().route === "books") B.render(); }
  function loadReader() {
    getBook(ui().bookId).then(function (book) {
      if (!book) { ui().bookId = null; B.render(); return; }
      cur.book = book; book.lastOpened = B.now(); putBook(book);
      if (cur.chapter == null || cur.bookId !== book.id) { cur.bookId = book.id; cur.chapter = chapterOf(book, book.read.chunk || 0); cur.showEn = {}; cur.jump = book.read; }
      $("#rTitle").textContent = book.title;
      showChapter();
      var ban = $("#convBanner"); if (book.conv.state !== "done") { ban.hidden = false; $("#convStatus").textContent = runner.bookId === book.id && runner.wait ? runner.wait : statusText(book); $("#convBtn").outerHTML = convButton(book); }
    });
  }
  function showChapter() {
    var book = cur.book, r = chapterRange(book, cur.chapter);
    var chs = book.chapters || []; $("#rSub").textContent = (chs[cur.chapter] ? chs[cur.chapter].title + " · " : "") + "Ch " + (cur.chapter + 1) + "/" + Math.max(1, chs.length);
    $("#rProg").style.transform = "scaleX(" + ((r[1] + 1) / Math.max(1, book.chunkCount)) + ")";
    $("#rPrev").disabled = cur.chapter <= 0; $("#rNext").disabled = cur.chapter >= chs.length - 1;
    getChunks(book.id, r[0], r[1]).then(function (chunks) {
      cur.chunks = chunks; var body = $("#rBody"); if (!body) return;
      body.innerHTML = chunks.map(chunkHtml).join("") || '<p class="muted-p">Is hisse mein text nahi mila.</p>';
      if (cur.jump) { var el = body.querySelector('[data-c="' + cur.jump.chunk + '"][data-p="' + (cur.jump.para || 0) + '"]') || $("#rc-" + cur.jump.chunk); cur.jump = null; if (el) { el.scrollIntoView({ block: "start" }); window.scrollBy(0, -110); return; } }
      window.scrollTo(0, 0);
    });
  }
  function refreshReaderChunk(c) {
    var el = $("#rc-" + c.i); if (!el) return; var i = cur.chunks.findIndex(function (x) { return x.i === c.i; }); if (i > -1) cur.chunks[i] = c;
    el.outerHTML = chunkHtml(c);
    if (cur.book) { $("#convStatus") && ($("#convStatus").textContent = runner.wait || statusText(cur.book)); }
  }
  var savePos = B.debounce(function () {
    if (!cur.book || ui().route !== "books" || !ui().bookId) return;
    var ps = $$("#rBody .rp"), top = null;
    for (var i = 0; i < ps.length; i++) { var r = ps[i].getBoundingClientRect(); if (r.bottom > 120) { top = ps[i]; break; } }
    if (!top) return; var c = +top.getAttribute("data-c"), p = +top.getAttribute("data-p");
    cur.book.read = { chunk: c, para: p, at: B.now() }; putBook(cur.book);
  }, 900);
  function paraActions(pEl) {
    var old = $(".para-act"); if (old) { var was = old.previousElementSibling === pEl; old.remove(); if (was) return; }
    var c = +pEl.getAttribute("data-c"), j = +pEl.getAttribute("data-p"); var ch = cur.chunks.filter(function (x) { return x.i === c; })[0]; if (!ch) return;
    var hasHi = !!ch.hi, isEn = pEl.classList.contains("en");
    pEl.insertAdjacentHTML("afterend", '<div class="para-act">' + (hasHi ? '<button type="button" class="mini-btn" data-pa="toggle">' + (isEn ? "Hinglish" : "English") + "</button>" : "") +
      '<button type="button" class="mini-btn" data-pa="mark">' + icon("i-bookmark") + 'Bookmark</button><button type="button" class="mini-btn" data-pa="note">' + icon("i-note") + 'Notes mein</button><button type="button" class="mini-btn" data-pa="copy">' + icon("i-copy") + "Copy</button></div>");
    var box = pEl.nextElementSibling;
    box.addEventListener("click", function (e) {
      var b = e.target.closest("[data-pa]"); if (!b) return; var a = b.getAttribute("data-pa"); var text = pEl.textContent;
      if (a === "toggle") { if (ch.aligned) cur.showEn[c + ":" + j] = !cur.showEn[c + ":" + j]; else cur.showEn[c] = !cur.showEn[c]; refreshReaderChunk(ch); }
      if (a === "mark") { cur.book.bookmarks = (cur.book.bookmarks || []).filter(function (m) { return !(m.chunk === c && m.para === j); }); cur.book.bookmarks.unshift({ chunk: c, para: j, text: text.slice(0, 140), at: B.now() }); putBook(cur.book); B.toast("Bookmark lag gaya 🔖"); box.remove(); }
      if (a === "note") { saveNote(text); box.remove(); }
      if (a === "copy") { B.copyText(text); box.remove(); }
    });
  }
  function saveNote(text, title, kind) {
    var ts = B.now(); var book = cur.book;
    B.db.items.push({ id: B.uid(), type: "note", kind: kind || "reference", title: (title || ("📚 " + book.title + " — highlight")).slice(0, 120), body: text, tags: ["book", B.parseTags(book.title)[0] || "book"].filter(function (v, i, a) { return a.indexOf(v) === i; }), fav: false, createdAt: ts, updatedAt: ts });
    B.save(); B.toast("Notes mein save ho gaya ✓");
  }
  function sheet(title, html) {
    var d = $("#bookSheet"); if (!d) { document.body.insertAdjacentHTML("beforeend", '<dialog id="bookSheet" class="sheet" aria-labelledby="bsTitle"><header class="sheet-head"><div><p class="eyebrow">Book</p><h2 id="bsTitle"></h2></div><button class="icon-btn" type="button" data-close aria-label="Close">' + icon("i-x") + '</button></header><div class="sheet-body" id="bsBody"></div></dialog>'); d = $("#bookSheet"); d.addEventListener("click", function (e) { if (e.target === d) d.close(); }); }
    $("#bsTitle").textContent = title; $("#bsBody").innerHTML = html; if (!d.open) d.showModal(); return $("#bsBody");
  }
  function chaptersSheet() {
    var b = cur.book; var body = sheet("Chapters", '<div class="list">' + (b.chapters || []).map(function (c, i) { return '<button type="button" class="list-item' + (i === cur.chapter ? " on" : "") + '" data-ch="' + i + '"><span class="li-main"><span class="li-title">' + esc(c.title) + '</span><span class="li-sub">Ch ' + (i + 1) + "</span></span></button>"; }).join("") + "</div>" +
      '<div class="actions" style="margin-top:6px"><button type="button" class="btn" id="bsPrint">' + icon("i-download") + 'Hinglish PDF save karo</button><button type="button" class="btn btn-danger-ghost" id="bsDel">' + icon("i-trash") + "Book delete karo</button></div>");
    $$("[data-ch]", body).forEach(function (x) { x.addEventListener("click", function () { cur.chapter = +x.getAttribute("data-ch"); $("#bookSheet").close(); showChapter(); }); });
    $("#bsPrint").addEventListener("click", function () { $("#bookSheet").close(); printBook(); });
    $("#bsDel").addEventListener("click", function () { B.confirmBox("“" + b.title + "” delete karu?", "Book aur uska Hinglish text is phone se hat jayega.", [{ label: "Nahi", value: false }, { label: "Delete", value: true, cls: "btn-danger" }]).then(function (ok) {
      if (!ok) return; if (runner.bookId === b.id) runner.stop = true; $("#bookSheet").close();
      B.IDB.keys("chunks").then(function (keys) { return B.IDB.delMany("chunks", keys.filter(function (k) { return String(k).indexOf(b.id + ":") === 0; })); }).then(function () { return B.IDB.del("books", b.id); }).then(function () { B.logEvent("delete", "book", "Book: " + b.title); ui().bookId = null; B.render(); B.toast("Book delete ho gayi"); });
    }); });
  }
  function marksSheet() {
    var b = cur.book, m = b.bookmarks || [];
    var body = sheet("Bookmarks", m.length ? '<div class="list">' + m.map(function (x, i) { return '<div class="list-item"><button type="button" class="as-link" data-bm="' + i + '"><span class="li-title">' + esc(x.text) + '</span><span class="li-sub">' + esc(B.ago(x.at)) + '</span></button><button type="button" class="icon-btn sm" data-bmdel="' + i + '" aria-label="Remove">' + icon("i-x") + "</button></div>"; }).join("") + "</div>" : '<p class="muted-p">Kisi paragraph pe tap karo → Bookmark.</p>');
    $$("[data-bm]", body).forEach(function (x) { x.addEventListener("click", function () { var bm = m[+x.getAttribute("data-bm")]; $("#bookSheet").close(); cur.chapter = chapterOf(b, bm.chunk); cur.jump = bm; showChapter(); }); });
    $$("[data-bmdel]", body).forEach(function (x) { x.addEventListener("click", function () { m.splice(+x.getAttribute("data-bmdel"), 1); putBook(b); marksSheet(); }); });
  }

  /* ---------- smart tools ---------- */
  var TOOLS = [
    ["summary", "Short summary", "Is text ka short summary do, easy Hinglish mein, 6-8 lines."],
    ["points", "Important points", "Is text ke sabse important points do — bullet list, easy Hinglish, max 10."],
    ["lessons", "Kya seekha", "Is text se kya seekhne ko milta hai? Key lessons bullet list mein, easy Hinglish, har lesson 1-2 line."],
    ["actions", "Action steps", "Ye padh ke real life mein kya karna chahiye? 5-7 practical action steps, easy Hinglish, numbered."],
    ["quiz", "Quiz (5 MCQ)", ""],
    ["onepage", "Ek page mein poori book", "Poori book ek page mein samjhao: main idea, 5-7 sabse bade points, 3 lessons, 1 line mein conclusion. Easy Hinglish, headings ke saath."]
  ];
  function scopeText(scope) {
    var b = cur.book;
    if (scope === "chapter") return Promise.resolve(cur.chunks.map(function (c) { return (c.hi && c.hi.length ? c.hi : c.paras).join("\n\n"); }).join("\n\n"));
    return getChunks(b.id, 0, b.chunkCount - 1).then(function (all) { var t = all.map(function (c) { return c.paras.join("\n\n"); }).join("\n\n"); return t.slice(0, 600000); });
  }
  function toolsSheet(scope) {
    scope = scope || "chapter"; var b = cur.book; var chT = (b.chapters || [])[cur.chapter];
    var body = sheet("Smart tools", '<div class="seg"><button type="button" class="seg-btn" data-scope="chapter" aria-selected="' + (scope === "chapter") + '">Ye chapter</button><button type="button" class="seg-btn" data-scope="book" aria-selected="' + (scope === "book") + '">Poori book</button></div>' +
      '<p class="muted-p">' + esc(scope === "chapter" ? (chT ? chT.title : "Ye hissa") : b.title) + "</p>" +
      '<div class="quick">' + TOOLS.filter(function (t) { return !(t[0] === "onepage" && scope === "chapter"); }).map(function (t) { return '<button type="button" class="quick-btn" data-tool="' + t[0] + '">' + icon("i-spark") + "<span>" + t[1] + "</span></button>"; }).join("") + "</div>" +
      '<form class="ask-row" id="askForm"><input class="input" id="askInput" placeholder="Book se poocho… (jaise: author ka main point kya hai?)"><button class="btn btn-primary" type="submit">Poocho</button></form>' +
      '<div id="toolOut"></div>');
    $$("[data-scope]", body).forEach(function (x) { x.addEventListener("click", function () { toolsSheet(x.getAttribute("data-scope")); }); });
    $$("[data-tool]", body).forEach(function (x) { x.addEventListener("click", function () { runBookTool(x.getAttribute("data-tool"), scope); }); });
    $("#askForm").addEventListener("submit", function (e) { e.preventDefault(); var q = $("#askInput").value.trim(); if (q) runBookTool("ask", scope, q); });
  }
  function toolKey(tool, scope) { return (scope === "chapter" ? "ch" + cur.chapter : "book") + ":" + tool; }
  function runBookTool(tool, scope, q) {
    var out = $("#toolOut"), b = cur.book; if (!out) return;
    var key = toolKey(tool, scope), cached = tool !== "ask" && b.tools && b.tools[key];
    if (cached) { showTool(tool, scope, cached.text, cached.quiz); return; }
    if (!ai() || !ai().hasKey()) { out.innerHTML = '<p class="muted-p">Iske liye <a href="#/settings">Settings</a> mein free Gemini key daalo.</p>'; return; }
    out.innerHTML = '<div class="typing"><span class="dots3"><i></i><i></i><i></i></span><span>Padh ke bana raha hoon…</span></div>';
    scopeText(scope).then(function (text) {
      var t = TOOLS.filter(function (x) { return x[0] === tool; })[0];
      var body = { systemInstruction: { parts: [{ text: "Tum Bhav AI ho. Sirf diye gaye book text ke basis pe jawab do (bahar ki baatein mat jodo). Easy Hinglish (Roman Hindi + simple English)." }] },
        contents: [{ role: "user", parts: [{ text: "Book: " + b.title + "\n\nTEXT:\n" + text + "\n\n---\n" + (tool === "ask" ? "Sawaal: " + q + "\nBook ke text se jawab do. Agar text mein nahi hai toh saaf bolo." : tool === "quiz" ? "Is text pe 5 MCQ quiz banao (Hinglish). Har sawaal ke 4 options, sahi option ka index (0-3) aur 1 line explanation." : t[2]) }] }] };
      if (tool === "quiz") body.generationConfig = { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { questions: { type: "ARRAY", items: { type: "OBJECT", properties: { q: { type: "STRING" }, options: { type: "ARRAY", items: { type: "STRING" } }, answer: { type: "INTEGER" }, why: { type: "STRING" } }, required: ["q", "options", "answer"] } } }, required: ["questions"] } };
      return ai().callGemini(body).then(function (j) {
        var txt = textOf(j); var quiz = null;
        if (tool === "quiz") { var o = parseJSON(txt); quiz = o && o.questions; if (!quiz || !quiz.length) throw new Error("Quiz nahi bana, dobara try karo"); txt = quiz.map(function (x, i) { return (i + 1) + ". " + x.q + "\n" + x.options.map(function (op, k) { return "   " + "ABCD"[k] + ") " + op; }).join("\n") + "\n   Sahi: " + "ABCD"[x.answer] + (x.why ? " — " + x.why : ""); }).join("\n\n"); }
        if (!txt) throw new Error("Khaali jawab aaya");
        if (tool !== "ask") { b.tools = b.tools || {}; b.tools[key] = { text: txt, quiz: quiz, at: B.now() }; putBook(b); }
        showTool(tool, scope, txt, quiz, q);
      });
    }).catch(function (e) { out.innerHTML = '<p class="muted-p">' + esc(ai().friendlyError(e)) + "</p>"; });
  }
  function showTool(tool, scope, txt, quiz, q) {
    var out = $("#toolOut"); if (!out) return; var t = TOOLS.filter(function (x) { return x[0] === tool; })[0]; var label = tool === "ask" ? "Book se poocha: " + q : t[1];
    var h = '<div class="tool-out"><p class="cm-label">' + esc(label) + "</p>";
    if (quiz) {
      h += quiz.map(function (x, i) { return '<div class="quiz-q" data-ans="' + x.answer + '"><p><b>' + (i + 1) + ". " + esc(x.q) + "</b></p>" + x.options.map(function (op, k) { return '<button type="button" class="quiz-op" data-k="' + k + '">' + "ABCD"[k] + ") " + esc(op) + "</button>"; }).join("") + '<p class="quiz-why" hidden>' + esc(x.why || "") + "</p></div>"; }).join("");
    } else h += '<div class="rep-ai">' + ai().md(txt) + "</div>";
    h += '<div class="cf-actions"><button type="button" class="btn btn-primary" id="toolSave">' + icon("i-note") + 'Notes mein save</button><button type="button" class="mini-btn" data-copy-text="' + esc(txt) + '">' + icon("i-copy") + "Copy</button></div></div>";
    out.innerHTML = h;
    $$(".quiz-q", out).forEach(function (qq) { qq.addEventListener("click", function (e) { var op = e.target.closest(".quiz-op"); if (!op || qq.classList.contains("done")) return; var ok = +op.getAttribute("data-k") === +qq.getAttribute("data-ans"); op.classList.add(ok ? "right" : "wrong"); $$(".quiz-op", qq)[+qq.getAttribute("data-ans")].classList.add("right"); qq.classList.add("done"); var w = $(".quiz-why", qq); if (w && w.textContent) w.hidden = false; }); });
    $("#toolSave").addEventListener("click", function (e) { var chT = (cur.book.chapters || [])[cur.chapter]; saveNote(txt, "📚 " + cur.book.title + " — " + label + (scope === "chapter" && chT ? " (" + chT.title + ")" : ""), tool === "lessons" || tool === "points" ? "technique" : "reference"); e.currentTarget.disabled = true; e.currentTarget.textContent = "Saved ✓"; });
  }

  /* ---------- export: print view (Save as PDF) ---------- */
  function printBook() {
    var b = cur.book; B.toast("Print view bana raha hoon…");
    getChunks(b.id, 0, b.chunkCount - 1).then(function (all) {
      var chStarts = {}; (b.chapters || []).forEach(function (c) { chStarts[c.chunk] = c.title; });
      var html = '<div class="print-bar"><button type="button" class="btn btn-primary" id="prGo">' + icon("i-download") + 'Save as PDF / Print</button><button type="button" class="btn" id="prClose">Close</button><small>Print screen mein “Save as PDF” chuno</small></div><div class="print-doc"><h1>' + esc(b.title) + '</h1><p class="pr-sub">Easy Hinglish version · Bhavnote</p>';
      all.forEach(function (c) {
        if (chStarts[c.i] && c.i !== 0) html += '<h2 class="pr-ch">' + esc(chStarts[c.i]) + "</h2>";
        var ps = c.hi && c.hi.length ? c.hi : c.paras; ps.forEach(function (p) { html += /^#\s/.test(p) ? "<h3>" + esc(p.replace(/^#+\s*/, "")) + "</h3>" : "<p>" + esc(p) + "</p>"; });
      });
      html += "</div>";
      var root = document.createElement("div"); root.id = "printRoot"; root.innerHTML = html; document.body.appendChild(root); document.body.classList.add("printing");
      function close() { root.remove(); document.body.classList.remove("printing"); }
      $("#prClose").addEventListener("click", close);
      $("#prGo").addEventListener("click", function () { if (window.BhavnoteAndroid && window.BhavnoteAndroid.printPage) window.BhavnoteAndroid.printPage(b.title + " (Hinglish)"); else window.print(); });
    });
  }

  /* ---------- view wiring ---------- */
  function render() { return ui().bookId ? renderReader() : renderList(); }
  var scrollBound = false;
  function after() {
    if (!scrollBound) {
      scrollBound = true;
      window.addEventListener("scroll", function () { if (ui().route === "books" && ui().bookId) savePos(); }, { passive: true });
      $("#view").addEventListener("click", function (e) {
        if (ui().route !== "books") return;
        var t = e.target.closest("[data-convert],[data-pause],[data-book]"); if (!t) return;
        if (t.hasAttribute("data-convert")) startConvert(t.getAttribute("data-convert"));
        else if (t.hasAttribute("data-pause")) { pauseConvert(); t.disabled = true; t.textContent = "Ruk raha hai…"; }
        else if (t.hasAttribute("data-book")) openBook(t.getAttribute("data-book"));
      });
      var selT = null;
      document.addEventListener("selectionchange", function () {
        if (ui().route !== "books" || !ui().bookId) return;
        clearTimeout(selT); selT = setTimeout(function () { var s = String(window.getSelection() || "").trim(); var pill = $("#selPill"); if (pill) pill.hidden = s.length < 3; }, 250);
      });
    }
    if (!ui().bookId) {
      fillList();
      $("#pdfInput").addEventListener("change", function (e) {
        var f = e.target.files[0]; e.target.value = ""; if (!f) return;
        var box = $("#importProg"); box.hidden = false; $("#importMsg").textContent = "PDF khol raha hoon… (pehli baar thoda time lagega)";
        importPdf(f, function (pg, n) { var m = $("#importMsg"); if (m) m.textContent = "Page " + pg + "/" + n + " padh raha hoon…"; var bar = $("#importBar"); if (bar) bar.style.transform = "scaleX(" + (pg / n) + ")"; })
          .then(function (book) { box.hidden = true; B.toast("“" + book.title + "” add ho gayi ✓"); openBook(book.id); if (ai() && ai().hasKey()) setTimeout(function () { startConvert(book.id); }, 300); })
          .catch(function (err) { console.warn(err); $("#importMsg").textContent = "Ye PDF nahi khul payi" + (/password/i.test(String(err && err.message)) ? " (password wali hai)" : "") + ". Dusri file try karo."; });
      });
      return;
    }
    cur.chapter = cur.bookId === ui().bookId ? cur.chapter : null;
    loadReader();
    $("#rBack").addEventListener("click", function () { ui().bookId = null; B.render(); });
    $("#rPrev").addEventListener("click", function () { if (cur.chapter > 0) { cur.chapter--; showChapter(); } });
    $("#rNext").addEventListener("click", function () { if (cur.book && cur.chapter < (cur.book.chapters || []).length - 1) { cur.chapter++; showChapter(); } });
    $("#rChapters").addEventListener("click", function () { if (cur.book) chaptersSheet(); });
    $("#rMarks").addEventListener("click", function () { if (cur.book) marksSheet(); });
    $("#rTools").addEventListener("click", function () { if (cur.book) toolsSheet(); });
    $("#rFont").addEventListener("click", function () { var p = $("#fontPop"); p.hidden = !p.hidden; });
    $("#fontPop").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return; var s = Object.assign({ size: 18, lh: 1.7 }, B.db.settings.reader || {});
      if (b.hasAttribute("data-fs")) s.size = Math.max(14, Math.min(28, s.size + 2 * +b.getAttribute("data-fs")));
      if (b.hasAttribute("data-lh")) s.lh = s.lh >= 2 ? 1.5 : Math.round((s.lh + 0.25) * 100) / 100;
      B.db.settings.reader = s; B.save(); var r = $(".reader"); r.style.setProperty("--rs", s.size + "px"); r.style.setProperty("--rlh", s.lh);
    });
    $("#rBody").addEventListener("click", function (e) { if (String(window.getSelection() || "").trim()) return; var p = e.target.closest(".rp"); if (p) paraActions(p); });
    $("#selSave").addEventListener("click", function () { var s = String(window.getSelection() || "").trim(); if (s) { saveNote(s); window.getSelection().removeAllRanges(); $("#selPill").hidden = true; } });
  }
  B.VIEWS.books = { render: render, after: after };
  window.BNBooks = { importPdf: importPdf, startConvert: startConvert, pauseConvert: pauseConvert, runner: runner, openBook: openBook };
})();
