import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildProjectFiles } from '../src/lib/project-docs.js';
import { analyzeMotion } from '../src/lib/motion.js';
import { revealMotion } from './motion.test.js';

const site = JSON.parse(fs.readFileSync(new URL('./fixtures/site-system.json', import.meta.url)));
const analysis = JSON.parse(fs.readFileSync(new URL('./fixtures/page-analysis.json', import.meta.url)));
const board = { id: 'b1', name: 'Tape Shop', folder: 'Tape Shop', createdAt: 1 };
const t0 = Date.UTC(2026, 9, 22, 10, 0, 0);
const base = { hostname: 'tapeco.test', url: 'https://tapeco.test/', pageTitle: 'TapeCo — Stick By You', boardId: 'b1', tags: [], site };

export const pins = [
  { ...base, id: 'a', kind: 'page', createdAt: t0, title: 'TapeCo home', note: 'Loud lime brand, chunky uppercase headings', categories: ['Color', 'Typography'], image: 'data:image/png;base64,AA', analysis },
  { ...base, id: 'b', kind: 'element', createdAt: t0 + 1000, title: 'Card: Masking tape', note: 'Card with badge and ghost button', categories: ['Component'], image: 'data:image/png;base64,AA',
    analysis: { ...analysis, selector: 'div.grid > div.card', size: { width: 363, height: 234 }, keyStyles: { display: 'block', padding: '32px', 'background-color': 'rgb(255, 255, 255)', 'border-radius': '24px', 'box-shadow': 'rgba(1,57,0,.08) 0px 12px 32px 0px' } } },
  { ...base, id: 'c', kind: 'recording', createdAt: t0 + 2000, title: 'Motion: Card reveal', note: 'Cards should rise in one by one on scroll', categories: ['Animation'],
    videoType: 'video/webm', video: {}, duration: 3200, region: { width: 1200, height: 700 }, frames: [{ t: 0, image: 'x' }, { t: 600, image: 'x' }, { t: 1200, image: 'x' }], contactSheet: 'x',
    motion: revealMotion, motionAnalysis: analyzeMotion(revealMotion) },
];

const files = Object.fromEntries(buildProjectFiles(board, pins, { date: t0 }).map((f) => [f.name, f.data]));

test('writes the full set of files', () => {
  assert.deepEqual(Object.keys(files), ['SKILL.md', 'DESIGN.md', 'PROMPT.md', 'references.md', 'tokens.css', 'tokens.json', 'tailwind.theme.js', 'refboard.json', 'sites/tapeco-test.DESIGN.md']);
});

test('DESIGN.md has every section with real values', () => {
  const md = files['DESIGN.md'];
  for (const h of ['## 1. Visual direction', '## 2. Color', '### Contrast pairings', '## 3. Typography', '### Text styles', '## 4. Spacing & layout', '## 5. Shape & elevation', '## 6. Components', '### Button', '#### Primary button', ':hover', '### Patterns you picked', '## 7. Motion & interaction', '### Motion tokens', '### Recorded effects', '## 8. Do’s and don’ts', '## 9. Implementation']) {
    assert.ok(md.includes(h), `missing ${h}`);
  }
  assert.match(md, /`--color-primary` \| `#b6fe00`/);
  assert.match(md, /Base unit:\*\* 4px/);
  assert.match(md, /frames\/2026-10-22_\d{6}_tapeco-test_motion-card-reveal\/contact-sheet\.jpg/);
  assert.match(md, /when it scrolls into view \| .*fades in/);
  assert.match(md, /@keyframes scroll-x/);
});

test('SKILL.md is a valid Claude Code skill pointing at the folder', () => {
  const s = files['SKILL.md'];
  assert.match(s, /^---\nname: tape-shop-design\ndescription: Design system and visual references for Tape Shop/);
  assert.match(s, /contact-sheet\.jpg/);
  assert.match(s, /## Before you finish/);
});

test('tokens are consistent across css, json and tailwind', () => {
  assert.match(files['tokens.css'], /--color-primary: #b6fe00;/);
  assert.match(files['tokens.css'], /--duration-\w+: 600ms;/);
  assert.match(files['tokens.css'], /--font-display: Impact/);
  const json = JSON.parse(files['tokens.json']);
  assert.equal(json.color.primary.$value, '#b6fe00');
  assert.match(files['tailwind.theme.js'], /"primary": "var\(--color-primary\)"/);
});

test('restore file keeps metadata and file paths but no media', () => {
  const r = JSON.parse(files['refboard.json']);
  assert.equal(r.pins.length, 3);
  assert.equal(r.pins[0].image, undefined);
  assert.match(r.pins[0].files.screenshot, /^screenshots\/.*\.png$/);
  assert.match(r.pins[2].files.video, /^recordings\/.*\.webm$/);
});
