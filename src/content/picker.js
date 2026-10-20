// Injected into the page after analyze.js. Lets the user hover and click a
// section of the page, then shows a small panel to add a note and save it.
(() => {
  if (window.__refboardPickerActive) return;
  window.__refboardPickerActive = true;

  const CATEGORIES = ['Layout', 'Typography', 'Color', 'Component', 'Animation', 'Interaction', 'Imagery', 'Copy'];

  const host = document.createElement('refboard-picker');
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      [hidden] { display: none !important; }
      * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
      .box { position: fixed; border: 2px solid #0a0a0a; outline: 1px solid #fff; background: rgba(10, 10, 10, 0.08); border-radius: 4px;
             pointer-events: none; transition: all 60ms ease-out; display: none; }
      .label { position: fixed; background: #0a0a0a; color: #fff; font-size: 11px; padding: 3px 7px; border-radius: 4px;
               pointer-events: none; white-space: nowrap; display: none; font-family: ui-monospace, Menlo, monospace; }
      .hint { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); background: #0a0a0a; color: #fff;
              font-size: 13px; padding: 9px 14px; border-radius: 999px; box-shadow: 0 8px 24px rgba(0,0,0,.25); pointer-events: none; }
      .hint kbd { background: #2a2a2a; border-radius: 4px; padding: 1px 6px; font-family: inherit; font-size: 12px; }
      .panel { position: fixed; top: 16px; right: 16px; width: 340px; max-height: calc(100vh - 32px); overflow: auto;
               background: #fff; color: #0a0a0a; border-radius: 14px; box-shadow: 0 18px 50px rgba(0,0,0,.25), 0 0 0 1px rgba(0,0,0,.08);
               padding: 18px; pointer-events: auto; font-size: 13px; }
      .panel h2 { font-size: 16px; font-weight: 700; margin: 0 0 12px; display: flex; align-items: center; gap: 10px; color: #0a0a0a; }
      .panel h2 svg { width: 24px; height: 24px; flex: none; }
      .shot { width: 100%; max-height: 180px; object-fit: contain; background: #f4f4f4; border-radius: 8px; display: block; margin-bottom: 12px; }
      label { display: block; font-size: 12.5px; font-weight: 500; color: #8c8c8c; margin: 12px 0 5px; }
      input, textarea, select { width: 100%; border: 1px solid #e3e3e3; border-radius: 8px; padding: 8px 10px; font-size: 13px;
                                color: #0a0a0a; background: #fff; outline: none; }
      input:focus, textarea:focus, select:focus { border-color: #0a0a0a; }
      textarea { min-height: 84px; resize: vertical; line-height: 1.45; }
      .chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .chip { border: 1px solid #e3e3e3; background: #fff; color: #4a4a4a; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
      .chip[aria-pressed="true"] { background: #0a0a0a; border-color: #0a0a0a; color: #fff; }
      .row { display: flex; gap: 8px; margin-top: 14px; }
      button.primary, button.ghost { flex: 1; border-radius: 8px; padding: 9px 12px; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid #e3e3e3; }
      button.primary { background: #0a0a0a; border-color: #0a0a0a; color: #fff; }
      button.primary:disabled { opacity: .6; cursor: default; }
      button.ghost { background: #fff; color: #0a0a0a; }
      .meta { font-size: 11px; color: #8c8c8c; margin-top: 8px; font-family: ui-monospace, Menlo, monospace; word-break: break-all; }
      .swatches { display: flex; gap: 4px; margin-top: 8px; flex-wrap: wrap; }
      .swatches i { width: 18px; height: 18px; border-radius: 4px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); }
      .done { text-align: center; padding: 18px 4px 6px; }
      .done b { display: block; font-size: 15px; margin-bottom: 6px; }
      .error { color: #c22; font-size: 12px; margin-top: 8px; }
    </style>
    <div class="box"></div>
    <div class="label"></div>
    <div class="hint">Click a section to save it · <kbd>↑</kbd><kbd>↓</kbd> bigger / smaller · <kbd>Enter</kbd> save · <kbd>Esc</kbd> cancel</div>
  `;
  document.documentElement.appendChild(host);

  const box = shadow.querySelector('.box');
  const label = shadow.querySelector('.label');
  const hint = shadow.querySelector('.hint');
  let current = null;

  // Keep the page's own keyboard shortcuts from firing while typing in the panel.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    host.addEventListener(type, (e) => e.stopPropagation());
  }

  function describe(el) {
    let text = el.tagName.toLowerCase();
    if (el.id) text += '#' + el.id;
    const cls = [...el.classList].slice(0, 2).join('.');
    if (cls) text += '.' + cls;
    const r = el.getBoundingClientRect();
    return `${text.slice(0, 50)}  ${Math.round(r.width)}×${Math.round(r.height)}`;
  }

  function highlight(el) {
    current = el;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px' });
    label.textContent = describe(el);
    label.style.display = 'block';
    label.style.top = Math.max(r.top - 24, 4) + 'px';
    label.style.left = Math.max(r.left, 4) + 'px';
  }

  // After ↑/↓ the selection stays put until the mouse clearly moves away,
  // so the small movement of a click doesn't jump back to the child.
  let lockedAt = null;
  let lastPoint = { x: 0, y: 0 };
  const trail = []; // elements we walked up from, for ↓

  function onMove(e) {
    lastPoint = { x: e.clientX, y: e.clientY };
    if (lockedAt && Math.hypot(e.clientX - lockedAt.x, e.clientY - lockedAt.y) < 24) return;
    lockedAt = null;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el !== host && el !== current && el !== document.documentElement) {
      trail.length = 0;
      highlight(el);
    }
  }

  function block(e) {
    if (e.composedPath().includes(host)) return;
    e.preventDefault();
    e.stopPropagation();
  }

  function onClick(e) {
    block(e);
    if (current) pick(current);
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
    } else if (e.key === 'ArrowUp' && current?.parentElement && current.parentElement !== document.documentElement) {
      e.preventDefault();
      trail.push(current);
      lockedAt = lastPoint;
      highlight(current.parentElement);
    } else if (e.key === 'ArrowDown' && trail.length) {
      e.preventDefault();
      lockedAt = lastPoint;
      highlight(trail.pop());
    } else if (e.key === 'Enter' && current) {
      e.preventDefault();
      pick(current);
    }
  }

  function stopPicking() {
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('mousedown', block, true);
    window.removeEventListener('mouseup', block, true);
    window.removeEventListener('pointerdown', block, true);
    window.removeEventListener('keydown', onKey, true);
  }

  function cleanup() {
    stopPicking();
    window.removeEventListener('keydown', onPanelKey, true);
    host.remove();
    window.__refboardPickerActive = false;
  }

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  async function pick(el) {
    stopPicking();
    const data = window.__refboardAnalyze.element(el);
    const r = el.getBoundingClientRect();

    // Hide our own UI so it is not in the screenshot.
    box.style.display = label.style.display = hint.style.display = 'none';
    await nextFrame();
    const shot = await chrome.runtime.sendMessage({
      type: 'captureRect',
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      viewport: { width: innerWidth, height: innerHeight },
    });
    window.addEventListener('keydown', onPanelKey, true);
    showPanel(data, shot);
  }

  function onPanelKey(e) {
    if (e.key === 'Escape' && !e.composedPath().includes(host)) cleanup();
  }

  async function showPanel(data, shot) {
    const { boards = [], lastBoardId } = (await chrome.runtime.sendMessage({ type: 'getBoards' })) || {};
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <h2><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2.2 28 9.1v13.8L16 29.8 4 22.9V9.1Z" fill="#0a0a0a" stroke="#0a0a0a" stroke-width="2.4" stroke-linejoin="round"/><path d="M11.6 9.4h8.8v13.2L16 19.4l-4.4 3.2Z" fill="#fff"/></svg>Save to Refboard</h2>
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
      <div class="row"><button class="ghost" data-act="cancel">Cancel</button><button class="primary" data-act="save">Save</button></div>
    `;
    shadow.appendChild(panel);
    const $ = (sel) => panel.querySelector(sel);

    if (shot?.image) $('.shot').src = shot.image;
    $('#rb-title').value = data.title;
    $('.meta').textContent = `${data.analysis.selector} · ${data.analysis.size.width}×${data.analysis.size.height}`;
    for (const c of data.analysis.palette.slice(0, 10)) {
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

    $('#rb-note').focus();
    $('[data-act="cancel"]').onclick = cleanup;
    $('[data-act="save"]').onclick = async () => {
      const btn = $('[data-act="save"]');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      const res = await chrome.runtime.sendMessage({
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
      panel.innerHTML = `<div class="done"><b>Saved ✓</b>Open the board from the Refboard toolbar icon.</div>`;
      setTimeout(cleanup, 1400);
    };
  }

  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('mousedown', block, true);
  window.addEventListener('mouseup', block, true);
  window.addEventListener('pointerdown', block, true);
  window.addEventListener('keydown', onKey, true);
})();
