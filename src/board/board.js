import * as db from '../lib/db.js';
import { CATEGORIES } from '../lib/constants.js';
import { buildPrompt, buildDesignMd, imageFiles } from '../lib/generate.js';
import { createZip, dataUrlToBytes } from '../lib/zip.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),
  download: svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'),
  archive: svg('<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/>'),
};

const state = {
  pins: [],
  boards: [],
  board: 'all',
  categories: new Set(),
  tag: null,
  query: '',
  selecting: false,
  selected: [], // pin ids, in the order they were clicked
};

async function load() {
  [state.pins, state.boards] = await Promise.all([db.listPins(), db.listBoards()]);
  if (state.board !== 'all' && !state.boards.some((b) => b.id === state.board)) state.board = 'all';
  state.selected = state.selected.filter((id) => state.pins.some((p) => p.id === id));
  render();
}

function visiblePins() {
  const q = state.query.toLowerCase();
  return state.pins.filter((p) => {
    if (state.board !== 'all' && p.boardId !== state.board) return false;
    if (state.tag && !p.tags?.includes(state.tag)) return false;
    for (const c of state.categories) if (!p.categories?.includes(c)) return false;
    if (q && ![p.title, p.note, p.hostname, p.url, ...(p.tags || [])].join(' ').toLowerCase().includes(q)) return false;
    return true;
  });
}

function render() {
  renderSidebar();
  renderToolbar();
  renderGrid();
}

function renderSidebar() {
  const counts = new Map();
  for (const p of state.pins) counts.set(p.boardId, (counts.get(p.boardId) || 0) + 1);
  const items = [{ id: 'all', name: 'All references', n: state.pins.length }, ...state.boards.map((b) => ({ ...b, n: counts.get(b.id) || 0 }))];
  $('#boards').innerHTML = items
    .map((b) => `<li><button data-board="${esc(b.id)}" aria-current="${b.id === state.board}"><span>${esc(b.name)}</span><span class="count">${b.n}</span></button></li>`)
    .join('');

  $('#category-filter').innerHTML = CATEGORIES.map(
    (c) => `<button class="chip" data-category="${c}" aria-pressed="${state.categories.has(c)}">${c}</button>`,
  ).join('');

  const tagCounts = new Map();
  for (const p of state.pins) for (const t of p.tags || []) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  const tags = [...tagCounts].sort((a, b) => b[1] - a[1]).slice(0, 30);
  $('#tag-filter').innerHTML = tags.length
    ? tags.map(([t]) => `<button data-tag="${esc(t)}" aria-pressed="${state.tag === t}">${esc(t)}</button>`).join('')
    : '<span class="none">Tags you add show up here</span>';
}

function renderToolbar() {
  const board = state.boards.find((b) => b.id === state.board);
  $('#board-title').textContent = board ? board.name : 'All references';
  $('#board-actions').hidden = !board || board.id === db.DEFAULT_BOARD.id;
  document.body.classList.toggle('selecting', state.selecting);
  $('#select-bar').hidden = !state.selecting;
  $('#toggle-select').hidden = state.selecting;
  $('#selected-count').textContent = `${state.selected.length} selected`;
  const gen = $('#generate');
  gen.disabled = state.selecting ? state.selected.length === 0 : visiblePins().length === 0;
  gen.textContent = state.selecting && state.selected.length ? `Generate from ${state.selected.length}` : 'Generate prompt';
}

function cardHtml(p) {
  const order = state.selected.indexOf(p.id);
  const swatches = (p.analysis?.palette || []).slice(0, 8).map((c) => `<i style="background:${esc(c.hex)}"></i>`).join('');
  return `
    <article class="card ${order >= 0 ? 'selected' : ''}" data-id="${esc(p.id)}">
      <span class="check">${order >= 0 ? order + 1 : ''}</span>
      ${p.designMd ? '<span class="attached" title="DESIGN.md attached">DESIGN.md</span>' : ''}
      ${p.thumb ? `<div class="thumb"><img src="${p.thumb}" alt="" loading="lazy"></div>` : ''}
      <div class="body">
        <div class="title">${esc(p.title)}</div>
        ${p.note ? `<div class="note">${esc(p.note)}</div>` : ''}
        ${swatches ? `<div class="swatches">${swatches}</div>` : ''}
        ${p.categories?.length ? `<div class="cats">${p.categories.map((c) => `<span class="tag">${esc(c)}</span>`).join('')}</div>` : ''}
        <div class="meta">
          ${p.favicon ? `<img src="${esc(p.favicon)}" alt="">` : ''}
          <span>${esc(p.hostname)}</span>
          <span class="kind">${p.kind === 'element' ? 'Section' : 'Page'}</span>
        </div>
      </div>
    </article>`;
}

