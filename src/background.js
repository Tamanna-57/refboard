import { listBoards, createBoard, getBoard, getPin, savePin, deletePin, uid, DEFAULT_BOARD } from './lib/db.js';

const BOARD_URL = chrome.runtime.getURL('src/board/board.html');
const OFFSCREEN_URL = 'src/offscreen/offscreen.html';
const THUMB_WIDTH = 520;
const MAX_RECORDING_MS = 60000;

/* ---------- images ---------- */

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type};base64,${btoa(binary)}`;
}

async function loadBitmap(dataUrl) {
  return createImageBitmap(await (await fetch(dataUrl)).blob());
}

// Crops a screenshot of the visible tab down to one element's rectangle.
async function crop(dataUrl, rect, viewport) {
  const bmp = await loadBitmap(dataUrl);
  const scale = bmp.width / viewport.width;
  const x = Math.max(0, rect.x) * scale;
  const y = Math.max(0, rect.y) * scale;
  const w = Math.min(rect.x + rect.width, viewport.width) * scale - x;
  const h = Math.min(rect.y + rect.height, viewport.height) * scale - y;
  if (w < 2 || h < 2) return dataUrl;
  const canvas = new OffscreenCanvas(Math.round(w), Math.round(h));
  canvas.getContext('2d').drawImage(bmp, x, y, w, h, 0, 0, canvas.width, canvas.height);
  return blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
}

async function thumbnail(dataUrl) {
  const bmp = await loadBitmap(dataUrl);
  const ratio = Math.min(1, THUMB_WIDTH / bmp.width);
  const canvas = new OffscreenCanvas(Math.round(bmp.width * ratio), Math.round(bmp.height * ratio));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return blobToDataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 }));
}

/* ---------- projects ---------- */

async function activeProjectId() {
  const { activeProjectId: id, lastBoardId } = await chrome.storage.local.get(['activeProjectId', 'lastBoardId']);
  const boards = await listBoards();
  return boards.find((b) => b.id === (id || lastBoardId))?.id || DEFAULT_BOARD.id;
}

async function resolveBoardId(value) {
  if (value?.startsWith('__new:')) {
    const board = await createBoard(value.slice(6));
    await chrome.storage.local.set({ activeProjectId: board.id });
    return board.id;
  }
  return value || activeProjectId();
}

/* ---------- offscreen document (recording + writing files) ---------- */

let creating = null;
async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length) return;
  creating ||= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: ['USER_MEDIA', 'BLOBS'],
      justification: 'Record the selected area of the tab and save captures into the folder you chose.',
    })
    .catch((err) => {
      if (!/single offscreen/i.test(String(err))) throw err;
    })
    .finally(() => (creating = null));
  await creating;
}

async function offscreen(msg) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ ...msg, target: 'offscreen' });
}

// Mirror a pin's files into its project folder (silently queued if the folder isn't connected).
function syncToFolder(id) {
  offscreen({ type: 'syncPin', id }).catch(() => {});
}

/* ---------- saving ---------- */

async function storePin(input) {
  const boardId = await resolveBoardId(input.board);
  const { board, ...rest } = input;
  const pin = {
    id: uid(),
    createdAt: Date.now(),
    categories: [],
    tags: [],
    note: '',
    designMd: null,
    ...rest,
    boardId,
    thumb: input.image ? await thumbnail(input.image) : null,
  };
  await savePin(pin);
  chrome.runtime.sendMessage({ type: 'pinsChanged' }).catch(() => {});
  syncToFolder(pin.id);
  return pin;
}

async function injectAnalyzer(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/analyze.js'] });
}

// After the extension is reloaded or updated, tabs that were already open keep
// the old version's globals and leftover UI, which blocked the new picker from
// starting. Clear all of that before every injection.
function resetPage() {
  try {
    window.__refboardTeardown?.();
  } catch {}
  document.querySelectorAll('refboard-picker, refboard-toast').forEach((n) => n.remove());
  window.__refboardPickerActive = false;
  delete window.__refboardTeardown;
  delete window.__refboardAnalyze;
}

async function startPicker(tabId, mode = 'save') {
  await chrome.scripting.executeScript({ target: { tabId }, func: resetPage });
  await injectAnalyzer(tabId);
  await chrome.scripting.executeScript({ target: { tabId }, func: (m) => (window.__refboardPickerMode = m), args: [mode] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/picker.js'] });
}

async function savePage(tabId, windowId, fields) {
  // Remove any open picker/panel first so it doesn't end up in the screenshot.
  await chrome.scripting.executeScript({ target: { tabId }, func: resetPage });
  await injectAnalyzer(tabId);
  const image = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const [{ result: data }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.__refboardAnalyze.page(),
  });
  return storePin({ ...data, ...fields, kind: 'page', title: fields.title || data.title, image });
}

// Ctrl/Cmd+Shift+S: save the visible screen straight into the active project.
async function quickScreenshot(tab) {
  const pin = await savePage(tab.id, tab.windowId, { source: 'shortcut' });
  const board = await getBoard(pin.boardId);
  await toast(tab.id, { text: `Screenshot saved to ${board.name}`, pinId: pin.id });
}

/* ---------- on-page toast after a shortcut capture ---------- */

function pageToast({ text, pinId, sub }) {
  document.querySelectorAll('refboard-toast').forEach((n) => n.remove());
  const host = document.createElement('refboard-toast');
  host.style.cssText = 'all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      * { box-sizing: border-box; font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; }
      .t { width: 320px; background: #0a0a0a; color: #fff; border-radius: 12px; padding: 12px 12px 12px 14px; box-shadow: 0 12px 32px rgba(0,0,0,.3); font-size: 13px; }
      .row { display: flex; align-items: center; gap: 8px; }
      b { flex: 1; font-weight: 600; }
      small { display: block; color: #a3a3a3; margin-top: 3px; }
      button { border: 0; background: #2a2a2a; color: #fff; border-radius: 7px; padding: 5px 9px; font-size: 12px; font-weight: 600; cursor: pointer; }
      button:hover { background: #3a3a3a; }
      input { width: 100%; margin-top: 10px; border: 1px solid #333; background: #141414; color: #fff; border-radius: 8px; padding: 8px 10px; font-size: 13px; outline: none; }
      input:focus { border-color: #fff; }
    </style>
    <div class="t"><div class="row"><b></b><button data-a="note">Add note</button><button data-a="undo">Undo</button></div><small></small></div>`;
  root.querySelector('b').textContent = text;
  root.querySelector('small').textContent = sub || 'Esc to dismiss';
  document.documentElement.appendChild(host);
  let timer = setTimeout(() => host.remove(), 6000);
  const keep = () => clearTimeout(timer);
  host.addEventListener('pointerenter', keep);
  for (const t of ['keydown', 'keyup', 'keypress']) host.addEventListener(t, (e) => e.stopPropagation());
  root.querySelector('[data-a="undo"]').onclick = async () => {
    keep();
    await chrome.runtime.sendMessage({ type: 'deletePin', id: pinId });
    root.querySelector('b').textContent = 'Removed';
    root.querySelectorAll('button').forEach((b) => b.remove());
    setTimeout(() => host.remove(), 1000);
  };
  root.querySelector('[data-a="note"]').onclick = () => {
    keep();
    if (root.querySelector('input')) return;
    const input = document.createElement('input');
    input.placeholder = 'What do you want to use from this? Enter to save';
    root.querySelector('.t').appendChild(input);
    input.focus();
    input.onkeydown = async (e) => {
      if (e.key === 'Escape') host.remove();
      if (e.key !== 'Enter') return;
      await chrome.runtime.sendMessage({ type: 'updatePin', id: pinId, patch: { note: input.value.trim() } });
      root.querySelector('small').textContent = 'Note saved';
      input.remove();
      timer = setTimeout(() => host.remove(), 1500);
    };
  };
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape' && !e.composedPath().includes(host)) {
      host.remove();
      document.removeEventListener('keydown', esc);
    }
  });
}

