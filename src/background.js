import { listBoards, createBoard, savePin, deletePin, uid, DEFAULT_BOARD } from './lib/db.js';

const BOARD_URL = chrome.runtime.getURL('src/board/board.html');
const THUMB_WIDTH = 520;

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

async function resolveBoardId(value) {
  if (value?.startsWith('__new:')) return (await createBoard(value.slice(6))).id;
  return value || DEFAULT_BOARD.id;
}

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
  await chrome.storage.local.set({ lastBoardId: boardId });
  chrome.runtime.sendMessage({ type: 'pinsChanged' }).catch(() => {});
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
  document.querySelectorAll('refboard-picker').forEach((n) => n.remove());
  window.__refboardPickerActive = false;
  delete window.__refboardTeardown;
  delete window.__refboardAnalyze;
}

async function startPicker(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, func: resetPage });
  await injectAnalyzer(tabId);
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/picker.js'] });
}

async function savePage(tabId, windowId, fields) {
  await injectAnalyzer(tabId);
  const [{ result: data }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.__refboardAnalyze.page(),
  });
  const image = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  return storePin({ ...data, ...fields, kind: 'page', title: fields.title || data.title, image });
}

const handlers = {
  async getBoards() {
    const { lastBoardId } = await chrome.storage.local.get('lastBoardId');
    return { boards: await listBoards(), lastBoardId };
  },
  async captureRect(msg, sender) {
    const shot = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
    return { image: await crop(shot, msg.rect, msg.viewport) };
  },
  async savePin(msg) {
    const pin = await storePin(msg.pin);
    return { ok: true, id: pin.id };
  },
  async deletePin(msg) {
    await deletePin(msg.id);
    chrome.runtime.sendMessage({ type: 'pinsChanged' }).catch(() => {});
    return { ok: true };
  },
  async startPicker(msg) {
    await startPicker(msg.tabId);
    return { ok: true };
  },
  async savePage(msg) {
    const pin = await savePage(msg.tabId, msg.windowId, msg.fields);
    return { ok: true, id: pin.id };
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
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler(msg, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: friendlyError(err) }));
  return true;
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'start-picker' && tab?.id) startPicker(tab.id).catch(console.warn);
});

// Right-click menu: a second way to start the picker that never clashes with
// keyboard shortcuts. Clicking it also grants activeTab for the page.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'pick', title: 'Pick a section to save in Refboard', contexts: ['all'] });
    chrome.contextMenus.create({ id: 'board', title: 'Open Refboard', contexts: ['all'] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'pick' && tab?.id) startPicker(tab.id).catch(console.warn);
  if (info.menuItemId === 'board') handlers.openBoard();
});

function friendlyError(err) {
  const text = String(err?.message || err);
  if (/cannot be scripted|chrome:\/\/|Cannot access|extensions gallery/i.test(text)) {
    return 'Chrome does not let extensions read this page (browser pages and the Web Store are blocked).';
  }
  return text;
}