function renderGrid() {
  const pins = visiblePins();
  $('#grid').innerHTML = pins.map(cardHtml).join('');
  const empty = $('#empty');
  empty.hidden = pins.length > 0;
  $('h2', empty).textContent = state.pins.length ? 'Nothing matches these filters' : 'No references yet';
}

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 1800);
}

function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- Sidebar & toolbar events ---------- */

$('#boards').onclick = (e) => {
  const b = e.target.closest('[data-board]');
  if (!b) return;
  state.board = b.dataset.board;
  render();
};

$('#new-board').onclick = async () => {
  const name = prompt('New board name');
  if (!name?.trim()) return;
  const board = await db.createBoard(name);
  state.board = board.id;
  await load();
};

$('#rename-board').onclick = async () => {
  const board = state.boards.find((b) => b.id === state.board);
  const name = prompt('Rename board', board.name);
  if (!name?.trim()) return;
  await db.renameBoard(board, name);
  await load();
};

$('#delete-board').onclick = async () => {
  const board = state.boards.find((b) => b.id === state.board);
  if (!confirm(`Delete "${board.name}"? Its references move to the Inbox.`)) return;
  await db.deleteBoard(board.id);
  state.board = 'all';
  await load();
};

$('#category-filter').onclick = (e) => {
  const c = e.target.closest('[data-category]')?.dataset.category;
  if (!c) return;
  state.categories.has(c) ? state.categories.delete(c) : state.categories.add(c);
  render();
};

$('#tag-filter').onclick = (e) => {
  const t = e.target.closest('[data-tag]')?.dataset.tag;
  if (!t) return;
  state.tag = state.tag === t ? null : t;
  render();
};

$('#search').oninput = (e) => {
  state.query = e.target.value;
  renderGrid();
  renderToolbar();
};

$('#toggle-select').onclick = () => {
  state.selecting = true;
  render();
};
$('#cancel-select').onclick = () => {
  state.selecting = false;
  state.selected = [];
  render();
};
$('#select-all').onclick = () => {
  for (const p of visiblePins()) if (!state.selected.includes(p.id)) state.selected.push(p.id);
  render();
};

// Inline onerror handlers are blocked by the extension CSP, so drop broken favicons here.
$('#grid').addEventListener('error', (e) => e.target.matches?.('.meta img') && e.target.remove(), true);

$('#grid').onclick = (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  if (state.selecting) {
    const i = state.selected.indexOf(id);
    i >= 0 ? state.selected.splice(i, 1) : state.selected.push(id);
    render();
  } else {
    openDetail(id);
  }
};

$('#generate').onclick = () => {
  const pins = state.selecting
    ? state.selected.map((id) => state.pins.find((p) => p.id === id)).filter(Boolean)
    : visiblePins().slice().reverse();
  openGenerator(pins);
};