async function toast(tabId, opts) {
  await chrome.scripting.executeScript({ target: { tabId }, func: pageToast, args: [opts] }).catch(() => {});
}

/* ---------- recording ---------- */

const getRec = async () => (await chrome.storage.session.get('rec')).rec || null;

async function shortcutFor(name) {
  return (await chrome.commands.getAll()).find((c) => c.name === name)?.shortcut || '';
}

// Ctrl/Cmd+Shift+E: draw an area to record, or stop the running recording.
async function toggleRecording(tab) {
  const rec = await getRec();
  if (rec) return stopRecording();
  await startPicker(tab.id, 'record');
}

async function startRecording(msg, tab) {
  if (await getRec()) throw new Error('A recording is already running.');
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  // Measure the site's design system first, so the recording carries it too.
  const [{ result: data }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.__refboardAnalyze.page() });
  const boardId = await activeProjectId();
  const meta = {
    url: data.url, hostname: data.hostname, pageTitle: data.pageTitle, favicon: data.favicon, description: data.description,
    title: msg.title ? `Motion: ${msg.title}` : `Motion: ${data.hostname}`, site: data.site, analysis: data.analysis, boardId, source: 'shortcut',
  };
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/motion.js'] });
  const res = await offscreen({ type: 'recStart', streamId, rect: msg.rect, viewport: msg.viewport, meta, maxMs: MAX_RECORDING_MS });
  if (!res?.ok) throw new Error(res?.error || 'Could not start recording.');
  const shortcut = await shortcutFor('record-area');
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (rect, s) => window.__refboardMotion.start(rect, { shortcut: s }),
    args: [msg.rect, shortcut],
  });
  await chrome.storage.session.set({ rec: { tabId: tab.id, startedAt: Date.now() } });
  await chrome.action.setBadgeBackgroundColor({ color: '#ff3b30' });
  await chrome.action.setBadgeText({ text: 'REC' });
}

