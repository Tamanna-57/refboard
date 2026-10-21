// Injected into the page after analyze.js. Lets the user pick a section of the
// page (hover + click an element, or drag to draw a box), then shows a small
// panel to add a note and save it.
//
// A transparent overlay sits on top of the page while picking, so the site's
// own scripts (custom cursors, scroll effects, links) never see our clicks.
(() => {
  if (window.__refboardPickerActive) return;
  window.__refboardPickerActive = true;

  const CATEGORIES = ['Layout', 'Typography', 'Color', 'Component', 'Animation', 'Interaction', 'Imagery', 'Copy'];
  const DRAG_THRESHOLD = 6;
  const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2.2 28 9.1v13.8L16 29.8 4 22.9V9.1Z" fill="#0a0a0a" stroke="#0a0a0a" stroke-width="2.4" stroke-linejoin="round"/><path d="M11.6 9.4h8.8v13.2L16 19.4l-4.4 3.2Z" fill="#fff"/></svg>';

  const host = document.createElement('refboard-picker');
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      [hidden] { display: none !important; }
      * { box-sizing: border-box; font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
      .overlay { position: fixed; inset: 0; pointer-events: auto; cursor: crosshair; background: transparent; }
      /* The box glides between targets; everything outside it is dimmed. */
      .box { position: fixed; top: 0; left: 0; border: 2px solid #fff; border-radius: 6px; pointer-events: none; display: none;
             box-shadow: 0 0 0 1.5px #0a0a0a, 0 0 0 100vmax rgba(10, 10, 10, 0.32);
             will-change: transform, width, height;
             transition: transform 160ms cubic-bezier(.2, .8, .2, 1), width 160ms cubic-bezier(.2, .8, .2, 1),
                         height 160ms cubic-bezier(.2, .8, .2, 1), border-radius 160ms ease, opacity 120ms ease; }
      .box.instant, .box.drawing { transition: none; }
      .box.drawing { border-style: dashed; }
      .label { position: fixed; top: 0; left: 0; display: none; align-items: center; gap: 6px; pointer-events: none; white-space: nowrap;
               background: #0a0a0a; color: #fff; font-size: 12px; font-weight: 600; padding: 4px 9px; border-radius: 6px;
               box-shadow: 0 4px 14px rgba(0,0,0,.25); will-change: transform;
               transition: transform 160ms cubic-bezier(.2, .8, .2, 1); }
      .label.instant { transition: none; }
      .label small { font: 500 11px ui-monospace, Menlo, Consolas, monospace; color: #a3a3a3; }
      .hint { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: #0a0a0a; color: #fff; white-space: nowrap;
              font-size: 13px; padding: 9px 8px 9px 16px; border-radius: 999px; box-shadow: 0 8px 24px rgba(0,0,0,.25);
              pointer-events: none; display: flex; align-items: center; gap: 10px; opacity: .94; }
      .hint kbd { background: #2a2a2a; border-radius: 4px; padding: 1px 6px; font-family: inherit; font-size: 12px; }
      .hint button { border: 0; background: #2a2a2a; color: #fff; border-radius: 999px; padding: 4px 10px; font-size: 12px; cursor: pointer; pointer-events: auto; }
      .hint button:hover { background: #3a3a3a; }

      .panel { position: fixed; top: 16px; right: 16px; width: 340px; max-height: calc(100vh - 32px); display: flex; flex-direction: column;
               background: #fff; color: #0a0a0a; border-radius: 14px; box-shadow: 0 18px 50px rgba(0,0,0,.25), 0 0 0 1px rgba(0,0,0,.08);
               pointer-events: auto; font-size: 13px; overflow: hidden; }
      .head { display: flex; align-items: center; gap: 10px; padding: 14px 12px 10px 18px; }
      .head h2 { font-size: 16px; font-weight: 700; margin: 0; flex: 1; color: #0a0a0a; }
      .head svg { width: 24px; height: 24px; flex: none; }
      .x { border: 0; background: none; width: 30px; height: 30px; border-radius: 7px; font-size: 20px; line-height: 1; color: #4a4a4a; cursor: pointer; }
      .x:hover { background: #ececec; color: #0a0a0a; }
      .body { padding: 0 18px 6px; overflow: auto; flex: 1; }
      .foot { display: flex; gap: 8px; padding: 12px 18px 16px; border-top: 1px solid #ececec; background: #fff; }
      .shot { width: 100%; max-height: 140px; object-fit: contain; background: #f4f4f4; border-radius: 8px; display: block; }
      label { display: block; font-size: 12.5px; font-weight: 500; color: #8c8c8c; margin: 12px 0 5px; }
      input, textarea, select { width: 100%; border: 1px solid #e3e3e3; border-radius: 8px; padding: 8px 10px; font-size: 13px;
                                color: #0a0a0a; background: #fff; outline: none; }
      input:focus, textarea:focus, select:focus { border-color: #0a0a0a; }
      textarea { min-height: 72px; resize: vertical; line-height: 1.45; }
      .chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .chip { border: 1px solid #e3e3e3; background: #fff; color: #4a4a4a; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
      .chip[aria-pressed="true"] { background: #0a0a0a; border-color: #0a0a0a; color: #fff; }
      .btn { flex: 1; border-radius: 8px; padding: 9px 12px; font-size: 13px; font-weight: 500; cursor: pointer;
             border: 1px solid #e3e3e3; background: #fff; color: #0a0a0a; white-space: nowrap; }
      .btn:hover { background: #f4f4f4; }
      .btn.primary { background: #0a0a0a; border-color: #0a0a0a; color: #fff; }
      .btn.primary:hover { background: #262626; }
      .btn:disabled { opacity: .6; cursor: default; }
      .meta { font-size: 11px; color: #8c8c8c; margin-top: 10px; font-family: ui-monospace, Menlo, Consolas, monospace; word-break: break-all; }
      .swatches { display: flex; gap: 4px; margin-top: 10px; flex-wrap: wrap; }
      .swatches i { width: 18px; height: 18px; border-radius: 4px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); }
      .done { padding: 6px 18px 18px; }
      .done p { margin: 0 0 14px; color: #4a4a4a; }
      .done .row { display: flex; gap: 8px; }
      .error { color: #c62828; font-size: 12px; margin-top: 8px; }
    </style>
    <div class="overlay"></div>
    <div class="box"></div>
    <div class="label"></div>
    <div class="hint">
      <span>Click an element or drag to draw a box · <kbd>↑</kbd><kbd>↓</kbd> bigger / smaller · <kbd>Enter</kbd> pick</span>
      <button type="button" data-act="exit">Cancel (Esc)</button>
    </div>
  `;
  document.documentElement.appendChild(host);

  // If the extension was reloaded while this page stayed open, this script's
  // connection to it is gone. Say so instead of failing silently.
  async function send(msg) {
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch (err) {
      if (/context invalidated|Receiving end does not exist/i.test(String(err))) {
        showNotice('Refboard was updated. Refresh this page (F5) and try again.');
        return null;
      }
      throw err;
    }
  }

  function showNotice(text) {
    shadow.querySelectorAll('.panel').forEach((n) => n.remove());
    const n = document.createElement('div');
    n.className = 'panel';
    n.innerHTML = `<div class="head">${LOGO}<h2>Refboard</h2><button class="x" title="Close">×</button></div><div class="done"><p></p></div>`;
    n.querySelector('p').textContent = text;
    n.querySelector('.x').onclick = cleanup;
    shadow.appendChild(n);
  }

  const $s = (sel) => shadow.querySelector(sel);
  const overlay = $s('.overlay');
  const box = $s('.box');
  const label = $s('.label');
  const hint = $s('.hint');

  let picking = false;
  let current = null; // element under the cursor
  let lockedAt = null; // after ↑/↓, ignore small mouse moves
  let lastPoint = { x: innerWidth / 2, y: innerHeight / 2 };
  let drag = null; // { x, y, drawing }
  let frame = 0;
  const trail = []; // elements we walked up from, for ↓

  // Keep the page's own keyboard shortcuts from firing while typing in the panel.
  for (const type of ['keydown', 'keyup', 'keypress']) host.addEventListener(type, (e) => e.stopPropagation());
  hint.querySelector('[data-act="exit"]').onclick = cleanup;

  function elementAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el !== host && el !== document.documentElement && !host.contains(el)) return el;
    }
    return null;
  }

  let boxVisible = false;

  function showBox(r, name, detail = '', drawing = false) {
    // First appearance snaps into place; after that, the box glides.
    const instant = !boxVisible || drawing;
    box.classList.toggle('instant', instant);
    label.classList.toggle('instant', instant);
    box.classList.toggle('drawing', drawing);
    box.style.display = 'block';
    box.style.transform = `translate3d(${Math.round(r.left)}px, ${Math.round(r.top)}px, 0)`;
    box.style.width = Math.max(2, Math.round(r.width)) + 'px';
    box.style.height = Math.max(2, Math.round(r.height)) + 'px';
    label.innerHTML = '';
    label.append(name);
    if (detail) {
      const small = document.createElement('small');
      small.textContent = detail;
      label.append(small);
    }
    label.style.display = 'flex';
    const lw = label.offsetWidth || 160;
    const top = r.top > 34 ? r.top - 30 : Math.min(r.top + r.height + 8, innerHeight - 30);
    const left = Math.min(Math.max(r.left, 6), innerWidth - lw - 6);
    label.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    boxVisible = true;
  }

  function hideBox() {
    box.style.display = label.style.display = 'none';
    boxVisible = false;
  }

  const FRIENDLY = {
    nav: 'Navigation', header: 'Header', footer: 'Footer', section: 'Section', article: 'Article', aside: 'Sidebar', main: 'Main',
    form: 'Form', button: 'Button', img: 'Image', picture: 'Image', video: 'Video', canvas: 'Canvas', svg: 'Graphic',
    h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6',
    p: 'Text', ul: 'List', ol: 'List', li: 'List item', input: 'Input', textarea: 'Text area', select: 'Select',
    table: 'Table', label: 'Label', figure: 'Figure', blockquote: 'Quote', dialog: 'Dialog',
  };

  function friendlyName(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') {
      const s = getComputedStyle(el);
      return parseFloat(s.paddingLeft) >= 8 && (s.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(s.borderTopWidth) > 0) ? 'Button' : 'Link';
    }
    if (FRIENDLY[tag]) return FRIENDLY[tag];
    const cs = getComputedStyle(el);
    const filled = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.boxShadow !== 'none' || parseFloat(cs.borderTopWidth) > 0;
    if (parseFloat(cs.borderTopLeftRadius) >= 6 && filled) return 'Card';
    const d = cs.display;
    if (d.includes('grid')) return 'Grid';
    if (d.includes('flex')) return 'Group';
    return 'Block';
  }

  function describe(el) {
    let sel = el.tagName.toLowerCase();
    const cls = [...el.classList].filter((c) => c.length < 24).slice(0, 1).join('.');
    if (cls) sel += '.' + cls;
    const r = el.getBoundingClientRect();
    return [friendlyName(el), `${Math.round(r.width)}×${Math.round(r.height)} · ${sel}`];
  }

  // Skip what nobody means to pick: letter spans, inline formatting, SVG parts, specks.
  const KEEP_INLINE = /^(A|BUTTON|IMG|INPUT|SELECT|TEXTAREA|LABEL|VIDEO|CANVAS|svg|PICTURE)$/;
  function meaningful(el) {
    let cur = el;
    for (let i = 0; i < 8 && cur && cur !== document.body; i++) {
      if (cur instanceof SVGElement && cur.tagName.toLowerCase() !== 'svg') {
        cur = cur.ownerSVGElement || cur.parentElement;
        continue;
      }
      const r = cur.getBoundingClientRect();
      const inline = getComputedStyle(cur).display === 'inline' && !KEEP_INLINE.test(cur.tagName);
      if (inline || r.width < 20 || r.height < 12) {
        cur = cur.parentElement;
        continue;
      }
      break;
    }
    return cur || el;
  }

  const sameBox = (a, b) => Math.abs(a.left - b.left) < 2 && Math.abs(a.top - b.top) < 2 && Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2;

  // ↑ goes to the next ancestor that is actually bigger (skips identical wrappers).
  function biggerParent(el) {
    const r = el.getBoundingClientRect();
    let p = el.parentElement;
    while (p && p !== document.documentElement && p.parentElement && p !== document.body && sameBox(p.getBoundingClientRect(), r)) p = p.parentElement;
    return p && p !== document.documentElement ? p : null;
  }

  // A few pixels of breathing room so the outline never covers the content.
  const PAD = 4;
  function highlight(el, instant = false) {
    current = el;
    const [name, detail] = describe(el);
    if (instant) boxVisible = false;
    const r = el.getBoundingClientRect();
    // Follow the element's own corner radius, so the outline hugs its shape.
    const radius = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, Math.min(r.width, r.height) / 2);
    box.style.borderRadius = `${Math.round(radius + PAD)}px`;
    showBox({ left: r.left - PAD, top: r.top - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }, name, detail);
  }

  function dragRect(e) {
    const left = Math.min(drag.x, e.clientX);
    const top = Math.min(drag.y, e.clientY);
    return { left, top, width: Math.abs(e.clientX - drag.x), height: Math.abs(e.clientY - drag.y) };
  }

  function onPointerMove(e) {
    lastPoint = { x: e.clientX, y: e.clientY };
    if (drag) {
      if (!drag.drawing && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > DRAG_THRESHOLD) drag.drawing = true;
      if (drag.drawing) {
        const r = dragRect(e);
        box.style.borderRadius = '4px';
        showBox(r, 'Area', `${Math.round(r.width)}×${Math.round(r.height)}`, true);
      }
      return;
    }
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (lockedAt && Math.hypot(lastPoint.x - lockedAt.x, lastPoint.y - lockedAt.y) < 24) return;
      lockedAt = null;
      const hit = elementAt(lastPoint.x, lastPoint.y);
      const el = hit && meaningful(hit);
      if (el && el !== current) {
        trail.length = 0;
        highlight(el);
      }
    });
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    overlay.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, drawing: false };
  }

  function onPointerUp(e) {
    if (!drag) return;
    const wasDrawing = drag.drawing;
    const r = wasDrawing ? dragRect(e) : null;
    drag = null;
    if (wasDrawing && r.width >= 8 && r.height >= 8) pickRegion(r);
    else if (current) pickElement(current);
  }

  // Keep the highlight glued to the element while the page scrolls.
  function onScroll() {
    if (!picking || drag) return;
    const hit = lockedAt ? current : elementAt(lastPoint.x, lastPoint.y);
    const el = hit && (lockedAt ? hit : meaningful(hit));
    if (el) highlight(el, true); // follow the page exactly while scrolling, no glide
  }

  function onKey(e) {
    if (!picking) {
      // Panel is open but focus is on the page: Esc still closes it.
      if (e.key === 'Escape' && !e.composedPath().includes(host)) cleanup();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
    } else if (e.key === 'ArrowUp' && current && biggerParent(current)) {
      e.preventDefault();
      trail.push(current);
      lockedAt = lastPoint;
      highlight(biggerParent(current));
    } else if (e.key === 'ArrowDown' && trail.length) {
      e.preventDefault();
      lockedAt = lastPoint;
      highlight(trail.pop());
    } else if (e.key === 'Enter' && current) {
      e.preventDefault();
      pickElement(current);
    }
  }

  function startPicking() {
    picking = true;
    current = null;
    drag = null;
    lockedAt = null;
    trail.length = 0;
    overlay.hidden = false;
    hint.hidden = false;
    const hit = elementAt(lastPoint.x, lastPoint.y);
    const el = hit && meaningful(hit);
    if (el) highlight(el);
  }

  function stopPicking() {
    picking = false;
    overlay.hidden = true;
    hideBox();
    hint.hidden = true;
  }

  function cleanup() {
    picking = false;
    delete window.__refboardTeardown;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScroll, true);
    host.remove();
    window.__refboardPickerActive = false;
  }

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  // Smallest element that contains the whole drawn box: used for style capture.
  function containerFor(r) {
    const contains = (b) => b.left <= r.left + 6 && b.top <= r.top + 6 && b.right >= r.left + r.width - 6 && b.bottom >= r.top + r.height - 6;
    let el = elementAt(r.left + r.width / 2, r.top + r.height / 2) || document.body;
    while (el.parentElement && el !== document.body && !contains(el.getBoundingClientRect())) el = el.parentElement;
    return el;
  }

  // Screenshot first (so it shows exactly what was selected), then measure.
  async function capture(r, measure) {
    stopPicking(); // hide our UI so it is not in the screenshot
    await nextFrame();
    const shot = await send({
      type: 'captureRect',
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      viewport: { width: innerWidth, height: innerHeight },
    });
    if (shot === null) return; // extension was reloaded; notice already shown
    showPanel(measure(), shot);
  }

  function pickElement(el) {
    capture(el.getBoundingClientRect(), () => window.__refboardAnalyze.element(el));
  }

  function pickRegion(r) {
    const container = containerFor(r);
    const inner = elementAt(r.left + r.width / 2, r.top + r.height / 2);
    capture(r, () => {
      const data = window.__refboardAnalyze.element(container);
      data.analysis.size = { width: Math.round(r.width), height: Math.round(r.height) };
      data.analysis.region = true;
      // Title from the text inside the box, not from the (often much bigger) container.
      const text = (inner?.closest('section, article, li, div') || inner)?.innerText?.trim().split('\n')[0] || '';
      data.title = text ? `Area: ${text.slice(0, 50)}` : 'Selected area';
      return data;
    });
  }

  async function showPanel(data, shot) {
    const { boards = [], lastBoardId } = (await send({ type: 'getBoards' })) || {};
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <div class="head">${LOGO}<h2>Save to Refboard</h2><button class="x" data-act="close" title="Close without saving (Esc)">×</button></div>
      <div class="body">
        ${shot?.image ? `<img class="shot" alt="">` : ''}
        <label for="rb-title">Title</label>
        <input id="rb-title">
        <label for="rb-note">What do you want to use from this?</label>
        <textarea id="rb-note" placeholder="e.g. The way the nav shrinks into a pill on scroll, and the blurred background"></textarea>
        <label>Focus</label>
        <div class="chips"></div>
        <label for="rb-tags">Tags</label>
        <input id="rb-tags" placeholder="comma separated, e.g. saas, dark, pricing">
        <label for="rb-board">Board</label>
        <select id="rb-board"></select>
        <input id="rb-new-board" placeholder="New board name" hidden style="margin-top:6px">
        <div class="swatches"></div>
        <div class="meta"></div>
        <div class="error" hidden></div>
      </div>
      <div class="foot">
        <button class="btn" data-act="repick" title="Discard this and pick again">Re-pick</button>
        <button class="btn primary" data-act="save">Save</button>
      </div>
    `;
    shadow.appendChild(panel);
    const $ = (sel) => panel.querySelector(sel);

    if (shot?.image) $('.shot').src = shot.image;
    $('#rb-title').value = data.title;
    const a = data.analysis;
    $('.meta').textContent = `${a.region ? 'drawn box inside ' : ''}${a.selector} · ${a.size.width}×${a.size.height}`;
    for (const c of a.palette.slice(0, 10)) {
      const i = document.createElement('i');
      i.style.background = c.hex;
      i.title = c.hex;
      $('.swatches').appendChild(i);
    }
    for (const c of CATEGORIES) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.type = 'button';
      b.textContent = c;
      b.setAttribute('aria-pressed', 'false');
      b.onclick = () => b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      $('.chips').appendChild(b);
    }
    const select = $('#rb-board');
    for (const b of boards) select.add(new Option(b.name, b.id, false, b.id === lastBoardId));
    select.add(new Option('+ New board…', '__new'));
    const newBoard = $('#rb-new-board');
    select.onchange = () => {
      newBoard.hidden = select.value !== '__new';
      if (!newBoard.hidden) newBoard.focus();
    };

    const close = () => cleanup();
    const repick = () => {
      panel.remove();
      startPicking();
    };
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
    $('[data-act="close"]').onclick = close;
    $('[data-act="repick"]').onclick = repick;
    $('#rb-note').focus();

    $('[data-act="save"]').onclick = async () => {
      const btn = $('[data-act="save"]');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      const res = await send({
        type: 'savePin',
        pin: {
          ...data,
          kind: 'element',
          title: $('#rb-title').value.trim() || data.title,
          note: $('#rb-note').value.trim(),
          categories: [...panel.querySelectorAll('.chip[aria-pressed="true"]')].map((b) => b.textContent),
          tags: $('#rb-tags').value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
          board: select.value === '__new' ? '__new:' + (newBoard.value.trim() || 'Untitled') : select.value,
          image: shot?.image || null,
        },
      });
      if (!res?.ok) {
        btn.disabled = false;
        btn.textContent = 'Save';
        const err = $('.error');
        err.hidden = false;
        err.textContent = res?.error || 'Could not save. Try again.';
        return;
      }
      showSaved(panel, res.id);
    };
  }

  // After saving: offer Undo (in case it was a mistake) or picking another section.
  function showSaved(panel, id) {
    panel.innerHTML = `
      <div class="head">${LOGO}<h2>Saved ✓</h2><button class="x" data-act="close" title="Close">×</button></div>
      <div class="done">
        <p>Added to your board. Saved the wrong thing? Undo removes it.</p>
        <div class="row">
          <button class="btn" data-act="undo">Undo</button>
          <button class="btn primary" data-act="another">Pick another</button>
        </div>
      </div>`;
    const timer = setTimeout(cleanup, 6000);
    panel.addEventListener('pointerenter', () => clearTimeout(timer), { once: true });
    panel.querySelector('[data-act="close"]').onclick = () => {
      clearTimeout(timer);
      cleanup();
    };
    panel.querySelector('[data-act="undo"]').onclick = async () => {
      clearTimeout(timer);
      await send({ type: 'deletePin', id });
      panel.querySelector('.done').innerHTML = '<p>Removed. Nothing was saved.</p>';
      setTimeout(cleanup, 1200);
    };
    panel.querySelector('[data-act="another"]').onclick = () => {
      clearTimeout(timer);
      panel.remove();
      startPicking();
    };
  }

  overlay.addEventListener('pointermove', onPointerMove);
  overlay.addEventListener('pointerdown', onPointerDown);
  overlay.addEventListener('pointerup', onPointerUp);
  overlay.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', onScroll, true);
  window.__refboardTeardown = cleanup; // lets a newer injection remove this one
  startPicking();
})();