$('#export').onclick = async () => {
  const data = await db.exportAll();
  download(`refboard-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'application/json');
};
$('#import').onclick = () => $('#import-file').click();
$('#import-file').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const n = await db.importAll(JSON.parse(await file.text()));
    toast(`Imported ${n} references`);
    await load();
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  }
  e.target.value = '';
};

/* ---------- Detail dialog ---------- */

function kvTable(obj) {
  const rows = Object.entries(obj || {}).filter(([, v]) => v);
  if (!rows.length) return '';
  return `<table class="kv">${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td><code>${esc(v)}</code></td></tr>`).join('')}</table>`;
}

// Collapsible gray card, styled after the DESIGN.md Inspector sections.
function section(title, count, body, open = true) {
  if (!body) return '';
  return `<details class="section" ${open ? 'open' : ''}><summary>${esc(title)}<span class="count">${esc(count)}</span></summary><div class="section-body">${body}</div></details>`;
}

const ROLE_LABELS = { background: 'Background', text: 'Text', border: 'Border' };
const SIZE_NAMES = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl', 'text-3xl', 'text-4xl', 'text-5xl', 'text-6xl'];

function colorsSection(palette = []) {
  const rows = palette
    .map((c) => `<button class="color-row" data-copy="${esc(c.hex)}" title="Copy ${esc(c.hex)}"><i style="background:${esc(c.hex)}"></i><code>${esc(c.hex.toUpperCase())}</code><span>${esc(c.roles.map((r) => ROLE_LABELS[r] || r).join(' · '))}</span></button>`)
    .join('');
  return section('Colors', `${palette.length} tokens`, rows);
}

function typographySection(fonts = [], typeScale = []) {
  if (!fonts.length) return '';
  const samples = fonts
    .map((f, i) => `<div class="font-sample"><div class="aa" style="font-family:${esc(f.stack)}">Aa</div><div class="name">${esc(f.family)}${i === 0 ? ' (primary)' : ''} · ${esc(f.weights.join(', '))}</div></div>`)
    .join('');
  const sizes = [...new Set(typeScale.map((t) => parseFloat(t.size)))].sort((a, b) => a - b);
  const pills = sizes.map((px, i) => `<span class="pill">${SIZE_NAMES[i] || `text-${i}`} (${Math.round(px)}px)</span>`).join('');
  const scale = sizes.length ? `<div class="sub">Size Scale</div><div class="pills">${pills}</div>` : '';
  return section('Typography', `${fonts.length} font${fonts.length === 1 ? '' : 's'}, ${sizes.length} sizes`, samples + scale);
}

function openDetail(id) {
  const pin = state.pins.find((p) => p.id === id);
  if (!pin) return;
  const a = pin.analysis || {};
  const dlg = $('#detail');
  dlg.innerHTML = `
    <div class="modal-head">
      <div class="heading">
        <img class="logo" src="../../icons/logo.svg" alt="">
        <div><h2>${esc(pin.title)}</h2><p>${pin.kind === 'element' ? 'Saved section' : 'Saved page'} · ${esc(pin.hostname)}</p></div>
      </div>
      <button class="close" data-close aria-label="Close">×</button>
    </div>
    <div class="modal-body detail">
      <div class="shot">${pin.image || pin.thumb ? `<img src="${pin.image || pin.thumb}" alt="">` : ''}</div>
      <div>
        <div class="source">${esc(pin.pageTitle || '')}<br><a href="${esc(pin.url)}" target="_blank" rel="noopener">${esc(pin.url)}</a></div>
        <label class="field"><span>Title</span><input class="input" name="title" value="${esc(pin.title)}"></label>
        <label class="field"><span>What do you want to use from this?</span><textarea class="input" name="note" rows="4">${esc(pin.note)}</textarea></label>
        <div class="field"><span>Focus</span><div class="chips">${CATEGORIES.map((c) => `<button type="button" class="chip" data-cat="${c}" aria-pressed="${!!pin.categories?.includes(c)}">${c}</button>`).join('')}</div></div>
        <label class="field"><span>Tags</span><input class="input" name="tags" value="${esc((pin.tags || []).join(', '))}"></label>
        <label class="field"><span>Board</span><select class="input" name="board">${state.boards.map((b) => `<option value="${esc(b.id)}" ${b.id === pin.boardId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>

        <div class="attach">
          <strong>DESIGN.md</strong>: attach the file DESIGN.md Inspector generated for this site, and its full token set will be included in your prompt.
          <div class="row">
            ${pin.designMd ? `<span class="tag">${esc(pin.designMd.name)} · ${Math.ceil(pin.designMd.text.length / 1024)} KB</span><button class="btn" data-act="detach">Remove</button>` : '<button class="btn" data-act="attach">Attach .md file</button>'}
            <input type="file" accept=".md,.markdown,text/markdown,text/plain" hidden>
          </div>
        </div>

        <div class="actions">
          <button class="btn danger" data-act="delete">Delete</button>
          <span class="spacer"></span>
          <button class="btn" data-close>Cancel</button>
          <button class="btn primary" data-act="save">Save changes</button>
        </div>

        <div class="sections">
          ${colorsSection(a.palette)}
          ${typographySection(a.fonts, a.typeScale)}
          ${pin.kind === 'element' ? section('Section styles', `${Object.keys(a.keyStyles || {}).length} properties`, kvTable(a.keyStyles)) : ''}
          ${section('Radius, shadow & motion', `${(a.radii?.length || 0) + (a.shadows?.length || 0) + (a.transitions?.length || 0)} tokens`, kvTable({ radius: (a.radii || []).join('  ·  '), shadow: (a.shadows || [])[0], motion: (a.transitions || [])[0], spacing: (a.spacing || []).join('  ·  ') }))}
          ${section('CSS variables', `${Object.keys(a.cssVars || {}).length} tokens`, kvTable(a.cssVars), false)}
          ${a.html ? section('HTML structure', `${Math.ceil(a.html.length / 1024)} KB`, `<pre>${esc(a.html)}</pre>`, false) : ''}
        </div>
      </div>
    </div>`;

  dlg.onclick = async (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) return dlg.close();
    const copy = e.target.closest('[data-copy]')?.dataset.copy;
    if (copy) {
      await navigator.clipboard.writeText(copy);
      return toast(`Copied ${copy}`);
    }
    const chip = e.target.closest('[data-cat]');
    if (chip) return chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'attach') $('input[type=file]', dlg).click();
    if (act === 'detach') {
      await db.savePin({ ...pin, designMd: null });
      await load();
      openDetail(id);
    }
    if (act === 'delete' && confirm('Delete this reference?')) {
      await db.deletePin(id);
      dlg.close();
      await load();
    }
    if (act === 'save') {
      await db.savePin({
        ...pin,
        title: $('[name=title]', dlg).value.trim() || pin.title,
        note: $('[name=note]', dlg).value.trim(),
        tags: $('[name=tags]', dlg).value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
        categories: [...dlg.querySelectorAll('[data-cat][aria-pressed="true"]')].map((b) => b.dataset.cat),
        boardId: $('[name=board]', dlg).value,
      });
      dlg.close();
      toast('Saved');
      await load();
    }
  };

  $('input[type=file]', dlg).onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await db.savePin({ ...pin, designMd: { name: file.name, text: await file.text() } });
    await load();
    openDetail(id);
    toast(`Attached ${file.name}`);
  };

  if (!dlg.open) dlg.showModal();
}

/* ---------- Generator dialog ---------- */

function openGenerator(pins) {
  const dlg = $('#generator');
  const hasDesignMd = pins.some((p) => p.designMd);
  const hasImages = pins.some((p) => p.image);
  let tab = 'prompt';
  dlg.innerHTML = `
    <div class="modal-head">
      <div class="heading">
        <img class="logo" src="../../icons/logo.svg" alt="">
        <div><h2>Generate prompt</h2><p>Turn ${pins.length} reference${pins.length === 1 ? '' : 's'} into PROMPT.md and DESIGN.md for Claude Code.</p></div>
      </div>
      <button class="close" data-close aria-label="Close">×</button>
    </div>
    <div class="modal-body">
      <div class="gen-options">
        <label class="field project"><span>Project name</span><input class="input" name="project" placeholder="e.g. Acme dashboard"></label>
        <label class="check-label"><input type="checkbox" name="html"> Include HTML structure</label>
        <label class="check-label"><input type="checkbox" name="designmd" ${hasDesignMd ? 'checked' : 'disabled'}> Include attached DESIGN.md files</label>
      </div>
      <div class="tab-bar">
        <div class="tabs" role="tablist">
          <button role="tab" data-tab="prompt" aria-selected="true">PROMPT.md</button>
          <button role="tab" data-tab="design" aria-selected="false">DESIGN.md</button>
        </div>
        <div class="tab-tools">
          <button class="icon-btn" data-act="copy" title="Copy">${ICONS.copy}</button>
          <button class="icon-btn" data-act="md" title="Download .md">${ICONS.download}</button>
          <button class="icon-btn" data-act="zip" title="Download ZIP with screenshots">${ICONS.archive}</button>
        </div>
      </div>
      <textarea class="output" readonly spellcheck="false"></textarea>
      <div class="use">
        <h4>Use with Claude Code</h4>
        <div class="use-row">
          <button class="btn" data-act="zip">${ICONS.archive} Download ZIP</button>
          <button class="btn" data-act="copy">${ICONS.copy} Copy</button>
          <button class="btn" data-act="md">${ICONS.download} Download .md</button>
        </div>
        <p>${hasImages ? 'The ZIP has PROMPT.md, DESIGN.md and the screenshots in <code>refs/</code>. ' : ''}Unzip it into your project, then tell Claude Code: <code>Read refboard/PROMPT.md and follow it.</code></p>
      </div>
    </div>`;

  const opts = () => ({
    project: $('[name=project]', dlg).value,
    includeHtml: $('[name=html]', dlg).checked,
    includeDesignMd: $('[name=designmd]', dlg).checked,
  });
  const output = $('.output', dlg);
  const refresh = () => {
    output.value = tab === 'prompt' ? buildPrompt(pins, opts()) : buildDesignMd(pins, opts());
  };

  dlg.oninput = refresh;
  dlg.onclick = async (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) return dlg.close();
    const t = e.target.closest('[data-tab]');
    if (t) {
      tab = t.dataset.tab;
      dlg.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b === t)));
      return refresh();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'copy') {
      await navigator.clipboard.writeText(output.value);
      toast(hasImages && tab === 'prompt' ? 'Copied (screenshots are only in the ZIP)' : 'Copied');
    }
    if (act === 'md') download(tab === 'prompt' ? 'PROMPT.md' : 'DESIGN.md', output.value, 'text/markdown');
    if (act === 'zip') {
      const o = opts();
      const zip = createZip([
        { name: 'refboard/PROMPT.md', data: buildPrompt(pins, o) },
        { name: 'refboard/DESIGN.md', data: buildDesignMd(pins, o) },
        ...imageFiles(pins).map((f) => ({ name: `refboard/${f.name}`, data: dataUrlToBytes(f.dataUrl) })),
      ]);
      download(`refboard-${(o.project || 'references').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.zip`, zip, 'application/zip');
    }
  };

  refresh();
  dlg.showModal();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'pinsChanged') load();
});

load();