let stopping = null;
function stopRecording() {
  stopping ||= (async () => {
    const rec = await getRec();
    if (!rec) return;
    await chrome.storage.session.remove('rec');
    await chrome.action.setBadgeText({ text: '' });
    let motion = null;
    try {
      [{ result: motion }] = await chrome.scripting.executeScript({ target: { tabId: rec.tabId }, func: () => window.__refboardMotion?.stop() || null });
    } catch {
      /* tab closed or navigated away */
    }
    const res = await offscreen({ type: 'recStop', motion });
    if (!res?.ok) return toast(rec.tabId, { text: 'Recording failed', sub: res?.error });
    const pin = await getPin(res.id);
    const board = await getBoard(pin?.boardId);
    await toast(rec.tabId, {
      text: `Recording saved to ${board.name}`,
      pinId: res.id,
      sub: `${res.seconds}s · ${res.effects} effect${res.effects === 1 ? '' : 's'} measured${res.synced ? ' · written to folder' : ''}`,
    });
  })().finally(() => (stopping = null));
  return stopping;
}

/* ---------- messages ---------- */

const handlers = {
  async getBoards() {
    return { boards: await listBoards(), lastBoardId: await activeProjectId() };
  },
  async setActiveProject(msg) {
    await chrome.storage.local.set({ activeProjectId: await resolveBoardId(msg.id) });
    return { ok: true, id: await activeProjectId() };
  },
  async captureRect(msg, sender) {
    const shot = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
    return { image: await crop(shot, msg.rect, msg.viewport) };
  },
  async savePin(msg) {
    const pin = await storePin(msg.pin);
    return { ok: true, id: pin.id };
  },
  async updatePin(msg) {
    const pin = await getPin(msg.id);
    if (!pin) return { ok: false, error: 'Not found' };
    await savePin({ ...pin, ...msg.patch });
    chrome.runtime.sendMessage({ type: 'pinsChanged' }).catch(() => {});
    return { ok: true };
  },
  async deletePin(msg) {
    const pin = await getPin(msg.id);
    await deletePin(msg.id);
    if (pin?.files) offscreen({ type: 'removePinFiles', pin: { files: pin.files } }).catch(() => {});
    chrome.runtime.sendMessage({ type: 'pinsChanged' }).catch(() => {});
    return { ok: true };
  },
  async startPicker(msg) {
    await startPicker(msg.tabId, msg.mode);
    return { ok: true };
  },
  async savePage(msg) {
    const pin = await savePage(msg.tabId, msg.windowId, msg.fields);
    return { ok: true, id: pin.id };
  },
  async quickScreenshot(msg) {
    const tab = await chrome.tabs.get(msg.tabId);
    await quickScreenshot(tab);
    return { ok: true };
  },
  async recordRegion(msg, sender) {
    await startRecording(msg, sender.tab);
    return { ok: true };
  },
  async recStop() {
    await stopRecording();
    return { ok: true };
  },
  async recStatus() {
    return { recording: !!(await getRec()) };
  },
  async syncPin(msg) {
    return offscreen({ type: 'syncPin', id: msg.id });
  },
  async openBoard() {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
    const existing = contexts.find((c) => c.documentUrl?.startsWith(BOARD_URL));
    if (existing) {
      await chrome.tabs.update(existing.tabId, { active: true });
      await chrome.windows.update(existing.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url: BOARD_URL });
    }
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'offscreen') return false;
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler(msg, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: friendlyError(err) }));
  return true;
});

async function runShortcut(command, tab) {
  if (!tab?.id) return;
  try {
    if (command === 'start-picker') await startPicker(tab.id);
    if (command === 'quick-screenshot') await quickScreenshot(tab);
    if (command === 'record-area') await toggleRecording(tab);
  } catch (err) {
    console.warn(err);
    await toast(tab.id, { text: 'Refboard could not do that here', sub: friendlyError(err) });
  }
}

chrome.commands.onCommand.addListener(runShortcut);

// Right-click menu: works even without keyboard shortcuts, and grants activeTab.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'quick-screenshot', title: 'Save screenshot to Refboard', contexts: ['all'] });
    chrome.contextMenus.create({ id: 'start-picker', title: 'Pick a section to save in Refboard', contexts: ['all'] });
    chrome.contextMenus.create({ id: 'record-area', title: 'Record an area (Refboard)', contexts: ['all'] });
    chrome.contextMenus.create({ id: 'board', title: 'Open Refboard', contexts: ['all'] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'board') return handlers.openBoard();
  runShortcut(info.menuItemId, tab);
});

function friendlyError(err) {
  const text = String(err?.message || err);
  if (/cannot be scripted|chrome:\/\/|Cannot access|extensions gallery/i.test(text)) {
    return 'Chrome does not let extensions read this page (browser pages and the Web Store are blocked).';
  }
  if (/activeTab|not been invoked|Extension has not been invoked/i.test(text)) {
    return 'Use the shortcut, the toolbar icon or the right-click menu on this tab first.';
  }
  return text;
}
