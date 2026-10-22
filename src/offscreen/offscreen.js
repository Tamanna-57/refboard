// Hidden offscreen document. The service worker can't record video or use the
// File System Access API reliably, so it hands that work to this page.

import { savePin, uid } from '../lib/db.js';
import { syncPin, removePinFiles } from '../lib/fsstore.js';
import { startRecording } from '../lib/recorder.js';
import { analyzeMotion } from '../lib/motion.js';

let session = null; // { recording, meta }

async function thumbnail(dataUrl, width = 520) {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const ratio = Math.min(1, width / bmp.width);
  const c = new OffscreenCanvas(Math.round(bmp.width * ratio), Math.round(bmp.height * ratio));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
  return new Promise((r) => {
    const fr = new FileReader();
    fr.onload = () => r(fr.result);
    fr.readAsDataURL(blob);
  });
}

const handlers = {
  async recStart({ streamId, rect, viewport, meta, maxMs }) {
    if (session) throw new Error('A recording is already running.');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId, maxWidth: 3840, maxHeight: 2160, maxFrameRate: 30 } },
    });
    const recording = startRecording(stream, rect, viewport, {
      maxMs,
      onLimit: () => chrome.runtime.sendMessage({ type: 'recStop', reason: 'limit' }),
    });
    session = { recording, meta, rect };
    return { ok: true };
  },

  async recStop({ motion, note }) {
    if (!session) throw new Error('No recording is running.');
    const { recording, meta, rect } = session;
    session = null;
    const result = await recording.stop();
    const analysis = analyzeMotion(motion);
    const pin = {
      id: uid(),
      createdAt: Date.now(),
      kind: 'recording',
      ...meta,
      note: note || '',
      categories: ['Animation'],
      tags: [],
      designMd: null,
      image: null,
      thumb: result.contactSheet ? await thumbnail(result.contactSheet) : null,
      video: result.video,
      videoType: result.videoType,
      duration: result.duration,
      frames: result.frames,
      contactSheet: result.contactSheet,
      region: { ...rect, ...result.size },
      motion,
      motionAnalysis: analysis,
    };
    await savePin(pin);
    const synced = await syncPin(pin.id).catch(() => false);
    chrome.runtime.sendMessage({ type: 'pinsChanged' }).catch(() => {});
    return { ok: true, id: pin.id, synced, effects: analysis.effects.length, seconds: Math.round(result.duration / 100) / 10 };
  },

  async recActive() {
    return { active: !!session };
  },

  async syncPin({ id }) {
    return { ok: true, synced: await syncPin(id) };
  },

  async removePinFiles({ pin }) {
    await removePinFiles(pin);
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  const handler = handlers[msg.type];
  if (!handler) return false;
  handler(msg)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});
