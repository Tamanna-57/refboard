// Records a MediaStream (a captured tab) and picks key frames of one area.
//
// Smoothness: the video is encoded by Chrome's own MediaRecorder straight from
// the captured track, with no JavaScript touching individual frames, so it keeps
// the tab's real frame rate. Key frames are grabbed separately from a clone of
// the track every 150ms, cropped to the area the user drew; that work can never
// delay the video. Used by the offscreen document (needs a window context).

const GRAB_EVERY_MS = 150;
const MAX_KEY_FRAMES = 16;
const FRAME_WIDTH = 1280;

const even = (n) => Math.max(0, Math.floor(n / 2) * 2);

async function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}

// 16×16 grayscale fingerprint of one area of a frame, to measure how different two frames look.
function fingerprint(bitmap, crop) {
  const c = new OffscreenCanvas(16, 16);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, 16, 16);
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

async function cropToJpeg(bitmap, crop, width = FRAME_WIDTH) {
  const ratio = Math.min(1, width / crop.width);
  const c = new OffscreenCanvas(Math.round(crop.width * ratio), Math.round(crop.height * ratio));
  c.getContext('2d').drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, c.width, c.height);
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
}

// Grabs the latest frame of a track as an ImageBitmap (ImageCapture, or a
// MediaStreamTrackProcessor that keeps only the newest frame).
function frameGrabber(track) {
  if ('ImageCapture' in self) {
    const ic = new ImageCapture(track);
    return { grab: () => ic.grabFrame(), close: () => track.stop() };
  }
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  let latest = null;
  let open = true;
  (async () => {
    while (open) {
      const { value, done } = await reader.read();
      if (done) break;
      latest?.close();
      latest = value;
    }
  })();
  return {
    grab: async () => {
      if (!latest) throw new Error('no frame yet');
      return createImageBitmap(latest);
    },
    close: () => {
      open = false;
      latest?.close();
      reader.cancel().catch(() => {});
      track.stop();
    },
  };
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
  // H.264 (usually hardware-encoded) first, then VP8, which is much lighter than VP9.
  const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start(1000);
  const started = performance.now();

  const grabber = frameGrabber(track.clone());
  const candidates = [];
  let crop = null;
  let size = null;
  let videoSize = null;
  let lastKept = null;
  let busy = null;
  let stopped = false;

  const tick = () => {
    if (busy || stopped) return;
    busy = (async () => {
      const t = Math.round(performance.now() - started);
      const bmp = await grabber.grab();
      try {
        if (!crop) {
          const sx = bmp.width / viewport.width;
          const sy = bmp.height / viewport.height;
          const x = Math.max(0, Math.round(rect.x * sx));
          const y = Math.max(0, Math.round(rect.y * sy));
          crop = { x, y, width: Math.max(2, Math.min(bmp.width - x, Math.round(rect.width * sx))), height: Math.max(2, Math.min(bmp.height - y, Math.round(rect.height * sy))) };
          size = { width: crop.width, height: crop.height };
          videoSize = { width: bmp.width, height: bmp.height };
        }
        const fp = fingerprint(bmp, crop);
        const diff = lastKept ? difference(fp, lastKept.fp) : 255;
        // Keep a frame when the area looks different, or at least every 0.8s.
        if (!lastKept || diff > 2 || t - lastKept.t >= 800) {
          // Encode in the background so the next grab isn't delayed.
          const c = { t, diff, fp, blob: cropToJpeg(bmp, crop).finally(() => bmp.close()) };
          candidates.push(c);
          lastKept = c;
          if (candidates.length > 120) candidates.splice(1 + Math.floor(Math.random() * 118), 1);
        } else bmp.close();
      } catch (err) {
        bmp.close();
        throw err;
      }
    })()
      .catch(() => {})
      .finally(() => (busy = null));
  };
  const timer = setInterval(tick, GRAB_EVERY_MS);
  tick();
  const limit = setTimeout(() => onLimit?.(), maxMs);

  return {
    mime,
    async stop() {
      clearTimeout(limit);
      clearInterval(timer);
      tick(); // one last frame
      await busy;
      stopped = true;
      const duration = Math.round(performance.now() - started);
      const done = new Promise((r) => (recorder.onstop = r));
      if (recorder.state !== 'inactive') recorder.stop();
      await done;
      grabber.close();
      stream.getTracks().forEach((t) => t.stop());
      const keys = pickKeyFrames(candidates);
      const frames = await Promise.all(keys.map(async (k) => {
        const blob = await k.blob;
        return { t: k.t, blob, image: await blobToDataUrl(blob) };
      }));
      const sheet = frames.length ? await contactSheet(frames) : null;
      return {
        video: new Blob(chunks, { type: mime.split(';')[0] }),
        videoType: mime.split(';')[0],
        duration,
        size,
        videoSize,
        frames: frames.map(({ t, image }) => ({ t, image })),
        contactSheet: sheet ? await blobToDataUrl(sheet) : null,
      };
    },
  };
}
