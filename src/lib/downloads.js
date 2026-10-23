// Default storage: files go into Downloads/Refboard/<Project>/… through the
// chrome.downloads API. No folder picker, no permission prompts, and Chrome can
// open the file in Explorer/Finder ("Show in folder"). Usable from the service
// worker and from extension pages (not from the offscreen document).

export const ROOT = 'Refboard';
export const downloadPath = (folder, rel) => `${ROOT}/${folder}/${rel}`;

function waitForDownload(id) {
  return new Promise((resolve) => {
    const done = (state) => {
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve(state);
    };
    const onChanged = (d) => {
      if (d.id === id && d.state && d.state.current !== 'in_progress') done(d.state.current);
    };
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads.search({ id }).then(([item]) => item && item.state !== 'in_progress' && done(item.state));
  });
}

// Hide Chrome's download bubble while Refboard writes a burst of files.
let quietCount = 0;
async function quietly(fn) {
  quietCount++;
  try {
    await chrome.downloads.setUiOptions({ enabled: false });
  } catch {
    /* downloads.ui not available: the bubble just shows */
  }
  try {
    return await fn();
  } finally {
    if (--quietCount === 0) setTimeout(() => quietCount === 0 && chrome.downloads.setUiOptions({ enabled: true }).catch(() => {}), 800);
  }
}

// files: [{ filename, url }] (url: blob: or data:) → { [filename]: downloadId }
export function downloadFiles(files) {
  return quietly(async () => {
    const ids = {};
    for (const f of files) {
      const id = await chrome.downloads.download({ url: f.url, filename: f.filename, conflictAction: 'overwrite', saveAs: false });
      const state = await waitForDownload(id);
      if (state !== 'complete') throw new Error(`Could not save ${f.filename}`);
      ids[f.filename] = id;
    }
    return ids;
  });
}

// Deletes files Refboard downloaded earlier (Chrome only allows this for its own downloads).
export async function removeDownloads(ids) {
  for (const id of Object.values(ids || {})) {
    await chrome.downloads.removeFile(id).catch(() => {});
    await chrome.downloads.erase({ id }).catch(() => {});
  }
}

// Opens Explorer/Finder at a file Refboard saved (or the Downloads folder).
export async function showInFolder(id) {
  if (id) {
    const [item] = await chrome.downloads.search({ id });
    if (item?.exists !== false && item?.state === 'complete') return chrome.downloads.show(id);
  }
  return chrome.downloads.showDefaultFolder();
}
