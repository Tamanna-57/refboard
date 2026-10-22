// Where each capture lives inside its project folder. Pure functions.
//
//   <Project>/
//     screenshots/2026-10-22_1530_sweet-tape-com_hero.png
//     recordings/2026-10-22_1531_sweet-tape-com_card-hover.webm
//     frames/2026-10-22_1531_sweet-tape-com_card-hover/frame-01.jpg … contact-sheet.jpg

export function slug(text, max = 32) {
  return (
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/, '') || 'ref'
  );
}

const pad = (n) => String(n).padStart(2, '0');

export function stamp(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function baseName(pin) {
  return `${stamp(pin.createdAt)}_${slug(pin.hostname, 24)}_${slug(pin.title, 28)}`;
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'video/webm': 'webm', 'video/mp4': 'mp4' };
export const extFor = (mime) => EXT[String(mime).split(';')[0]] || 'bin';

// The relative paths a pin's files should have (empty for files it doesn't have).
export function pinPaths(pin) {
  const base = baseName(pin);
  const out = {};
  if (pin.kind === 'recording') {
    if (pin.video || pin.videoType) out.video = `recordings/${base}.${extFor(pin.videoType || 'video/webm')}`;
    out.frames = (pin.frames || []).map((_, i) => `frames/${base}/frame-${pad(i + 1)}.jpg`);
    if (pin.contactSheet) out.contactSheet = `frames/${base}/contact-sheet.jpg`;
  } else if (pin.image) {
    out.screenshot = `screenshots/${base}.png`;
  }
  return out;
}
