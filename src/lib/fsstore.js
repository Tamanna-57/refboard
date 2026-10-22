// Writes captures into the folder the user picked, using the File System Access
// API. The folder handle is kept in IndexedDB. Chrome remembers the permission
// for the session; after a browser restart it may need one click to re-allow
// (requestPermission needs a user gesture, so only visible pages can do that).
//
// Works in any window context of the extension (board page, offscreen document).

import { getSetting, setSetting, getPin, savePin, getBoard } from './db.js';
import { pinPaths } from './paths.js';

const ROOT_KEY = 'rootFolder';

export const getRoot = () => getSetting(ROOT_KEY);

export async function setRoot(handle) {
  await setSetting(ROOT_KEY, handle);
}

// 'none' | 'granted' | 'prompt' | 'denied'
export async function folderStatus() {
  const root = await getRoot();
  if (!root) return { state: 'none' };
  try {
    return { state: await root.queryPermission({ mode: 'readwrite' }), name: root.name };
  } catch {
    return { state: 'prompt', name: root.name };
  }
}

// Call from a click handler on a visible page.
export async function requestAccess() {
  const root = await getRoot();
  if (!root) return 'none';
  return root.requestPermission({ mode: 'readwrite' });
}

async function writableRoot() {
  const root = await getRoot();
  if (!root) return null;
  return (await root.queryPermission({ mode: 'readwrite' })) === 'granted' ? root : null;
}

async function dirAt(root, parts) {
  let dir = root;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
  return dir;
}

export async function writeFile(root, relPath, data) {
  const parts = relPath.split('/');
  const name = parts.pop();
  const dir = await dirAt(root, parts);
  const file = await dir.getFileHandle(name, { create: true });
  const w = await file.createWritable();
  await w.write(data);
  await w.close();
}

export async function readText(root, relPath) {
  const parts = relPath.split('/');
  const name = parts.pop();
  let dir = root;
  for (const p of parts) dir = await dir.getDirectoryHandle(p);
  return (await (await dir.getFileHandle(name)).getFile()).text();
}

async function removeEntry(root, relPath) {
  const parts = relPath.split('/');
  const name = parts.pop();
  try {
    let dir = root;
    for (const p of parts) dir = await dir.getDirectoryHandle(p);
    await dir.removeEntry(name, { recursive: true });
  } catch {
    /* already gone */
  }
}

const dataUrlBlob = async (url) => (await fetch(url)).blob();

export async function projectDir(root, board) {
  return dirAt(root, [board.folder]);
}

// Writes one pin's media (screenshot / video / frames) into its project folder.
// Returns true when written, false when the folder isn't connected right now.
export async function syncPin(id) {
  const root = await writableRoot();
  const pin = await getPin(id);
  if (!pin) return false;
  if (!root) {
    if (pin.synced !== false) await savePin({ ...pin, synced: false });
    return false;
  }
  const board = await getBoard(pin.boardId);
  const dir = await projectDir(root, board);
  // Moved to another project? Remove the old copies first.
  if (pin.files?.folder && pin.files.folder !== board.folder) await removePinFiles(pin);
  const paths = pinPaths(pin);
  if (paths.screenshot) await writeFile(dir, paths.screenshot, await dataUrlBlob(pin.image));
  if (paths.video && pin.video) await writeFile(dir, paths.video, pin.video);
  for (let i = 0; i < (paths.frames || []).length; i++) await writeFile(dir, paths.frames[i], await dataUrlBlob(pin.frames[i].image));
  if (paths.contactSheet) await writeFile(dir, paths.contactSheet, await dataUrlBlob(pin.contactSheet));
  await savePin({ ...pin, files: { ...paths, folder: board.folder }, synced: true });
  return true;
}

export async function removePinFiles(pin) {
  const root = await writableRoot();
  if (!root || !pin.files?.folder) return;
  let dir;
  try {
    dir = await root.getDirectoryHandle(pin.files.folder);
  } catch {
    return;
  }
  for (const rel of [pin.files.screenshot, pin.files.video, pin.files.contactSheet].filter(Boolean)) await removeEntry(dir, rel);
  if (pin.files.frames?.length) await removeEntry(dir, pin.files.frames[0].split('/').slice(0, 2).join('/'));
}

// Writes a set of generated files ({ name, data }) into a project folder.
export async function writeProjectFiles(board, files) {
  const root = await writableRoot();
  if (!root) throw new Error('The Refboard folder is not connected.');
  const dir = await projectDir(root, board);
  for (const f of files) await writeFile(dir, f.name, f.data);
  return `${root.name}/${board.folder}`;
}
