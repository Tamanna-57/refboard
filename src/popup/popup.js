import { CATEGORIES } from '../lib/constants.js';
import { folderStatus } from '../lib/fsstore.js';
import { getStorageMode } from '../lib/db.js';

const $ = (sel) => document.querySelector(sel);
const send = (msg) => chrome.runtime.sendMessage(msg);

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
$('#version').textContent = `v${chrome.runtime.getManifest().version}`;

function status(text, isError = false) {
  const el = $('#status');
  el.hidden = false;
  el.textContent = text;
  el.className = isError ? 'error' : '';
}

/* ---------- active project + folder ---------- */

let boards = [];
async function renderProjects() {
  const res = await send({ type: 'getBoards' });
  boards = res.boards;
  const select = $('#project');
  select.innerHTML = '';
  for (const b of boards) select.add(new Option(b.name, b.id, false, b.id === res.lastBoardId));
  select.add(new Option('+ New project…', '__new'));
  const board = boards.find((b) => b.id === res.lastBoardId);
  const el = $('#folder');
  const mode = await getStorageMode();
  const folder = await folderStatus();
  const ok = mode !== 'folder' || folder.state === 'granted';
  el.classList.toggle('warn', !ok);
  const path = mode === 'folder' ? `${folder.name}/${board?.folder || ''}` : `Downloads/Refboard/${board?.folder || ''}`;
  if (ok) {
    el.innerHTML = '';
    el.append(`📁 ${path} `);
    const a = Object.assign(document.createElement('a'), { href: '#', textContent: 'Show' });
    a.onclick = async (e) => {
      e.preventDefault();
      const r = await send({ type: 'showInFolder', boardId: board?.id });
      if (r && !r.ok) status(r.error, true);
    };
    if (mode !== 'folder') el.append(a);
  } else el.innerHTML = `Folder needs reconnecting. <a href="#" data-open-board>Reconnect</a>`;
}

$('#project').onchange = async () => {
  const select = $('#project');
  if (select.value === '__new') {
    $('#new-project').hidden = false;
    $('#new-project').focus();
    return;
  }
  await send({ type: 'setActiveProject', id: select.value });
  await renderProjects();
};

$('#new-project').onkeydown = async (e) => {
  if (e.key !== 'Enter' || !e.target.value.trim()) return;
  await send({ type: 'setActiveProject', id: `__new:${e.target.value.trim()}` });
  e.target.value = '';
  e.target.hidden = true;
  await renderProjects();
};

document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-open-board]')) return;
  e.preventDefault();
  await send({ type: 'openBoard' });
  window.close();
});

$('#open-board').onclick = async () => {
  await send({ type: 'openBoard' });
  window.close();
};

/* ---------- capture actions ---------- */

const commands = await chrome.commands.getAll();
for (const kbd of document.querySelectorAll('[data-shortcut]')) {
  const s = commands.find((c) => c.name === kbd.dataset.shortcut)?.shortcut;
  kbd.textContent = s || 'no shortcut';
}

const { recording } = await send({ type: 'recStatus' });
if (recording) {
  $('[data-run="record-area"]').classList.add('recording');
  $('#record-label').textContent = 'Stop recording';
  $('#record-hint').textContent = 'Saves the video, key frames and motion data';
}

document.querySelector('.actions').onclick = async (e) => {
  const run = e.target.closest('[data-run]')?.dataset.run;
  if (!run) return;
  let res;
  if (run === 'quick-screenshot') res = await send({ type: 'quickScreenshot', tabId: tab.id });
  if (run === 'start-picker') res = await send({ type: 'startPicker', tabId: tab.id });
  if (run === 'record-area') res = recording ? await send({ type: 'recStop' }) : await send({ type: 'startPicker', tabId: tab.id, mode: 'record' });
  if (res?.ok) window.close();
  else status(res?.error || 'That did not work on this page.', true);
};

$('#set-shortcut').onclick = (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
};

/* ---------- whole page with a note ---------- */

for (const c of CATEGORIES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = c;
  b.setAttribute('aria-pressed', 'false');
  b.onclick = () => b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
  $('#categories').appendChild(b);
}

$('#page-form').onsubmit = async (e) => {
  e.preventDefault();
  const btn = $('#save-page');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  const res = await send({
    type: 'savePage',
    tabId: tab.id,
    windowId: tab.windowId,
    fields: {
      note: $('#note').value.trim(),
      categories: [...document.querySelectorAll('.chip[aria-pressed="true"]')].map((b) => b.textContent),
      tags: $('#tags').value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
      board: $('#project').value,
    },
  });
  btn.disabled = false;
  btn.textContent = 'Save whole page';
  if (res?.ok) {
    status(`Saved to ${boards.find((b) => b.id === $('#project').value)?.name || 'project'} ✓`);
    $('#page-form').reset();
    document.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  } else {
    status(res?.error || 'Could not save this page.', true);
  }
};

await renderProjects();
