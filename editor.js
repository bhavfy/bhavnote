/* Bhavnote — full-screen note editor (Keep-style). Registers window.BNEditor.
   A note is either text (with light markdown: # heading, **bold**, _italic_, - bullets) or a checklist.
   Everything auto-saves; the toolbar rides above the Android keyboard via visualViewport. */
(function () {
  "use strict";
  var B = window.BN; if (!B) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = B.esc, icon = B.icon;

  var COLORS = [["", "Default"], ["graphite", "Graphite"], ["slate", "Slate"], ["teal", "Teal"], ["moss", "Moss"], ["sand", "Sand"], ["wine", "Wine"], ["plum", "Plum"]];
  var KINDS = ["note", "technique", "style", "reference", "idea"];
  var THEME = { "": "#000000", graphite: "#2c2c2e", slate: "#1d2733", teal: "#17302f", moss: "#1f2e22", sand: "#342b1b", wine: "#36212b", plum: "#2b2339" };
  var MAX_MEDIA = 12;
  var ed = null, els = {}, S = null, hist = [], hi = 0, histT = 0, saveT = 0, urls = [], rec = null, ro = 0;

  /* ---------- build the DOM once ---------- */
  var TEMPLATE =
    '<header class="ne-top">' +
      '<button type="button" class="ne-btn" data-ne="back" aria-label="Back">' + icon("i-chev-l") + "</button>" +
      '<span class="ne-stat" id="neStat" aria-live="polite"></span>' +
      '<button type="button" class="ne-btn" data-ne="pin" id="nePin" aria-label="Pin note" aria-pressed="false">' + icon("i-pin") + "</button>" +
      '<button type="button" class="ne-btn" data-ne="archive" id="neArch" aria-label="Archive note">' + icon("i-archive") + "</button>" +
    "</header>" +
    '<div class="ne-main">' +
      '<textarea class="ne-title" id="neTitle" rows="1" maxlength="200" placeholder="Title" aria-label="Title" enterkeyhint="next" autocapitalize="sentences"></textarea>' +
      '<div class="ne-chips" id="neChips" hidden></div>' +
      '<div class="ne-media" id="neMedia" hidden></div>' +
      '<textarea class="ne-body" id="neBody" placeholder="Note" aria-label="Note text" autocapitalize="sentences"></textarea>' +
      '<div class="ne-list" id="neList" hidden></div>' +
      '<div class="ne-prev" id="nePrev" hidden></div>' +
    "</div>" +
    '<div class="ne-fmt" id="neFmt" hidden role="toolbar" aria-label="Text format">' +
      '<button type="button" data-ne="f-b" aria-label="Bold"><b>B</b></button>' +
      '<button type="button" data-ne="f-i" aria-label="Italic"><i>I</i></button>' +
      '<button type="button" data-ne="f-h" aria-label="Heading"><b>H</b></button>' +
      '<button type="button" data-ne="f-ul" aria-label="Bulleted list">' + icon("i-bullet") + "</button>" +
      '<button type="button" data-ne="f-ol" aria-label="Numbered list"><span>1.</span></button>' +
    "</div>" +
    '<footer class="ne-bar" role="toolbar" aria-label="Note tools">' +
      '<button type="button" class="ne-btn" data-ne="plus" aria-label="Add">' + icon("i-plus") + "</button>" +
      '<button type="button" class="ne-btn" data-ne="color" aria-label="Background colour">' + icon("i-palette") + "</button>" +
      '<button type="button" class="ne-btn" data-ne="aa" id="neAa" aria-label="Text format" aria-pressed="false"><span class="aa">Aa</span></button>' +
      '<button type="button" class="ne-btn" data-ne="undo" id="neUndo" aria-label="Undo" disabled>' + icon("i-undo") + "</button>" +
      '<button type="button" class="ne-btn" data-ne="redo" id="neRedo" aria-label="Redo" disabled>' + icon("i-redo") + "</button>" +
      '<span class="grow"></span>' +
      '<button type="button" class="ne-btn" data-ne="more" aria-label="More">' + icon("i-dots") + "</button>" +
    "</footer>" +
    '<div class="ne-scrim" id="neScrim" hidden></div>' +
    '<div class="ne-sheet" id="neSheet" hidden role="dialog" aria-modal="true"></div>' +
    '<div class="ne-viewer" id="neViewer" hidden></div>' +
    '<input type="file" id="neFileImg" accept="image/*" multiple hidden>' +
    '<input type="file" id="neFileCam" accept="image/*" capture="environment" hidden>';

  function build() {
    if (ed) return;
    ed = document.createElement("section"); ed.id = "ne"; ed.className = "ne"; ed.hidden = true;
    ed.setAttribute("role", "dialog"); ed.setAttribute("aria-modal", "true"); ed.setAttribute("aria-label", "Note editor");
    ed.innerHTML = TEMPLATE; document.body.appendChild(ed);
    els = { title: $("#neTitle", ed), body: $("#neBody", ed), list: $("#neList", ed), prev: $("#nePrev", ed), stat: $("#neStat", ed), pin: $("#nePin", ed), arch: $("#neArch", ed),
      undo: $("#neUndo", ed), redo: $("#neRedo", ed), fmt: $("#neFmt", ed), aa: $("#neAa", ed), sheet: $("#neSheet", ed), scrim: $("#neScrim", ed), chips: $("#neChips", ed), media: $("#neMedia", ed), viewer: $("#neViewer", ed),
      fileImg: $("#neFileImg", ed), fileCam: $("#neFileCam", ed) };
    // taps on toolbar buttons must not steal focus from the text (keeps the keyboard and the selection)
    ed.addEventListener("mousedown", function (e) { if (e.target.closest(".ne-bar button, .ne-fmt button, .ne-top button")) e.preventDefault(); });
    ed.addEventListener("click", onClick);
    els.scrim.addEventListener("click", closeSheet);
    els.title.addEventListener("input", function () { fit(els.title); S.dirty = true; sched(); });
    els.title.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); focusBody(); } });
    els.title.addEventListener("beforeinput", function (e) { if (e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") { e.preventDefault(); focusBody(); } });
    els.body.addEventListener("input", function () { S.dirty = true; sched(); histSoon(); });
    els.body.addEventListener("beforeinput", onBodyBeforeInput);
    els.list.addEventListener("input", onListInput);
    els.list.addEventListener("keydown", onListKey);
    els.list.addEventListener("beforeinput", onListBeforeInput);
    ed.addEventListener("keydown", function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); }
      else if (e.key === "Escape") { if (!els.sheet.hidden) closeSheet(); else if (els.viewer && !els.viewer.hidden) closeViewer(); else requestClose(); }
    });
    els.fileImg.addEventListener("change", function () { addImages(els.fileImg.files); els.fileImg.value = ""; });
    els.fileCam.addEventListener("change", function () { addImages(els.fileCam.files); els.fileCam.value = ""; });
    var vv = window.visualViewport;
    if (vv) { vv.addEventListener("resize", fitViewport); vv.addEventListener("scroll", fitViewport); }
    window.addEventListener("resize", fitViewport);
  }

  /* ---------- keyboard-aware sizing: the editor always matches the *visible* area ---------- */
  function fitViewport() {
    if (!ed || ed.hidden || ro) return;
    ro = requestAnimationFrame(function () {
      ro = 0; var vv = window.visualViewport;
      var h = vv ? vv.height : window.innerHeight, t = vv ? vv.offsetTop : 0;
      ed.style.setProperty("--vvh", Math.round(h) + "px"); ed.style.setProperty("--vvt", Math.round(t) + "px");
      var kb = (window.innerHeight - h - t) > 120; ed.classList.toggle("kb", kb);
      if (kb && document.activeElement && /TEXTAREA|INPUT/.test(document.activeElement.tagName)) keepCaret(document.activeElement);
    });
  }
  function keepCaret(el) { // keep the line being typed above the toolbar after the keyboard opens
    try { var r = el.getBoundingClientRect(), box = el.closest(".ne-list, .ne-main"); if (box && el !== els.body) el.scrollIntoView({ block: "nearest" }); } catch (e) {}
  }

  /* ---------- helpers ---------- */
  function fit(el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
  function focusBody() { if (S && S.mode === "list") { var f = $(".ne-it", els.list); if (f) f.focus(); } else { els.body.focus(); try { els.body.setSelectionRange(0, 0); } catch (e) {} } }
  function stat(t) { els.stat.textContent = t || ""; }
  function timeText(iso) { var d = new Date(iso); if (isNaN(d)) return ""; var h = d.getHours(), m = d.getMinutes(); return (h % 12 || 12) + ":" + (m < 10 ? "0" : "") + m + " " + (h < 12 ? "AM" : "PM"); }
  function listToBody(list) { return list.filter(function (x) { return (x.t || "").trim(); }).map(function (x) { return (x.d ? "☑ " : "☐ ") + x.t.trim(); }).join("\n"); }
  function bodyToList(body) {
    var out = String(body || "").split("\n").map(function (ln) {
      var d = /^\s*(☑|\[x\]|\[X\])\s*/.test(ln);
      var t = ln.replace(/^\s*(☑|☐|\[x\]|\[X\]|\[ \]|[-*•]|\d+\.)\s*/, "").replace(/^#{1,3}\s+/, "").trim();
      return t ? { t: t, d: d } : null;
    }).filter(Boolean);
    return out.length ? out : [{ t: "", d: false }];
  }
  function isEmpty() {
    var c = collect(); return !c.title && !c.body.trim() && !((S.it && S.it.media) || S.media || []).length;
  }
  function collect() {
    var title = els.title.value.trim();
    var body = S.mode === "list" ? listToBody(S.list) : els.body.value;
    return { title: title, body: body };
  }

  /* ---------- undo / redo (own stack, so format buttons and typing share it) ---------- */
  function snap() { return S.mode === "list" ? { m: "list", l: JSON.stringify(S.list) } : { m: "text", b: els.body.value, s: els.body.selectionStart, e: els.body.selectionEnd }; }
  function sameSnap(a, b) { return a && b && a.m === b.m && a.b === b.b && a.l === b.l; }
  function pushHist() {
    clearTimeout(histT); if (!S) return;
    var s = snap(); if (sameSnap(s, hist[hi])) { updUndo(); return; }
    hist.splice(hi + 1); hist.push(s); if (hist.length > 120) hist.shift(); hi = hist.length - 1; updUndo();
  }
  function histSoon() { clearTimeout(histT); histT = setTimeout(pushHist, 350); updUndo(); }
  function updUndo() { if (!els.undo) return; els.undo.disabled = !(hi > 0 || (S && !sameSnap(snap(), hist[hi]))); els.redo.disabled = !(hi < hist.length - 1); }
  function restore(s) {
    S.mode = s.m;
    if (s.m === "list") { S.list = JSON.parse(s.l); } else { els.body.value = s.b; }
    applyMode();
    if (s.m === "text") { els.body.focus(); try { els.body.setSelectionRange(s.s, s.e); } catch (e) {} }
    S.dirty = true; sched(); updUndo();
  }
  function undo() { if (!S) return; pushHist(); if (hi > 0) { hi--; restore(hist[hi]); } }
  function redo() { if (!S) return; pushHist(); if (hi < hist.length - 1) { hi++; restore(hist[hi]); } }

  /* ---------- text editing: programmatic edits go through execCommand so the caret scrolls into view ---------- */
  function replaceRange(from, to, text, selS, selE) {
    var b = els.body; b.focus(); b.setSelectionRange(from, to);
    var ok = false; try { ok = document.execCommand("insertText", false, text); } catch (e) {}
    if (!ok) { b.setRangeText(text, from, to, "end"); b.dispatchEvent(new Event("input", { bubbles: true })); }
    b.setSelectionRange(selS == null ? from + text.length : selS, selE == null ? from + text.length : selE);
  }
  function wrapSel(mark) {
    var b = els.body, v = b.value, s = b.selectionStart, e = b.selectionEnd, n = mark.length; pushHist();
    var sel = v.slice(s, e);
    if (s >= n && v.slice(s - n, s) === mark && v.slice(e, e + n) === mark) replaceRange(s - n, e + n, sel, s - n, s - n + sel.length);
    else if (sel.length >= 2 * n && sel.slice(0, n) === mark && sel.slice(-n) === mark) replaceRange(s, e, sel.slice(n, -n), s, e - 2 * n);
    else replaceRange(s, e, mark + sel + mark, s + n, s + n + sel.length);
    pushHist();
  }
  function linePrefix(kind) {
    var b = els.body, v = b.value, s = b.selectionStart, e = b.selectionEnd; pushHist();
    var ls = v.lastIndexOf("\n", s - 1) + 1, le = v.indexOf("\n", e); if (le < 0) le = v.length;
    var lines = v.slice(ls, le).split("\n"), re = { h: /^#{1,3}\s+/, ul: /^[-*]\s+/, ol: /^\d+\.\s+/ }[kind];
    var allHave = lines.every(function (l) { return !l.trim() || re.test(l); });
    var any = lines.some(function (l) { return l.trim(); });
    var n = 0, out = lines.map(function (l) {
      if (!l.trim() && any) return l;
      var bare = l.replace(/^(#{1,3}|[-*]|\d+\.)\s+/, "");
      if (allHave) return bare;
      n++; return (kind === "h" ? "# " : kind === "ul" ? "- " : n + ". ") + bare;
    }).join("\n");
    replaceRange(ls, le, out, ls + out.length, ls + out.length);
    pushHist();
  }
  function onBodyBeforeInput(e) { // Enter continues "- ", "1. " lists; Enter on an empty bullet ends the list
    if (e.inputType !== "insertLineBreak" && e.inputType !== "insertParagraph") return;
    var b = els.body, s = b.selectionStart; if (s !== b.selectionEnd) return;
    var v = b.value, ls = v.lastIndexOf("\n", s - 1) + 1, le = v.indexOf("\n", s); if (le < 0) le = v.length; if (le !== s) return;
    var m = /^(\s*)(- |\* |\d+\. |☐ |☑ )(.*)$/.exec(v.slice(ls, s)); if (!m) return;
    e.preventDefault(); pushHist();
    if (!m[3].trim()) replaceRange(ls, s, "", ls, ls);
    else { var mark = m[2]; if (/^\d+\. $/.test(mark)) mark = (parseInt(mark, 10) + 1) + ". "; if (mark === "☑ ") mark = "☐ "; replaceRange(s, s, "\n" + m[1] + mark); }
  }

  /* ---------- checklist ---------- */
  function rowHtml(i) {
    var x = S.list[i];
    return '<div class="ne-ri' + (x.d ? " done" : "") + '" data-i="' + i + '"><button type="button" class="ne-cb" data-ne="cb" aria-pressed="' + !!x.d + '" aria-label="' + (x.d ? "Mark not done" : "Mark done") + '">' + icon("i-check") + "</button>" +
      '<textarea class="ne-it" rows="1" data-i="' + i + '" aria-label="List item" enterkeyhint="next" placeholder="List item">' + esc(x.t) + "</textarea>" +
      '<button type="button" class="ne-x" data-ne="rm" aria-label="Remove item">' + icon("i-x") + "</button></div>";
  }
  function renderList(focusIdx, atEnd) {
    var open = [], done = []; S.list.forEach(function (x, i) { (x.d ? done : open).push(i); });
    var h = open.map(rowHtml).join("") + '<button type="button" class="ne-addrow" data-ne="addrow">' + icon("i-plus") + "List item</button>";
    if (done.length) h += '<p class="ne-sep">' + done.length + " completed</p>" + done.map(rowHtml).join("");
    els.list.innerHTML = h;
    $$(".ne-it", els.list).forEach(fit);
    if (focusIdx != null) { var t = $('.ne-it[data-i="' + focusIdx + '"]', els.list); if (t) { t.focus(); var p = atEnd === false ? 0 : t.value.length; try { t.setSelectionRange(p, p); } catch (e) {} } }
  }
  function onListInput(e) {
    var t = e.target.closest(".ne-it"); if (!t) return;
    S.list[+t.getAttribute("data-i")].t = t.value; fit(t); S.dirty = true; sched(); histSoon();
  }
  function rowEnter(t) { pushHist(); var i = +t.getAttribute("data-i"); S.list.splice(i + 1, 0, { t: "", d: false }); renderList(i + 1); S.dirty = true; sched(); pushHist(); }
  function rowBackspace(t) {
    var i = +t.getAttribute("data-i"); pushHist();
    if (S.list.length === 1) { t.value = ""; return; }
    S.list.splice(i, 1);
    renderList(Math.max(0, i - 1)); S.dirty = true; sched(); pushHist();
  }
  function onListKey(e) {
    var t = e.target.closest(".ne-it"); if (!t || e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") { e.preventDefault(); rowEnter(t); }
    else if (e.key === "Backspace" && t.value === "") { e.preventDefault(); rowBackspace(t); }
  }
  function onListBeforeInput(e) { // soft keyboards that do not send a usable keydown
    var t = e.target.closest(".ne-it"); if (!t) return;
    if (e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") { e.preventDefault(); rowEnter(t); }
    else if (e.inputType === "deleteContentBackward" && t.value === "") { e.preventDefault(); rowBackspace(t); }
  }
  function applyMode() {
    var list = S.mode === "list";
    els.body.hidden = list || !!S.preview; els.list.hidden = !list || !!S.preview; els.prev.hidden = !S.preview;
    els.aa.hidden = list; if (list) { els.fmt.hidden = true; els.aa.setAttribute("aria-pressed", "false"); }
    if (list) renderList(); else fit(els.title);
  }
  function toggleList() {
    pushHist();
    if (S.mode === "text") { S.list = bodyToList(els.body.value); S.mode = "list"; applyMode(); var last = S.list.length - 1; renderList(S.list[last].t ? null : last); }
    else { els.body.value = S.list.filter(function (x) { return (x.t || "").trim(); }).map(function (x) { return (x.d ? "☑ " : "☐ ") + x.t.trim(); }).join("\n"); S.mode = "text"; applyMode(); }
    S.dirty = true; sched(); pushHist();
  }

  /* ---------- saving ---------- */
  function sched() { clearTimeout(saveT); stat("Saving…"); saveT = setTimeout(function () { commit(false); }, 600); updUndo(); }
  function commit(final) {
    clearTimeout(saveT); if (!S || S.deleted) return;
    if (S.dirty || (final && S.needsLog)) {
      var c = collect(), it = S.it;
      if (!it) {
        if (isEmpty()) { stat(""); S.dirty = false; return; }
        var ts = B.now();
        it = { id: B.uid(), type: "note", title: "", body: "", kind: S.kind || "note", tags: S.tags || [], fav: !!S.fav, createdAt: ts, updatedAt: ts };
        B.db.items.push(it); S.it = it; S.created = true;
      }
      if (S.dirty) {
        it.title = c.title; it.body = c.body; it.updatedAt = B.now(); delete it.sample;
        if (S.mode === "list") { it.mode = "list"; it.list = S.list.filter(function (x) { return (x.t || "").trim(); }); } else { delete it.mode; delete it.list; }
        if (S.color) it.color = S.color; else delete it.color;
        if (S.tint) it.tint = S.tint; else delete it.tint;
        if (S.pinned) it.pinned = true; else delete it.pinned;
        if (S.archived) it.archived = true; else delete it.archived;
        it.kind = S.kind; it.tags = S.tags; it.link = S.link || ""; it.fav = !!S.fav;
        if (S.media && S.media.length) it.media = S.media.slice(); else delete it.media;
        S.dirty = false; S.needsLog = true;
        stat("Edited " + timeText(it.updatedAt));
        if (!final) B.persist(B.db);
      }
      if (final && S.needsLog) { B.save(); S.needsLog = false; }
    }
  }
  function touch() { S.dirty = true; sched(); }

  /* ---------- open / close ---------- */
  function setTheme(on) {
    var m = $('meta[name="theme-color"]'); if (!m) return;
    if (on) { if (m.getAttribute("data-was") == null) m.setAttribute("data-was", m.getAttribute("content") || "#000000"); m.setAttribute("content", S.tint || THEME[S.color || ""] || "#000000"); }
    else if (m.getAttribute("data-was") != null) { m.setAttribute("content", m.getAttribute("data-was")); m.removeAttribute("data-was"); }
  }
  var TINT_PROPS = ["--nc", "--text", "--muted", "--faint", "--ink-on", "--ink-on2", "--tt", "--tt2", "--tile"];
  function applyColor() {
    COLORS.forEach(function (c) { if (c[0]) ed.classList.remove("nc-" + c[0]); });
    ed.classList.remove("nc-custom");
    TINT_PROPS.forEach(function (p) { ed.style.removeProperty(p); });
    var hex = B.okHex(S.tint);
    if (hex) { ed.classList.add("nc-custom"); B.tintPairs(hex).forEach(function (p) { ed.style.setProperty(p[0], p[1]); }); }
    else if (S.color) ed.classList.add("nc-" + S.color);
    setTheme(true);
  }
  function applyFlags() {
    els.pin.setAttribute("aria-pressed", !!S.pinned); els.pin.classList.toggle("on", !!S.pinned); els.pin.setAttribute("aria-label", S.pinned ? "Unpin note" : "Pin note");
    els.arch.setAttribute("aria-label", S.archived ? "Unarchive note" : "Archive note"); els.arch.classList.toggle("on", !!S.archived);
  }
  function renderChips() {
    var h = (S.tags || []).map(function (t) { return '<button type="button" class="ne-chip" data-ne="details">#' + esc(t) + "</button>"; }).join("");
    var l = B.safeUrl(S.link);
    if (l) h += '<a class="ne-chip" href="' + esc(l) + '" target="_blank" rel="noopener">' + icon("i-ext") + esc(l.replace(/^https?:\/\/(www\.)?/, "").slice(0, 34)) + "</a>";
    els.chips.innerHTML = h; els.chips.hidden = !h;
  }
  function open(id, preset) {
    build(); if (S) closeNow(true);
    var it = id ? B.byId(id) : null; preset = preset || {};
    S = { it: it, mode: it && it.mode === "list" && Array.isArray(it.list) ? "list" : "text", list: [], color: it ? it.color || "" : preset.color || "", tint: it ? B.okHex(it.tint) : "", pinned: !!(it && it.pinned), archived: !!(it && it.archived),
      kind: it ? it.kind || "note" : preset.kind || "note", tags: it ? (it.tags || []).slice() : (preset.tags || []).slice(), link: it ? it.link || "" : preset.link || "", fav: !!(it && it.fav), media: it ? (it.media || []).slice() : [],
      dirty: false, needsLog: false, scrollY: window.scrollY, route: B.ui.route };
    if (S.mode === "list") S.list = it.list.map(function (x) { return { t: String(x.t || ""), d: !!x.d }; });
    els.title.value = it ? it.title || "" : preset.title || "";
    els.body.value = it ? (S.mode === "list" ? "" : it.body || "") : preset.body || "";
    if (!it && (preset.title || preset.body)) S.dirty = true;
    S.preview = false; els.fmt.hidden = true; els.aa.setAttribute("aria-pressed", "false");
    hist = []; hi = 0; closeSheet(true); closeViewer(); applyColor(); applyFlags(); renderChips(); renderMedia();
    stat(it ? "Edited " + timeText(it.updatedAt) : "");
    ed.hidden = false; fitViewport(); applyMode(); hist = [snap()]; hi = 0; updUndo();
    document.documentElement.classList.add("ne-lock");
    $$(".shell, .bottomnav, .fab").forEach(function (n) { try { n.inert = true; } catch (e) {} });
    void ed.offsetWidth; ed.classList.add("open");
    try { history.pushState({ bnNote: 1 }, "", location.href); } catch (e) {}
    if (!it) setTimeout(function () { if (S && !S.it) els.title.focus(); }, 300);
    if (it && it.body && it.body.length > 30000) stat("Long note · " + Math.round(it.body.length / 1000) + "k characters");
  }
  function requestClose() { if (!S) return; if (history.state && history.state.bnNote) history.back(); else closeNow(); }
  function closeNow(quick) {
    if (!S) return;
    var s = S; commit(true); stopRec(true);
    if (!quick) { ed.classList.remove("open"); }
    document.documentElement.classList.remove("ne-lock");
    $$(".shell, .bottomnav, .fab").forEach(function (n) { try { n.inert = false; } catch (e) {} });
    setTheme(false); closeSheet(true); closeViewer(); if (document.activeElement) try { document.activeElement.blur(); } catch (e) {}
    urls.forEach(function (u) { URL.revokeObjectURL(u); }); urls = [];
    S = null; clearTimeout(histT);
    var done = function () { ed.hidden = true; ed.classList.remove("open"); refreshList(s); };
    if (quick) { done(); } else setTimeout(done, 350);
  }
  function refreshList(s) {
    var r = B.ui.route, it = s.it;
    if (!it) return;
    var node = $('#view [data-open="' + (window.CSS && CSS.escape ? CSS.escape(it.id) : it.id) + '"]');
    var card = node && node.closest("article.card");
    var listy = r === "notes" || r === "favorites";
    if (s.created || r === "dashboard" || !listy || s.pinChanged || (!card && !s.deleted)) { B.render(); if (s.created) window.scrollTo(0, 0); else window.scrollTo(0, s.scrollY || 0); return; }
    if (s.archChanged || s.deleted) { if (card) card.remove(); var g = $("#gridList"); if (g && !g.querySelector("article.card")) B.render(); return; }
    if (card && !s.deleted) { var tmp = document.createElement("div"); tmp.innerHTML = B.cardHtml(it); if (tmp.firstElementChild) card.replaceWith(tmp.firstElementChild); }
  }
  window.addEventListener("popstate", function () { if (S) closeNow(); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("pagehide", flush);
  function flush() { if (S) { pushHist(); commit(true); } }

  /* ---------- sheets ---------- */
  var sheetTok = 0;
  function openSheet(html, cls) {
    sheetTok++;
    if (document.activeElement && /TEXTAREA|INPUT/.test(document.activeElement.tagName)) document.activeElement.blur();
    els.sheet.className = "ne-sheet" + (cls ? " " + cls : ""); els.sheet.innerHTML = html;
    els.scrim.hidden = false; els.sheet.hidden = false; void els.sheet.offsetWidth; els.sheet.classList.add("open"); els.scrim.classList.add("open");
  }
  function closeSheet(instant) {
    if (!els.sheet || els.sheet.hidden) return;
    els.sheet.classList.remove("open"); els.scrim.classList.remove("open");
    var tok = ++sheetTok;
    var fin = function () { if (tok !== sheetTok) return; els.sheet.hidden = true; els.scrim.hidden = true; els.sheet.innerHTML = ""; };
    if (instant === true) fin(); else setTimeout(fin, 240);
  }
  function row(act, ic, label, extra) { return '<button type="button" class="ne-sr' + (extra && extra.danger ? " danger" : "") + '" data-ne="' + act + '">' + icon(ic) + "<span>" + label + "</span></button>"; }
  function sheetPlus() {
    openSheet('<p class="ne-sh">Add</p>' + row("togglelist", "i-checkbox", S.mode === "list" ? "Hide checkboxes (plain text)" : "Checklist") + row("photo", "i-camera", "Take photo") + row("image", "i-image", "Add image") + row("voice", "i-mic", "Voice note") + row("details", "i-link", "Link, labels & tags"));
  }
  var LEGACY_HEX = { graphite: "#2c2c2e", slate: "#1d2733", teal: "#17302f", moss: "#1f2e22", sand: "#342b1b", wine: "#36212b", plum: "#2b2339" };
  function sheetColor() {
    var cur = B.okHex(S.tint), legacy = !cur && S.color && LEGACY_HEX[S.color] ? S.color : "";
    var sw = function (hex, name, on, attr) { return '<button type="button" class="ne-sw' + (on ? " sel" : "") + '" ' + attr + ' role="radio" aria-checked="' + on + '" aria-label="' + name + '"><i class="sw" style="background:' + hex + ";color:" + B.inkFor(hex) + '">' + icon("i-check") + "</i><span>" + name + "</span></button>"; };
    var h = '<p class="ne-sh">Background</p><div class="ne-swatches" role="radiogroup" aria-label="Background colour">';
    h += sw("#f5efe2", "Default", !cur && !legacy, 'data-ne="setcolor" data-c=""');
    if (legacy) h += sw(LEGACY_HEX[legacy], B.cap(legacy), true, 'data-ne="setcolor" data-c=""');
    B.PALETTE.forEach(function (c) { h += sw(c[2], c[1], cur === c[2], 'data-ne="setpalette" data-c="' + c[2] + '"'); });
    h += '</div><div class="ne-pickrow"><label class="ne-pick"><span>Apna rang</span><input type="color" id="nePick" value="' + (cur || "#f2c14e") + '"></label>' +
      '<button type="button" class="ne-reset" data-ne="setcolor" data-c="">Reset</button></div>';
    openSheet(h);
    var pick = els.sheet.querySelector("#nePick");
    if (pick) pick.addEventListener("input", function () {
      var v = B.okHex(pick.value); if (!v || !S) return;
      S.tint = v; S.color = ""; applyColor(); touch(); markSw(null);
    });
  }
  function markSw(on) { $$(".ne-sw", els.sheet).forEach(function (x) { var y = x === on; x.classList.toggle("sel", y); x.setAttribute("aria-checked", y); }); }
  function sheetMore() {
    openSheet('<p class="ne-sh">More</p>' + row("delete", "i-trash", "Delete", { danger: true }) + row("dup", "i-dup", "Make a copy") + row("copy", "i-copy", "Copy text") + row("share", "i-share", "Share") +
      row("fav", "i-star", S.fav ? "Remove from favorites" : "Add to favorites") + row("preview", "i-eye", S.preview ? "Back to editing" : "Formatted preview") + row("plan", "i-cal", "Make a Content plan from this note") + row("details", "i-tag", "Link, labels & tags"), "scroll");
  }
  function sheetDetails() {
    openSheet('<p class="ne-sh">Details</p><div class="ne-form"><label for="neKind">Type</label><select class="select" id="neKind">' + KINDS.map(function (k) { return '<option value="' + k + '"' + (S.kind === k ? " selected" : "") + ">" + B.cap(k) + "</option>"; }).join("") + "</select>" +
      '<label for="neTags">Tags</label><input class="input" id="neTags" value="' + esc((S.tags || []).join(", ")) + '" placeholder="premiere, color, delivery" autocapitalize="none">' +
      '<label for="neLink">Link</label><input class="input" id="neLink" type="url" inputmode="url" value="' + esc(S.link || "") + '" placeholder="https://…" autocapitalize="none"></div>', "scroll");
    $("#neKind", ed).addEventListener("change", function (e) { S.kind = e.target.value; touch(); });
    $("#neTags", ed).addEventListener("input", function (e) { S.tags = B.parseTags(e.target.value); renderChips(); touch(); });
    $("#neLink", ed).addEventListener("input", function (e) { S.link = e.target.value.trim(); renderChips(); touch(); });
  }

  /* ---------- actions ---------- */
  function onClick(e) {
    var b = e.target.closest("[data-ne]"); if (!b || !S) return;
    var a = b.getAttribute("data-ne");
    switch (a) {
      case "back": requestClose(); break;
      case "pin": S.pinned = !S.pinned; if (S.pinned && S.archived) S.archived = false; S.pinChanged = true; applyFlags(); touch(); B.toast(S.pinned ? "Pinned" : "Unpinned"); break;
      case "archive": doArchive(); break;
      case "plus": sheetPlus(); break;
      case "color": sheetColor(); break;
      case "more": sheetMore(); break;
      case "aa": els.fmt.hidden = !els.fmt.hidden; els.aa.setAttribute("aria-pressed", String(!els.fmt.hidden)); els.body.focus(); break;
      case "undo": undo(); break;
      case "redo": redo(); break;
      case "f-b": wrapSel("**"); break;
      case "f-i": wrapSel("_"); break;
      case "f-h": linePrefix("h"); break;
      case "f-ul": linePrefix("ul"); break;
      case "f-ol": linePrefix("ol"); break;
      case "togglelist": closeSheet(); toggleList(); break;
      case "details": sheetDetails(); break;
      case "setcolor": S.color = ""; S.tint = ""; applyColor(); touch(); markSw(b); break;
      case "setpalette": S.color = ""; S.tint = B.okHex(b.getAttribute("data-c")); applyColor(); touch(); markSw(b); break;
      case "cb": var i = +b.closest(".ne-ri").getAttribute("data-i"); pushHist(); S.list[i].d = !S.list[i].d; renderList(); touch(); pushHist(); break;
      case "rm": var j = +b.closest(".ne-ri").getAttribute("data-i"); pushHist(); S.list.splice(j, 1); if (!S.list.length) S.list.push({ t: "", d: false }); renderList(); touch(); pushHist(); break;
      case "addrow": pushHist(); S.list.push({ t: "", d: false }); renderList(S.list.length - 1); touch(); break;
      case "delete": closeSheet(); doDelete(); break;
      case "dup": closeSheet(); doDup(); break;
      case "copy": closeSheet(); B.copyText(textForShare()); break;
      case "share": closeSheet(); doShare(); break;
      case "fav": S.fav = !S.fav; touch(); closeSheet(); B.toast(S.fav ? "Added to favorites" : "Removed from favorites"); break;
      case "preview": closeSheet(); S.preview = !S.preview; if (S.preview) { els.prev.innerHTML = renderMd(collect().body, S.mode === "list"); } applyMode(); break;
      case "plan": closeSheet(); doPlan(); break;
      case "photo": closeSheet(); els.fileCam.click(); break;
      case "image": closeSheet(); els.fileImg.click(); break;
      case "voice": closeSheet(); startRec(); break;
      case "mi": openViewer(b.getAttribute("data-id")); break;
      case "vclose": closeViewer(); break;
      case "vdel": doRemoveMedia(b.getAttribute("data-id")); break;
      case "adel": doRemoveMedia(b.getAttribute("data-id")); break;
      case "aplay": togglePlay(b); break;
      case "recstop": stopRec(false); break;
      case "reccancel": stopRec(true); break;
    }
  }
  function textForShare() { var c = collect(); return (c.title ? c.title + "\n\n" : "") + c.body; }
  function doShare() {
    var txt = textForShare(); if (!txt.trim()) { B.toast("Share karne ko kuch nahi hai"); return; }
    if (navigator.share) navigator.share({ title: els.title.value.trim() || "Note", text: txt }).catch(function () {}); else B.copyText(txt);
  }
  function doPlan() {
    var c = collect(); if (!c.title && !c.body.trim()) { B.toast("Pehle note mein kuch likho"); return; }
    var first = (c.title || B.mdPlain(c.body.split("\n")[0])).slice(0, 80);
    commit(true);
    requestClose(); setTimeout(function () { B.openEditor("post", null, { title: first, hook: first, notes: c.body.slice(0, 1500), platform: "reel", status: "idea", date: "", tags: [] }); }, 380);
  }
  function doDup() {
    commit(true); var c = collect(); if (!c.title && !c.body.trim()) { B.toast("Khaali note ki copy nahi ban sakti"); return; }
    var src = S.it, ts = B.now(); var cp = Object.assign({}, src, { id: B.uid(), title: (src.title ? src.title + " (copy)" : ""), createdAt: ts, updatedAt: ts });
    delete cp.pinned; delete cp.media; delete cp.sample; B.db.items.push(cp); B.save(); B.toast("Copy ban gayi"); S.created = true;
  }
  function doArchive() {
    var c = collect(); if (!S.it && isEmpty()) { B.toast("Pehle note mein kuch likho"); return; }
    S.archived = !S.archived; if (S.archived) S.pinned = false; S.archChanged = true; S.dirty = true; commit(true);
    var it = S.it, was = S.archived; applyFlags();
    requestClose();
    B.toast(was ? "Note archive ho gaya" : "Note wapas aa gaya", "Undo", function () { it.archived = was ? undefined : true; if (!it.archived) delete it.archived; it.updatedAt = B.now(); B.save(); B.render(); });
  }
  function doDelete() {
    if (!S.it) { S.deleted = true; requestClose(); return; }
    var it = S.it, t = it.title || "this note";
    B.confirmBox("Delete “" + t + "”?", "Ye note delete ho jayega. Undo ka option milega.", [{ label: "Cancel", value: null }, { label: "Delete", value: true, cls: "btn-danger" }]).then(function (ok) {
      if (!ok || !S) return;
      var idx = B.db.items.indexOf(it); S.deleted = true; clearTimeout(saveT);
      if (idx > -1) B.db.items.splice(idx, 1); B.save(); requestClose();
      B.toast("Note delete ho gaya", "Undo", function () { B.db.items.splice(Math.min(idx, B.db.items.length), 0, it); B.save(); B.render(); });
    });
  }

  /* ---------- formatted preview (read-only) ---------- */
  function inline(s) {
    s = esc(s);
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>").replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, "$1<i>$2</i>");
    s = s.replace(/(https?:\/\/[^\s<]+)/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener">' + u + "</a>"; });
    return s;
  }
  function renderMd(text) {
    var out = "", ul = false;
    String(text || "").split("\n").forEach(function (ln) {
      var m;
      if ((m = /^(#{1,3})\s+(.*)$/.exec(ln))) { if (ul) { out += "</ul>"; ul = false; } out += "<h" + (m[1].length + 1) + ">" + inline(m[2]) + "</h" + (m[1].length + 1) + ">"; }
      else if ((m = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(ln))) { if (!ul) { out += "<ul>"; ul = true; } out += "<li>" + inline(m[2]) + "</li>"; }
      else if ((m = /^\s*(☐|☑)\s+(.*)$/.exec(ln))) { if (!ul) { out += "<ul class=\"chk\">"; ul = true; } out += '<li class="' + (m[1] === "☑" ? "d" : "") + '">' + (m[1] === "☑" ? "☑ " : "☐ ") + inline(m[2]) + "</li>"; }
      else { if (ul) { out += "</ul>"; ul = false; } out += ln.trim() ? "<p>" + inline(ln) + "</p>" : '<p class="sp"></p>'; }
    });
    return out + (ul ? "</ul>" : "");
  }

  /* ---------- photos & voice notes (files live in IndexedDB, only the list of ids lives in the note) ---------- */
  var MK = function (id) { return "media:" + id; };
  function renderMedia() {
    var m = S.media || [];
    urls.forEach(function (u) { URL.revokeObjectURL(u); }); urls = [];
    els.media.hidden = !m.length; if (!m.length) { els.media.innerHTML = ""; return; }
    els.media.innerHTML = m.map(function (x) {
      if (x.k === "img") return '<button type="button" class="ne-thumb" data-ne="mi" data-id="' + esc(x.id) + '" aria-label="Open image"><img alt="" decoding="async"></button>';
      return '<div class="ne-aud" data-id="' + esc(x.id) + '"><button type="button" class="ne-play" data-ne="aplay" data-id="' + esc(x.id) + '" aria-label="Play voice note">▶</button><span class="ne-ad"><i></i></span><span class="ne-at">' + fmtDur(x.d) + '</span><button type="button" class="ne-x" data-ne="adel" data-id="' + esc(x.id) + '" aria-label="Delete voice note">' + icon("i-x") + "</button></div>";
    }).join("");
    m.forEach(function (x) {
      B.IDB.get("kv", MK(x.id)).then(function (row) {
        if (!row || !row.blob || !S || !ed) return; var u = URL.createObjectURL(row.blob); urls.push(u);
        var host = $('[data-id="' + x.id + '"]', els.media); if (!host) return;
        if (x.k === "img") { var im = $("img", host); if (im) im.src = u; } else host.setAttribute("data-src", u);
      }).catch(function () {});
    });
  }
  function fmtDur(s) { s = Math.round(+s || 0); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
  var audio = null, playingBtn = null;
  function togglePlay(btn) {
    var host = btn.closest(".ne-aud"), src = host && host.getAttribute("data-src"); if (!src) { B.toast("Voice note load ho raha hai…"); return; }
    if (audio && playingBtn === btn) { audio.pause(); return; }
    if (audio) { audio.pause(); }
    audio = new Audio(src); playingBtn = btn; btn.textContent = "❚❚";
    var bar = $(".ne-ad i", host);
    audio.addEventListener("timeupdate", function () { if (bar && audio && audio.duration) bar.style.transform = "scaleX(" + (audio.currentTime / audio.duration).toFixed(3) + ")"; });
    var reset = function () { btn.textContent = "▶"; if (bar) bar.style.transform = "scaleX(0)"; if (playingBtn === btn) playingBtn = null; };
    audio.addEventListener("pause", reset); audio.addEventListener("ended", reset);
    audio.play().catch(function () { reset(); B.toast("Play nahi ho paaya"); });
  }
  function shrink(file) {
    var max = 1600;
    function draw(src, w, h) {
      var k = Math.min(1, max / Math.max(w, h)), cw = Math.round(w * k), ch = Math.round(h * k), c = document.createElement("canvas"); c.width = cw; c.height = ch;
      var g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, cw, ch); g.drawImage(src, 0, 0, cw, ch);
      return new Promise(function (res, rej) { c.toBlob(function (b) { b ? res({ blob: b, w: cw, h: ch }) : rej(new Error("toBlob")); }, "image/jpeg", 0.82); });
    }
    if (window.createImageBitmap) return createImageBitmap(file).then(function (bm) { return draw(bm, bm.width, bm.height).then(function (r) { if (bm.close) bm.close(); return r; }); });
    return new Promise(function (res, rej) { var u = URL.createObjectURL(file), im = new Image(); im.onload = function () { draw(im, im.naturalWidth, im.naturalHeight).then(function (r) { URL.revokeObjectURL(u); res(r); }, rej); }; im.onerror = function () { rej(new Error("img")); }; im.src = u; });
  }
  function addMedia(rowObj, meta) {
    return B.IDB.put("kv", Object.assign({ id: MK(meta.id) }, rowObj)).then(function () { S.media.push(meta); renderMedia(); touch(); });
  }
  function addImages(files) {
    if (!S || !files || !files.length) return; var arr = Array.prototype.slice.call(files);
    if ((S.media || []).length + arr.length > MAX_MEDIA) { B.toast("Ek note mein max " + MAX_MEDIA + " photos/voice notes"); arr = arr.slice(0, Math.max(0, MAX_MEDIA - S.media.length)); }
    if (!arr.length) return; B.toast("Photo add ho rahi hai…");
    arr.reduce(function (p, f) {
      return p.then(function () { return shrink(f).then(function (r) { var id = B.uid(); return addMedia({ blob: r.blob, k: "img", w: r.w, h: r.h, at: B.now() }, { id: id, k: "img", w: r.w, h: r.h }); }); })
        .catch(function () { B.toast("Ye photo add nahi ho paayi"); });
    }, Promise.resolve());
  }
  function openViewer(id) {
    var m = (S.media || []).filter(function (x) { return x.id === id; })[0]; if (!m) return;
    B.IDB.get("kv", MK(id)).then(function (row) {
      if (!row || !row.blob || !S) return; var u = URL.createObjectURL(row.blob); urls.push(u);
      els.viewer.innerHTML = '<div class="ne-vtop"><button type="button" class="ne-btn" data-ne="vclose" aria-label="Close">' + icon("i-x") + '</button><span class="grow"></span><button type="button" class="ne-btn" data-ne="vdel" data-id="' + esc(id) + '" aria-label="Delete image">' + icon("i-trash") + '</button></div><img alt="Note image" src="' + u + '">';
      els.viewer.hidden = false;
    });
  }
  function closeViewer() { if (els.viewer && !els.viewer.hidden) { els.viewer.hidden = true; els.viewer.innerHTML = ""; } }
  function doRemoveMedia(id) {
    B.confirmBox("Isse hata du?", "Ye photo / voice note is note se hat jayegi.", [{ label: "Cancel", value: null }, { label: "Remove", value: true, cls: "btn-danger" }]).then(function (ok) {
      if (!ok || !S) return;
      if (audio) { audio.pause(); }
      S.media = S.media.filter(function (x) { return x.id !== id; }); closeViewer(); renderMedia(); touch(); commit(true);
      B.IDB.del("kv", MK(id)).catch(function () {});
    });
  }
  function startRec() {
    if (!S) return;
    if ((S.media || []).length >= MAX_MEDIA) { B.toast("Ek note mein max " + MAX_MEDIA + " photos/voice notes"); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { B.toast("Is phone/browser mein voice record nahi ho sakta"); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      if (!S) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      var types = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"], mt = ""; types.some(function (t) { if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) { mt = t; return true; } });
      var mr; try { mr = mt ? new MediaRecorder(stream, { mimeType: mt }) : new MediaRecorder(stream); } catch (e) { stream.getTracks().forEach(function (t) { t.stop(); }); B.toast("Recording start nahi hui"); return; }
      rec = { mr: mr, stream: stream, chunks: [], t0: Date.now(), cancel: false, tick: 0 };
      mr.ondataavailable = function (ev) { if (ev.data && ev.data.size) rec.chunks.push(ev.data); };
      mr.onstop = function () {
        var r = rec; clearInterval(r.tick); r.stream.getTracks().forEach(function (t) { t.stop(); }); rec = null; closeSheet(true);
        var dur = (Date.now() - r.t0) / 1000;
        if (r.cancel || !S || !r.chunks.length || dur < 0.5) return;
        var blob = new Blob(r.chunks, { type: r.mr.mimeType || mt || "audio/webm" }), id = B.uid();
        addMedia({ blob: blob, k: "aud", d: dur, at: B.now() }, { id: id, k: "aud", d: Math.round(dur) }).then(function () { B.toast("Voice note save ho gaya"); commit(true); });
      };
      mr.start(1000);
      openSheet('<p class="ne-sh">Recording…</p><div class="ne-rec"><i class="dot"></i><b id="neRecT">0:00</b></div><div class="ne-recbtns"><button type="button" class="btn" data-ne="reccancel">Cancel</button><button type="button" class="btn btn-primary" data-ne="recstop">Stop & save</button></div>', "rec");
      rec.tick = setInterval(function () { var s = (Date.now() - rec.t0) / 1000, t = $("#neRecT", ed); if (t) t.textContent = fmtDur(s); if (s >= 300) stopRec(false); }, 250);
    }).catch(function (e) {
      var denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError" || e.name === "PermissionDeniedError");
      B.toast(e && e.name === "NotFoundError" ? "Is phone mein mic nahi mila" : denied ? "Mic ki permission nahi mili — phone Settings → Apps → Bhavnote → Permissions → Microphone → Allow" : "Mic start nahi hua");
    });
  }
  function stopRec(cancel) { if (!rec) return; rec.cancel = !!cancel; try { rec.mr.state !== "inactive" && rec.mr.stop(); } catch (e) {} }

  /* ---------- backup: photos & voice notes travel inside the backup file ---------- */
  function blobToDataUrl(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(blob); }); }
  function exportMedia() {
    var ids = []; B.db.items.forEach(function (it) { (it.media || []).forEach(function (m) { ids.push(m.id); }); });
    var out = {}; if (!ids.length) return Promise.resolve(out);
    return ids.reduce(function (p, id) {
      return p.then(function () { return B.IDB.get("kv", MK(id)).then(function (row) { if (row && row.blob) return blobToDataUrl(row.blob).then(function (u) { out[id] = { url: u, k: row.k, w: row.w, h: row.h, d: row.d }; }); }); }).catch(function () {});
    }, Promise.resolve()).then(function () { return out; });
  }
  function importMedia(map) {
    var ids = Object.keys(map || {}); if (!ids.length) return Promise.resolve(0);
    return ids.reduce(function (p, id) {
      return p.then(function () { var m = map[id]; if (!m || !m.url) return; return fetch(m.url).then(function (r) { return r.blob(); }).then(function (blob) { return B.IDB.put("kv", { id: MK(id), blob: blob, k: m.k, w: m.w, h: m.h, d: m.d, at: B.now() }); }); }).catch(function () {});
    }, Promise.resolve()).then(function () { return ids.length; });
  }

  window.BNEditor = { open: open, close: requestClose, isOpen: function () { return !!S; }, exportMedia: exportMedia, importMedia: importMedia, _state: function () { return S; } };
  // build the editor in the background so the first note opens instantly
  (window.requestIdleCallback || function (f) { return setTimeout(f, 600); })(function () { build(); }, { timeout: 2500 });
})();
