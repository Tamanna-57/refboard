import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, buildDesignMd, consolidate, imageFiles, slug } from '../src/lib/generate.js';
import { createZip, crc32 } from '../src/lib/zip.js';

const nav = {
  id: 'a',
  kind: 'element',
  title: 'Navigation: Linear',
  hostname: 'linear.app',
  url: 'https://linear.app/',
  note: 'Sticky nav that shrinks into a pill on scroll',
  categories: ['Component', 'Animation'],
  tags: ['saas'],
  image: 'data:image/png;base64,iVBORw0KGgo=',
  analysis: {
    selector: 'header > nav.main',
    size: { width: 1200, height: 64 },
    keyStyles: { 'border-radius': '9999px', 'backdrop-filter': 'blur(12px)' },
    palette: [
      { hex: '#ffffff', weight: 40, roles: ['background'] },
      { hex: '#5e6ad2', weight: 5, roles: ['background'] },
      { hex: '#1b1b1f', weight: 10, roles: ['text'] },
    ],
    fonts: [{ family: 'Inter', stack: 'Inter, sans-serif', weights: ['400', '600'], count: 12 }],
    typeScale: [{ family: 'Inter', size: '14px', weight: '500', lineHeight: '20px', letterSpacing: 'normal', count: 8, tags: ['a'] }],
    radii: ['9999px'],
    shadows: ['rgba(0, 0, 0, 0.1) 0px 1px 2px 0px'],
    spacing: ['8px', '16px'],
    transitions: ['all 0.2s ease-out'],
    cssVars: { '--brand': '#5e6ad2' },
    html: '<nav class="main"><a href="/">Home</a></nav>',
  },
};

const page = {
  id: 'b',
  kind: 'page',
  title: 'Stripe',
  hostname: 'stripe.com',
  url: 'https://stripe.com/',
  note: 'Typography and the big gradient hero',
  categories: ['Typography'],
  tags: [],
  image: null,
  designMd: { name: 'DESIGN.md', text: '# Stripe design\n\n## Colors\n- primary #635bff' },
  analysis: {
    palette: [{ hex: '#635bff', weight: 20, roles: ['background'] }],
    fonts: [{ family: 'Sohne', stack: 'sohne-var, sans-serif', weights: ['300', '500'], count: 30 }],
    typeScale: [{ family: 'Sohne', size: '56px', weight: '500', lineHeight: '64px', letterSpacing: '-1px', count: 2, tags: ['h1'] }],
    radii: [],
    shadows: [],
    spacing: ['24px'],
    transitions: [],
    cssVars: {},
    keyStyles: {},
  },
};

test('typography comes only from pins tagged Typography', () => {
  const t = consolidate([nav, page]);
  assert.deepEqual(t.fonts.items.map((f) => f.family), ['Sohne']);
  assert.equal(t.fonts.src.tagged, true);
  // no pin is tagged Color, so colors merge from every pin
  assert.equal(t.colors.src.tagged, false);
  assert.ok(t.colors.items.some((c) => c.hex === '#635bff' && c.role === 'accent'));
});

test('prompt includes notes, screenshot paths, styles and attached DESIGN.md', () => {
  const out = buildPrompt([nav, page], { project: 'Acme', includeHtml: true, includeDesignMd: true });
  assert.match(out, /# Design references for Acme/);
  assert.match(out, /Sticky nav that shrinks into a pill on scroll/);
  assert.match(out, /refs\/01-linear-app-navigation-linear\.png/);
  assert.match(out, /backdrop-filter \| `blur\(12px\)`/);
  assert.match(out, /<nav class="main">/);
  assert.match(out, /primary #635bff/);
  assert.match(out, /Do not copy logos/);
});

test('optional sections can be turned off', () => {
  const out = buildPrompt([nav, page], { includeHtml: false, includeDesignMd: false });
  assert.doesNotMatch(out, /<nav class="main">/);
  assert.doesNotMatch(out, /# Stripe design/);
});

test('DESIGN.md has tokens, CSS variables and components', () => {
  const out = buildDesignMd([nav, page], { project: 'Acme', date: '2026-10-20' });
  assert.match(out, /# Acme — Design System/);
  assert.match(out, /--color-accent-1: #/);
  assert.match(out, /--font-primary: sohne-var, sans-serif;/);
  assert.match(out, /### Navigation: Linear/);
});

test('only pins with screenshots produce image files', () => {
  assert.deepEqual(imageFiles([nav, page]).map((f) => f.name), ['refs/01-linear-app-navigation-linear.png']);
  assert.equal(slug('  Hello, World!! '), 'hello-world');
});

test('zip writer produces a valid archive', () => {
  assert.equal(crc32(new TextEncoder().encode('hello')), 0x3610a686);
  const zip = createZip([{ name: 'a/PROMPT.md', data: '# hi' }, { name: 'a/b.bin', data: new Uint8Array([1, 2, 3]) }]);
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(zip.length - 12, true), 2);
});
