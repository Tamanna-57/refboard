// IndexedDB storage shared by the background worker, popup, board page and the
// offscreen document. All extension pages share one origin, so they all see the
// same database. In the UI, a "board" is called a project: each one maps to a
// subfolder (board.folder) inside the folder the user picked.

const DB_NAME = 'refboard';
const DB_VERSION = 2;

export const DEFAULT_BOARD = { id: 'inbox', name: 'Inbox', folder: 'Inbox', createdAt: 0 };

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('pins')) {
          const pins = db.createObjectStore('pins', { keyPath: 'id' });
          pins.createIndex('boardId', 'boardId');
          pins.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('boards')) {
          db.createObjectStore('boards', { keyPath: 'id' }).put(DEFAULT_BOARD);
        }
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function listPins() {
  const pins = await tx('pins', 'readonly', (s) => s.getAll());
  return pins.sort((a, b) => b.createdAt - a.createdAt);
}

export const getPin = (id) => tx('pins', 'readonly', (s) => s.get(id));

export function savePin(pin) {
  pin.updatedAt = Date.now();
  return tx('pins', 'readwrite', (s) => s.put(pin)).then(() => pin);
}

export const deletePin = (id) => tx('pins', 'readwrite', (s) => s.delete(id));

// Folder-safe name for a project, unique among existing projects.
export function folderName(name, taken = []) {
  const base = String(name || 'Untitled').replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 60) || 'Untitled';
  let folder = base;
  for (let n = 2; taken.some((t) => t.toLowerCase() === folder.toLowerCase()); n++) folder = `${base} ${n}`;
  return folder;
}

export async function listBoards() {
  const boards = await tx('boards', 'readonly', (s) => s.getAll());
  if (!boards.some((b) => b.id === DEFAULT_BOARD.id)) boards.unshift(DEFAULT_BOARD);
  // Projects created before folders existed get one from their name.
  const taken = [];
  for (const b of boards.sort((a, c) => a.createdAt - c.createdAt)) {
    if (!b.folder) b.folder = folderName(b.name, taken);
    taken.push(b.folder);
  }
  return boards;
}

export async function getBoard(id) {
  return (await listBoards()).find((b) => b.id === id) || DEFAULT_BOARD;
}

export async function createBoard(name) {
  const taken = (await listBoards()).map((b) => b.folder);
  const board = { id: uid(), name: name.trim() || 'Untitled', createdAt: Date.now() };
  board.folder = folderName(board.name, taken);
  await tx('boards', 'readwrite', (s) => s.put(board));
  return board;
}

export const renameBoard = (board, name) =>
  tx('boards', 'readwrite', (s) => s.put({ ...board, name: name.trim() || board.name }));

// Deleting a board moves its pins to the Inbox rather than deleting them.
export async function deleteBoard(id) {
  if (id === DEFAULT_BOARD.id) return;
  const pins = (await listPins()).filter((p) => p.boardId === id);
  for (const pin of pins) await savePin({ ...pin, boardId: DEFAULT_BOARD.id });
  await tx('boards', 'readwrite', (s) => s.delete(id));
}

export const getSetting = (key) => tx('settings', 'readonly', (s) => s.get(key));
export const setSetting = (key, value) => tx('settings', 'readwrite', (s) => s.put(value, key));

// Videos are Blobs and live in the project folder, so the JSON backup skips them.
export async function exportAll() {
  const pins = (await listPins()).map(({ video, ...p }) => p);
  return { app: 'refboard', version: 2, exportedAt: new Date().toISOString(), boards: await listBoards(), pins };
}

export async function importAll(data) {
  if (data?.app !== 'refboard') throw new Error('Not a Refboard backup file');
  for (const board of data.boards || []) await tx('boards', 'readwrite', (s) => s.put(board));
  for (const pin of data.pins || []) await tx('pins', 'readwrite', (s) => s.put(pin));
  return (data.pins || []).length;
}
