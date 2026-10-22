import * as db from '../lib/db.js';
import { CATEGORIES } from '../lib/constants.js';
import { buildPrompt, buildDesignMd, bundleFiles, slug } from '../lib/generate.js';
import { buildSiteDesignMd, siteOf, siteSummary } from '../lib/design-md.js';
import { createZip, dataUrlToBytes } from '../lib/zip.js';
import { getRoot, setRoot, folderStatus, requestAccess, syncPin, removePinFiles, writeProjectFiles, readText } from '../lib/fsstore.js';
import { buildProjectFiles } from '../lib/project-docs.js';
import { analyzeMotion } from '../lib/motion.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),
  download: svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'),
  external: svg('<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>'),
  trash: svg('<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'),
  play: svg('<path d="M8 5v14l11-7Z" fill="currentColor" stroke="none"/>'),
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
  folder: { state: 'none' },
  activeId: db.DEFAULT_BOARD.id,
};

async function load() {
  [state.pins, state.boards, state.folder] = await Promise.all([db.listPins(), db.listBoards(), folderStatus()]);
  const { activeProjectId } = await chrome.storage.local.get('activeProjectId');
  state.activeId = state.boards.some((b) => b.id === activeProjectId) ? activeProjectId : db.DEFAULT_BOARD.id;
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
  renderFolderBox();
  renderSidebar();
  renderToolbar();
  renderGrid();
}

