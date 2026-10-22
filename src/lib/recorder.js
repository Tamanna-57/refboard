// Records a MediaStream (a captured tab) cropped to one rectangle of the page,
// and picks the key frames where something visibly changed. Used by the
// offscreen document. Needs a window context (MediaStreamTrackProcessor).

const CANDIDATE_EVERY_MS = 200;
const MAX_KEY_FRAMES = 12;
const FRAME_WIDTH = 960;

const even = (n) => Math.max(0, Math.floor(n / 2) * 2);

async function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}

// 16×16 grayscale fingerprint, to measure how different two frames look.
function fingerprint(bitmap) {
  const c = new OffscreenCanvas(16, 16);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, 16, 16);
  const d = ctx.getImageData(0, 0, 16, 16).data;
  const out = new Uint8Array(256);
  for (let i = 0; i < 256; i++) out[i] = (d[i * 4] * 3 + d[i * 4 + 1] * 6 + d[i * 4 + 2]) / 10;
  return out;
}

const difference = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
};

async function toJpeg(bitmap, width = FRAME_WIDTH) {
  const ratio = Math.min(1, width / bitmap.width);
  const c = new OffscreenCanvas(Math.round(bitmap.width * ratio), Math.round(bitmap.height * ratio));
  c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}

export function pickKeyFrames(candidates, max = MAX_KEY_FRAMES) {
  if (candidates.length <= max) return candidates;
  const first = candidates[0];
  const last = candidates[candidates.length - 1];
  const middle = candidates.slice(1, -1).sort((a, b) => b.diff - a.diff).slice(0, max - 2);
  return [first, ...middle.sort((a, b) => a.t - b.t), last];
}

export async function contactSheet(frames) {
  const bitmaps = await Promise.all(frames.map((f) => createImageBitmap(f.blob)));
  const cols = frames.length <= 4 ? frames.length : frames.length <= 9 ? 3 : 4;
  const rows = Math.ceil(frames.length / cols);
  const cellW = 480;
  const cellH = Math.round(cellW * (bitmaps[0].height / bitmaps[0].width));
  const gap = 8;
  const c = new OffscreenCanvas(cols * cellW + (cols + 1) * gap, rows * cellH + (rows + 1) * gap);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  bitmaps.forEach((bmp, i) => {
    const x = gap + (i % cols) * (cellW + gap);
    const y = gap + Math.floor(i / cols) * (cellH + gap);
    ctx.drawImage(bmp, x, y, cellW, cellH);
    const label = `${i + 1} · ${(frames[i].t / 1000).toFixed(1)}s`;
    ctx.font = '600 15px system-ui, sans-serif';
    const w = ctx.measureText(label).width + 16;
    ctx.fillStyle = 'rgba(10,10,10,.85)';
    ctx.beginPath();
    ctx.roundRect(x + 8, y + 8, w, 24, 12);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 16, y + 25);
  });
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}

export function startRecording(stream, rect, viewport, { maxMs = 60000, onLimit } = {}) {
  const [track] = stream.getVideoTracks();
  const processor = new MediaStreamTrackProcessor({ track });
  const generator = new MediaStreamTrackGenerator({ kind: 'video' });
  const reader = processor.readable.getReader();
  const writer = generator.writable.getWriter();
  const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(new MediaStream([generator]), { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const candidates = [];
  let crop = null;
  let firstTs = null;
  let lastCandidate = -Infinity;
  let lastKept = null;
  let stopped = false;
  let lastT = 0;
  let size = null;

  const limit = setTimeout(() => onLimit?.(), maxMs);

  const pump = (async () => {
    while (!stopped) {
      const { value: frame, done } = await reader.read();
      if (done || !frame) break;
      if (stopped) {
        frame.close();
        break;
      }
      if (!crop) {
        const vr = frame.visibleRect || { x: 0, y: 0, width: frame.displayWidth, height: frame.displayHeight };
        const sx = vr.width / viewport.width;
        const sy = vr.height / viewport.height;
        const x = even(vr.x + Math.max(0, rect.x) * sx);
        const y = even(vr.y + Math.max(0, rect.y) * sy);
        const w = even(Math.min(vr.x + vr.width - x, Math.min(rect.width, viewport.width - Math.max(0, rect.x)) * sx));
        const h = even(Math.min(vr.y + vr.height - y, Math.min(rect.height, viewport.height - Math.max(0, rect.y)) * sy));
        crop = { x, y, width: Math.max(2, w), height: Math.max(2, h) };
        size = { width: crop.width, height: crop.height };
      }
      firstTs ??= frame.timestamp;
      const t = Math.round((frame.timestamp - firstTs) / 1000);
      lastT = t;
      let cropped;
      try {
        cropped = new VideoFrame(frame, { visibleRect: crop, displayWidth: crop.width, displayHeight: crop.height, timestamp: frame.timestamp });
      } catch {
        cropped = frame.clone();
      }
      frame.close();
      if (t - lastCandidate >= CANDIDATE_EVERY_MS) {
        lastCandidate = t;
        const bmp = await createImageBitmap(cropped);
        const fp = fingerprint(bmp);
        const diff = lastKept ? difference(fp, lastKept.fp) : 255;
        // Keep a frame when it looks different, or at least every second.
        if (!lastKept || diff > 2.5 || t - lastKept.t >= 1000) {
          const c = { t, diff, fp, blob: await toJpeg(bmp) };
          candidates.push(c);
          lastKept = c;
          if (candidates.length > 80) candidates.splice(1 + Math.floor(Math.random() * 78), 1);
        }
        bmp.close();
      }
      await writer.write(cropped);
    }
  })();

  recorder.start(500);

  return {
    mime,
    async stop() {
      clearTimeout(limit);
      stopped = true;
      const done = new Promise((r) => (recorder.onstop = r));
      if (recorder.state !== 'inactive') recorder.stop();
      await done;
      track.stop();
      await reader.cancel().catch(() => {});
      await pump.catch(() => {});
      await writer.close().catch(() => {});
      const keys = pickKeyFrames(candidates);
      const frames = await Promise.all(keys.map(async (k) => ({ t: k.t, blob: k.blob, image: await blobToDataUrl(k.blob) })));
      const sheet = frames.length ? await contactSheet(frames) : null;
      return {
        video: new Blob(chunks, { type: mime.split(';')[0] }),
        videoType: mime.split(';')[0],
        duration: lastT,
        size,
        frames: frames.map(({ t, image }) => ({ t, image })),
        contactSheet: sheet ? await blobToDataUrl(sheet) : null,
      };
    },
  };
}