function renderSidebar() {
  const counts = new Map();
  for (const p of state.pins) counts.set(p.boardId, (counts.get(p.boardId) || 0) + 1);
  const items = [{ id: 'all', name: 'All references', n: state.pins.length }, ...state.boards.map((b) => ({ ...b, n: counts.get(b.id) || 0 }))];
  $('#boards').innerHTML = items
    .map((b) => `<li><button data-board="${esc(b.id)}" aria-current="${b.id === state.board}"><span>${esc(b.name)}${b.id === state.activeId ? ' <i class="active-dot" title="Active project: shortcuts save here"></i>' : ''}</span><span class="count">${b.n}</span></button></li>`)
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

// Where captures are written on disk, and whether Chrome currently lets us write there.
function renderFolderBox() {
  const f = state.folder;
  const pending = state.pins.filter((p) => p.synced !== true).length;
  const box = $('#folder-box');
  if (f.state === 'none') {
    box.innerHTML = `<p><b>Save to a folder</b>Pick a folder once; every project gets a subfolder with its screenshots, recordings, DESIGN.md and SKILL.md.</p><button class="btn primary" data-folder="pick">${ICONS.folder} Choose folder</button>`;
  } else if (f.state !== 'granted') {
    box.innerHTML = `<p><b>${ICONS.folder} ${esc(f.name)}</b>Chrome needs your OK to write here again${pending ? ` (${pending} waiting)` : ''}.</p><button class="btn primary" data-folder="reconnect">Reconnect folder</button>`;
  } else {
    box.innerHTML = `<p class="ok"><b>${ICONS.folder} ${esc(f.name)}</b>${pending ? `${pending} not written yet · <button class="link" data-folder="sync">Write now</button>` : 'Connected · all captures saved'}</p><button class="link small" data-folder="pick">Change folder</button>`;
  }
}

function renderToolbar() {
  const board = state.boards.find((b) => b.id === state.board);
  $('#board-title').textContent = board ? board.name : 'All references';
  $('#board-subtitle').innerHTML = board
    ? `${board.id === state.activeId ? '<span class="badge-active">Active project</span>' : '<button class="link small" id="set-active">Set as active project</button>'}<span class="folder-path">${ICONS.folder} ${esc(state.folder.name ? `${state.folder.name}/` : '')}${esc(board.folder)}</span>`
    : '';
  $('#board-actions').hidden = !board || board.id === db.DEFAULT_BOARD.id;
  const build = $('#build');
  build.hidden = !board;
  build.disabled = !state.pins.some((p) => p.boardId === board?.id);
  document.body.classList.toggle('selecting', state.selecting);
  $('#select-bar').hidden = !state.selecting;
  $('#toggle-select').hidden = state.selecting;
  $('#selected-count').textContent = `${state.selected.length} selected`;
  $('#delete-selected').disabled = state.selected.length === 0;
  const gen = $('#generate');
  gen.disabled = state.selecting ? state.selected.length === 0 : visiblePins().length === 0;
  gen.textContent = state.selecting && state.selected.length ? `Export ${state.selected.length} as ZIP` : 'Export ZIP';
}

function systemLine(p) {
  const sys = siteOf(p);
  if (!sys?.colors) return '';
  const parts = [`${sys.colors.length} colors`, `${sys.typography?.families?.length || 0} fonts`];
  if (sys.spacing?.base) parts.push(`${sys.spacing.base}px grid`);
  if (sys.components?.buttons?.length) parts.push(`${sys.components.buttons.length} button styles`);
  return `<div class="sysline">${esc(parts.join(' · '))}</div>`;
}

function motionLine(p) {
  const m = p.motionAnalysis || analyzeMotion(p.motion);
  return `<div class="sysline">${esc(`${m.effects.length} effect${m.effects.length === 1 ? '' : 's'} measured · ${(p.frames || []).length} key frames`)}</div>`;
}

function cardHtml(p) {
  const order = state.selected.indexOf(p.id);
  const swatches = (p.analysis?.palette || []).slice(0, 8).map((c) => `<i style="background:${esc(c.hex)}"></i>`).join('');
  return `
    <article class="card ${order >= 0 ? 'selected' : ''}" data-id="${esc(p.id)}">
      <span class="check">${order >= 0 ? order + 1 : ''}</span>
      <button class="trash" data-delete title="Delete">${ICONS.trash}</button>
      ${p.designMd ? '<span class="attached" title="DESIGN.md attached">DESIGN.md</span>' : ''}
      ${p.thumb ? `<div class="thumb"><img src="${p.thumb}" alt="" loading="lazy">${p.kind === 'recording' ? `<span class="rec-badge">${ICONS.play} ${(p.duration / 1000).toFixed(1)}s</span>` : ''}</div>` : ''}
      <div class="body">
        <div class="title">${esc(p.title)}</div>
        ${p.note ? `<div class="note">${esc(p.note)}</div>` : ''}
        ${swatches ? `<div class="swatches">${swatches}</div>` : ''}
        ${p.kind === 'recording' ? motionLine(p) : systemLine(p)}
        ${p.categories?.length ? `<div class="cats">${p.categories.map((c) => `<span class="tag">${esc(c)}</span>`).join('')}</div>` : ''}
        <div class="meta">
          ${p.favicon ? `<img src="${esc(p.favicon)}" alt="">` : ''}
          <span>${esc(p.hostname)}</span>
          <span class="kind">${p.synced === false ? '<i class="unsynced" title="Not written to the folder yet"></i>' : ''}${{ element: 'Section', recording: 'Recording' }[p.kind] || 'Screenshot'}</span>
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

function toast(text, action) {
  const t = $('#toast');
  const btn = $('button', t);
  $('span', t).textContent = text;
  btn.hidden = !action;
  if (action) {
    btn.textContent = action.label;
    btn.onclick = () => {
      t.hidden = true;
      action.run();
    };
  }
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), action ? 6000 : 1800);
}

// Deletes right away and offers Undo, so a mistake is one click to fix.
async function removePins(ids) {
  const removed = state.pins.filter((p) => ids.includes(p.id));
  if (!removed.length) return;
  for (const p of removed) {
    await db.deletePin(p.id);
    await removePinFiles(p).catch(() => {});
  }
  state.selected = state.selected.filter((id) => !ids.includes(id));
  await load();
  toast(`Deleted ${removed.length === 1 ? `"${removed[0].title}"` : `${removed.length} references`}`, {
    label: 'Undo',
    run: async () => {
      for (const p of removed) {
        await db.savePin(p);
        await syncPin(p.id).catch(() => {});
      }
      await load();
    },
  });
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
  const name = prompt('New project name (it becomes a folder)');
  if (!name?.trim()) return;
  const board = await db.createBoard(name);
  state.board = board.id;
  await chrome.storage.local.set({ activeProjectId: board.id });
  await load();
  toast(`“${board.name}” is now the active project`);
};

$('#rename-board').onclick = async () => {
  const board = state.boards.find((b) => b.id === state.board);
  const name = prompt('Rename project (the folder keeps its name)', board.name);
  if (!name?.trim()) return;
  await db.renameBoard(board, name);
  await load();
};

$('#delete-board').onclick = async () => {
  const board = state.boards.find((b) => b.id === state.board);
  if (!confirm(`Delete "${board.name}"? Its references move to the Inbox. Files already in its folder stay on disk.`)) return;
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
$('#delete-selected').onclick = () => removePins([...state.selected]);
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
  if (e.target.closest('[data-delete]')) return removePins([id]);
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

/* ---------- Folder, active project, build ---------- */

// Needs a click (user gesture). Returns true when Refboard can write to the folder.
async function ensureFolder({ pick = false } = {}) {
  let status = await folderStatus();
  if (pick || status.state === 'none') {
    let handle;
    try {
      handle = await window.showDirectoryPicker({ id: 'refboard', mode: 'readwrite', startIn: 'documents' });
    } catch {
      return false; // cancelled
    }
    await setRoot(handle);
    status = await folderStatus();
  }
  if (status.state !== 'granted') status = { state: await requestAccess() };
  return status.state === 'granted';
}

async function syncPending() {
  const pending = (await db.listPins()).filter((p) => p.synced !== true);
  let n = 0;
  for (const p of pending) if (await syncPin(p.id).catch(() => false)) n++;
  return n;
}

$('#folder-box').onclick = async (e) => {
  const act = e.target.closest('[data-folder]')?.dataset.folder;
  if (!act) return;
  if (!(await ensureFolder({ pick: act === 'pick' }))) return toast('Folder not connected');
  toast('Writing captures to the folder…');
  const n = await syncPending();
  await load();
  toast(n ? `Wrote ${n} capture${n === 1 ? '' : 's'} to ${state.folder.name}` : `Connected to ${state.folder.name}`);
};

$('.toolbar').addEventListener('click', async (e) => {
  if (e.target.closest('#set-active')) {
    await chrome.storage.local.set({ activeProjectId: state.board });
    await load();
    toast('Shortcuts now save to this project');
  }
});

$('#build').onclick = async () => {
  const board = state.boards.find((b) => b.id === state.board);
  if (!board) return;
  if (!(await ensureFolder())) return toast('Choose a folder first, or use Export ZIP');
  const btn = $('#build');
  btn.disabled = true;
  btn.textContent = 'Building…';
  try {
    for (const p of state.pins.filter((x) => x.boardId === board.id && x.synced !== true)) await syncPin(p.id).catch(() => {});
    const pins = (await db.listPins()).filter((p) => p.boardId === board.id);
    const files = buildProjectFiles(board, pins);
    const where = await writeProjectFiles(board, files);
    await load();
    toast(`Built ${files.length} files in ${where}`);
  } catch (err) {
    toast(`Build failed: ${err.message}`);
  } finally {
    btn.textContent = 'Build files';
    renderToolbar();
  }
};

// Rebuilds the board from refboard.json + media in the folder (e.g. after Chrome data was cleared).
$('#restore').onclick = async () => {
  if (!(await ensureFolder({ pick: !(await getRoot()) }))) return;
  const root = await getRoot();
  let restored = 0;
  const fileUrl = async (dir, rel) => {
    try {
      let d = dir;
      const parts = rel.split('/');
      const name = parts.pop();
      for (const p of parts) d = await d.getDirectoryHandle(p);
      const file = await (await d.getFileHandle(name)).getFile();
      return await new Promise((r) => {
        const fr = new FileReader();
        fr.onload = () => r(fr.result);
        fr.readAsDataURL(file);
      });
    } catch {
      return null;
    }
  };
  for await (const [name, dir] of root.entries()) {
    if (dir.kind !== 'directory') continue;
    let data;
    try {
      data = JSON.parse(await readText(dir, 'refboard.json'));
    } catch {
      continue; // not a Refboard project folder (or never built)
    }
    const boards = await db.listBoards();
    if (!boards.some((b) => b.id === data.project.id)) await db.importAll({ app: 'refboard', boards: [{ ...data.project, folder: name }], pins: [] });
    for (const pin of data.pins) {
      if (state.pins.some((p) => p.id === pin.id)) continue;
      const f = pin.files || {};
      const restoredPin = { ...pin, boardId: data.project.id, synced: true };
      if (f.screenshot) restoredPin.image = await fileUrl(dir, f.screenshot);
      if (f.contactSheet) restoredPin.contactSheet = await fileUrl(dir, f.contactSheet);
      if (f.frames) restoredPin.frames = await Promise.all(f.frames.map(async (rel, i) => ({ t: pin.frameTimes?.[i] ?? 0, image: await fileUrl(dir, rel) })));
      if (f.video) {
        try {
          let d = dir;
          for (const p of f.video.split('/').slice(0, -1)) d = await d.getDirectoryHandle(p);
          restoredPin.video = await (await d.getFileHandle(f.video.split('/').pop())).getFile();
        } catch {
          /* video missing */
        }
      }
      restoredPin.thumb = restoredPin.image || restoredPin.contactSheet || null;
      await db.savePin(restoredPin);
      restored++;
    }
  }
  await load();
  toast(restored ? `Restored ${restored} reference${restored === 1 ? '' : 's'} from the folder` : 'Nothing new to restore (build a project first to create refboard.json)');
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

const pills = (items) => `<div class="pills">${items.map((t) => `<span class="pill">${esc(t)}</span>`).join('')}</div>`;
const sub = (t) => `<div class="sub">${esc(t)}</div>`;
const LEGACY_ROLES = { background: 'Background', text: 'Text', border: 'Border' };

function colorsSection(colors = []) {
  const rows = colors
    .map((c) => {
      const role = c.role || (c.roles || []).map((r) => LEGACY_ROLES[r] || r).join(' · ');
      return `<button class="color-row" data-copy="${esc(c.hex)}" title="Copy ${esc(c.hex)}"><i style="background:${esc(c.hex)}"></i><code>${esc(c.hex.toUpperCase())}</code>${c.token ? `<em>${esc(c.token)}</em>` : ''}<span>${esc(role)}</span></button>`;
    })
    .join('');
  return section('Colors', `${colors.length} tokens`, rows);
}

function fontSamples(families) {
  return families
    .map((f, i) => {
      const usage = f.usage?.length ? f.usage.join(', ') : i === 0 ? 'primary' : '';
      const share = f.share !== undefined && f.share <= 100 ? ` · ${f.share}% of text` : '';
      return `<div class="font-sample"><div class="aa" style="font-family:${esc(f.stack)}">Aa</div><div class="name">${esc(f.family)}${usage ? ` (${esc(usage)})` : ''} · ${esc(f.weights.join(', '))}${share}</div></div>`;
    })
    .join('');
}

// Full typography card from a measured system.
function typographySystem(t) {
  if (!t?.families?.length) return '';
  const elements = Object.entries(t.elements || {});
  const body = [
    fontSamples(t.families),
    t.scale?.length ? sub('Size Scale') + pills(t.scale.map((s) => `${s.name} (${s.size})`)) : '',
    t.weights?.length ? sub('Weight Scale') + pills(t.weights) : '',
    t.lineHeights?.length ? sub('Line Heights') + pills(t.lineHeights.map(String)) : '',
    elements.length
      ? sub('Element Styles') + kvTable(Object.fromEntries(elements.map(([k, v]) => [k, `${v.family} ${v.size} / ${v.weight}${v.lineHeight !== 'normal' ? ` / ${v.lineHeight}` : ''}${v.transform ? ` · ${v.transform}` : ''}`])))
      : '',
  ].join('');
  return section('Typography', `${t.families.length} font${t.families.length === 1 ? '' : 's'}, ${t.scale?.length || 0} sizes`, body);
}

// Typography card for pins saved before Refboard measured full systems.
function typographyLegacy(fonts = [], typeScale = []) {
  if (!fonts.length) return '';
  const sizes = [...new Set(typeScale.map((t) => Math.round(parseFloat(t.size))))].sort((a, b) => a - b);
  return section('Typography', `${fonts.length} fonts, ${sizes.length} sizes`, fontSamples(fonts) + (sizes.length ? sub('Size Scale') + pills(sizes.map((px) => `${px}px`)) : ''));
}

// Renders a captured component style as a live preview.
const SAFE_PROPS = /^(background-color|color|border|border-radius|padding|font-family|font-size|font-weight|text-transform|letter-spacing|box-shadow|text-decoration-line|height)$/;
function preview(kind, v) {
  const style = Object.entries(v.styles).filter(([k]) => SAFE_PROPS.test(k)).map(([k, val]) => `${k}:${String(val).replace(/[;"<>]/g, '')}`).join(';');
  const label = esc(v.sample || { buttons: 'Button', badges: 'Badge', links: 'Link', inputs: '', cards: '' }[kind] || '');
  if (kind === 'inputs') return `<input class="cmp-input" style="${style}" placeholder="Input" tabindex="-1">`;
  if (kind === 'cards') return `<div class="cmp-card" style="${style}"><b>Card</b><span>${label || 'Example content'}</span></div>`;
  return `<span class="cmp-inline" style="${style}">${label}</span>`;
}

function componentsSection(c) {
  if (!c) return '';
  const groups = [['buttons', 'Buttons'], ['inputs', 'Inputs'], ['cards', 'Cards'], ['badges', 'Badges'], ['links', 'Links']].filter(([k]) => c[k]?.length);
  if (!groups.length) return '';
  const body = groups
    .map(([k, title]) => sub(title) + c[k].map((v) => `<div class="cmp">${preview(k, v)}<details><summary>${v.count} on page · styles</summary>${kvTable(v.styles)}</details></div>`).join(''))
    .join('');
  return section('Components', `${groups.reduce((n, [k]) => n + c[k].length, 0)} variants`, body);
}

function shadowsSection(shadows = []) {
  if (!shadows.length) return '';
  const rows = shadows.map((s) => `<div class="shadow-row"><i style="box-shadow:${esc(s.value)}"></i><div><b>${esc(s.name)}</b><code>${esc(s.value)}</code></div></div>`).join('');
  return section('Elevation', `${shadows.length} levels`, rows);
}

function systemSections(sys, { open = true } = {}) {
  const sp = sys.spacing || {};
  const m = sys.motion || {};
  const l = sys.layout || {};
  return [
    colorsSection(sys.colors),
    typographySystem(sys.typography),
    section('Spacing', sp.base ? `${sp.base}px grid` : `${sp.scale?.length || 0} values`, sp.scale?.length ? pills(sp.scale) : '', open),
    section('Border radius', `${sys.radius?.length || 0} values`, sys.radius?.length ? pills(sys.radius.map((r) => `${r.value}${r.full ? ' (pill)' : ''}`)) : '', open),
    shadowsSection(sys.shadows),
    section('Motion', `${(m.durations?.length || 0) + (m.animations?.length || 0)} tokens`,
      [m.durations?.length && sub('Durations') + pills(m.durations), m.easings?.length && sub('Easing') + pills(m.easings), m.animations?.length && sub('Keyframes') + pills(m.animations)].filter(Boolean).join(''), open),
    section('Layout', `${sys.breakpoints?.length || 0} breakpoints`,
      [l.containerWidths?.length && sub('Container widths') + pills(l.containerWidths.map((w) => `${w}px`)), l.gridColumns?.length && sub('Grid columns') + pills(l.gridColumns.map(String)), sys.breakpoints?.length && sub('Breakpoints') + pills(sys.breakpoints.map((b) => `${b}px`))].filter(Boolean).join(''), open),
    componentsSection(sys.components),
    section('CSS variables', `${Object.keys(sys.cssVars || {}).length} tokens`, kvTable(sys.cssVars), false),
  ].join('');
}

function sectionTab(pin) {
  const a = pin.analysis || {};
  const styles = section('Section styles', `${Object.keys(a.keyStyles || {}).length} properties`, kvTable(a.keyStyles));
  const html = a.html ? section('HTML structure', `${Math.ceil(a.html.length / 1024)} KB`, `<pre>${esc(a.html)}</pre>`, false) : '';
  if (a.system) return styles + systemSections({ ...a.system, cssVars: {} }) + html;
  return (
    styles +
    colorsSection(a.palette) +
    typographyLegacy(a.fonts, a.typeScale) +
    section('Radius, shadow & motion', 'measured', kvTable({ radius: (a.radii || []).join('  ·  '), shadow: (a.shadows || [])[0], motion: (a.transitions || [])[0] })) +
    html
  );
}

function systemTab(pin) {
  const sys = siteOf(pin);
  if (!sys?.colors) {
    const a = pin.analysis || {};
    return `<p class="notice">This reference was saved with an older version of Refboard, so only a short summary was measured. Save it again to get the full design system.</p>${colorsSection(a.palette)}${typographyLegacy(a.fonts, a.typeScale)}`;
  }
  const truncated = sys.stats?.truncated ? ' Very large page, so a sample of it was scanned.' : '';
  return `<p class="summary">${esc(siteSummary(sys))}${esc(truncated)}</p>${systemSections(sys)}`;
}

function designMdTab(pin) {
  return `
    <div class="md-tools">
      <span>${pin.designMd ? `Your attached <code>${esc(pin.designMd.name)}</code> is included in prompts too.` : 'Generated from this site, ready for Claude Code.'}</span>
      <button class="icon-btn" data-act="copy-md" title="Copy">${ICONS.copy}</button>
      <button class="icon-btn" data-act="download-md" title="Download">${ICONS.download}</button>
    </div>
    <textarea class="output md-output" readonly spellcheck="false">${esc(buildSiteDesignMd(pin))}</textarea>`;
}

function detailsTab(pin) {
  return `
    <div class="source">${esc(pin.pageTitle || '')}<br><a href="${esc(pin.url)}" target="_blank" rel="noopener">${esc(pin.url)}</a></div>
    <label class="field"><span>Title</span><input class="input" name="title" value="${esc(pin.title)}"></label>
    <label class="field"><span>What do you want to use from this?</span><textarea class="input" name="note" rows="4">${esc(pin.note)}</textarea></label>
    <div class="field"><span>Focus</span><div class="chips">${CATEGORIES.map((c) => `<button type="button" class="chip" data-cat="${c}" aria-pressed="${!!pin.categories?.includes(c)}">${c}</button>`).join('')}</div></div>
    <label class="field"><span>Tags</span><input class="input" name="tags" value="${esc((pin.tags || []).join(', '))}"></label>
    <label class="field"><span>Board</span><select class="input" name="board">${state.boards.map((b) => `<option value="${esc(b.id)}" ${b.id === pin.boardId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
    <div class="actions">
      <button class="btn danger" data-act="delete">${ICONS.trash} Delete</button>
      <span class="spacer"></span>
      <button class="btn" data-close>Cancel</button>
      <button class="btn primary" data-act="save">Save changes</button>
    </div>
    <div class="attach">
      <strong>Own DESIGN.md</strong> (optional): Refboard already generates one in the DESIGN.md tab. If you also have one from another tool, attach it and it will be included in prompts.
      <div class="row">
        ${pin.designMd ? `<span class="tag">${esc(pin.designMd.name)} · ${Math.ceil(pin.designMd.text.length / 1024)} KB</span><button class="btn" data-act="detach">Remove</button>` : '<button class="btn" data-act="attach">Attach .md file</button>'}
        <input type="file" accept=".md,.markdown,text/markdown,text/plain" hidden>
      </div>
    </div>`;
}

const videoUrls = new Map();
function videoUrl(pin) {
  if (!videoUrls.has(pin.id)) videoUrls.set(pin.id, URL.createObjectURL(pin.video));
  return videoUrls.get(pin.id);
}

const TRIGGER_LABEL = { scroll: 'On scroll', hover: 'On hover', click: 'On click', load: 'On load', loop: 'Loop', time: 'Timed' };

function motionTab(pin) {
  const m = pin.motionAnalysis || analyzeMotion(pin.motion);
  const effects = m.effects
    .map((e, i) => `
      <div class="effect">
        <div class="effect-head"><span class="trigger t-${esc(e.trigger.type)}">${esc(TRIGGER_LABEL[e.trigger.type] || e.trigger.type)}</span><b>${i + 1}. ${esc(e.what || e.name)}</b></div>
        <div class="effect-meta">${esc(e.duration ? `${e.duration}ms${e.durationSource === 'measured' ? ' (measured)' : ''}` : 'follows scroll')}${e.easing ? ` · <code>${esc(e.easing)}</code>` : ''}${e.stagger ? ` · stagger ${e.stagger}ms` : ''}${e.count > 1 ? ` · ${e.count} elements` : ''}${e.iterations === 'infinite' ? ' · loops' : ''}</div>
        <p>${esc(e.text)}</p>
        ${e.css ? `<details><summary>CSS starting point</summary><pre>${esc(e.css)}</pre></details>` : ''}
      </div>`)
    .join('');
  return `<p class="summary">${esc(m.summary)}</p>${effects || '<p class="notice">No animation was detected in the recorded area. The video and frames still show the result. Add a note describing what should happen.</p>'}
    <p class="hint-text">Measured from the live page while recording: CSS animations and transitions are exact; JavaScript-driven motion is measured every 100ms.</p>`;
}

function framesTab(pin) {
  const frames = (pin.frames || []).map((f, i) => `<figure><img src="${f.image}" alt=""><figcaption>${i + 1} · ${(f.t / 1000).toFixed(1)}s</figcaption></figure>`).join('');
  return `${pin.contactSheet ? `<div class="sub">Contact sheet (what Claude looks at)</div><img class="sheet" src="${pin.contactSheet}" alt="">` : ''}<div class="sub">Key frames</div><div class="frames">${frames || '<p class="notice">No frames.</p>'}</div>`;
}

function openDetail(id, tab = 'details') {
  const pin = state.pins.find((p) => p.id === id);
  if (!pin) return;
  const dlg = $('#detail');
  const tabs = [['details', 'Details'], pin.kind === 'element' && ['section', 'This section'], pin.kind === 'recording' && ['motion', 'Motion'], pin.kind === 'recording' && ['frames', 'Frames'], ['system', 'Design system'], ['md', 'DESIGN.md']].filter(Boolean);
  if (!tabs.some(([k]) => k === tab)) tab = 'details';
  const date = new Date(pin.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  dlg.innerHTML = `
    <div class="modal-head">
      <div class="heading">
        <img class="logo" src="../../icons/logo.svg" alt="">
        <div><h2>${esc(pin.title)}</h2><p>${{ element: 'Saved section', recording: `Recording · ${(pin.duration / 1000).toFixed(1)}s` }[pin.kind] || 'Screenshot'} · ${esc(pin.hostname)} · ${esc(date)}</p></div>
      </div>
      <div class="head-tools">
        <a class="icon-btn" href="${esc(pin.url)}" target="_blank" rel="noopener" title="Open the site">${ICONS.external}</a>
        <button class="icon-btn danger" data-act="delete" title="Delete this reference (Delete key)">${ICONS.trash}</button>
        <button class="close" data-close aria-label="Close">×</button>
      </div>
    </div>
    <div class="modal-body detail">
      <div class="shot">${pin.kind === 'recording' && pin.video ? `<video src="${videoUrl(pin)}" ${pin.frames?.[0] ? `poster="${pin.frames[0].image}"` : ''} controls autoplay muted loop playsinline></video>` : pin.image || pin.contactSheet || pin.thumb ? `<img src="${pin.image || pin.contactSheet || pin.thumb}" alt="">` : ''}</div>
      <div class="detail-main">
        <div class="tabs detail-tabs" role="tablist">${tabs.map(([k, label]) => `<button role="tab" data-tab="${k}" aria-selected="${k === tab}">${label}</button>`).join('')}</div>
        <div class="tab-panel">${{ details: detailsTab, section: sectionTab, motion: motionTab, frames: framesTab, system: systemTab, md: designMdTab }[tab](pin)}</div>
      </div>
    </div>`;

  dlg.onclick = async (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) return dlg.close();
    const t = e.target.closest('[data-tab]');
    if (t) return openDetail(id, t.dataset.tab);
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
      openDetail(id, tab);
    }
    if (act === 'delete') {
      dlg.close();
      await removePins([id]);
    }
    if (act === 'copy-md') {
      await navigator.clipboard.writeText($('.md-output', dlg).value);
      toast('Copied DESIGN.md');
    }
    if (act === 'download-md') download(`${slug(pin.hostname, 40)}.DESIGN.md`, $('.md-output', dlg).value, 'text/markdown');
    if (act === 'save') {
      const moved = $('[name=board]', dlg).value !== pin.boardId;
      await db.savePin({
        ...pin,
        title: $('[name=title]', dlg).value.trim() || pin.title,
        note: $('[name=note]', dlg).value.trim(),
        tags: $('[name=tags]', dlg).value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
        categories: [...dlg.querySelectorAll('[data-cat][aria-pressed="true"]')].map((b) => b.dataset.cat),
        boardId: $('[name=board]', dlg).value,
      });
      dlg.close();
      if (moved) await syncPin(id).catch(() => {}); // moves its files to the new project folder
      toast(moved ? 'Saved and moved to the other project' : 'Saved');
      await load();
    }
  };

  // Delete key removes the reference (unless you're typing in a field).
  dlg.onkeydown = (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.target.closest('input, textarea, select')) {
      e.preventDefault();
      dlg.close();
      removePins([id]);
    }
  };

  const file = $('input[type=file]', dlg);
  if (file) {
    file.onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      await db.savePin({ ...pin, designMd: { name: f.name, text: await f.text() } });
      await load();
      openDetail(id, tab);
      toast(`Attached ${f.name}`);
    };
  }

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
        <div><h2>Generate for Claude Code</h2><p>Turn ${pins.length} reference${pins.length === 1 ? '' : 's'} into a prompt, a design system and tokens.</p></div>
      </div>
      <button class="close" data-close aria-label="Close">×</button>
    </div>
    <div class="modal-body">
      <div class="gen-options">
        <label class="field project"><span>Project name</span><input class="input" name="project" placeholder="e.g. Acme dashboard"></label>
        <label class="check-label"><input type="checkbox" name="site" checked> Include each site's design system</label>
        <label class="check-label"><input type="checkbox" name="html"> Include HTML structure</label>
        <label class="check-label"><input type="checkbox" name="designmd" ${hasDesignMd ? 'checked' : 'disabled'}> Include attached DESIGN.md files</label>
      </div>
      <div class="tab-bar">
        <div class="tabs" role="tablist">
          <button role="tab" data-tab="prompt" aria-selected="true">PROMPT.md</button>
          <button role="tab" data-tab="design" aria-selected="false">DESIGN.md</button>
          <button role="tab" data-tab="tokens" aria-selected="false">tokens.css</button>
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
        <p>The ZIP has <code>refboard/</code> (PROMPT.md, DESIGN.md, tokens.css, a full DESIGN.md per site in <code>sites/</code>${hasImages ? ', screenshots in <code>refs/</code>' : ''}) and a Claude Code skill in <code>.claude/skills/</code>. Unzip it into your project root, then tell Claude Code: <code>Read refboard/PROMPT.md and follow it.</code> The skill makes Claude use these references automatically in later sessions.</p>
      </div>
    </div>`;

  const opts = () => ({
    project: $('[name=project]', dlg).value,
    includeHtml: $('[name=html]', dlg).checked,
    includeSite: $('[name=site]', dlg).checked,
    includeDesignMd: $('[name=designmd]', dlg).checked,
  });
  const output = $('.output', dlg);
  const refresh = () => {
    const o = opts();
    if (tab === 'prompt') output.value = buildPrompt(pins, o);
    else if (tab === 'design') output.value = buildDesignMd(pins, o);
    else output.value = bundleFiles(pins, o).find((f) => f.name.endsWith('tokens.css')).data;
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
    if (act === 'md') download({ prompt: 'PROMPT.md', design: 'DESIGN.md', tokens: 'tokens.css' }[tab], output.value, tab === 'tokens' ? 'text/css' : 'text/markdown');
    if (act === 'zip') {
      const o = opts();
      const zip = createZip(bundleFiles(pins, o).map((f) => ({ name: f.name, data: f.dataUrl ? dataUrlToBytes(f.dataUrl) : f.data })));
      download(`refboard-${(o.project || 'references').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.zip`, zip, 'application/zip');
    }
  };

  refresh();
  dlg.showModal();
}

$('#version').textContent = `Refboard v${chrome.runtime.getManifest().version}`;

chrome.commands.getAll().then((cmds) => {
  for (const kbd of document.querySelectorAll('[data-shortcut]')) {
    const s = cmds.find((c) => c.name === kbd.dataset.shortcut)?.shortcut;
    kbd.textContent = s || 'not set';
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'pinsChanged') load();
});

load();
