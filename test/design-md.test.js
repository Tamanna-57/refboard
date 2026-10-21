import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSiteDesignMd, siteSummary, contrast, compactSystem } from '../src/lib/design-md.js';
import { bundleFiles, buildPrompt } from '../src/lib/generate.js';

// Design system measured by analyze.js on a brand-style test page.
const site = JSON.parse(fs.readFileSync(new URL('./fixtures/site-system.json', import.meta.url)));
const pin = {
  id: 'p1', kind: 'page', title: 'TapeCo', pageTitle: 'TapeCo — Stick By You', hostname: 'tapeco.test', url: 'https://tapeco.test/',
  note: 'Bold lime brand and chunky uppercase headings', categories: ['Color', 'Typography'], tags: [], createdAt: Date.UTC(2026, 9, 21),
  image: null, site, analysis: { palette: site.colors.map((c) => ({ hex: c.hex, weight: c.weight, roles: ['background'], role: c.role })), fonts: [], typeScale: [], radii: [], shadows: [], spacing: [], transitions: [] },
};

test('contrast ratio', () => {
  assert.equal(contrast('#ffffff', '#000000'), 21);
});

test('site DESIGN.md covers the whole system', () => {
  const md = buildSiteDesignMd(pin);
  for (const heading of ['## Colors', '## Typography', '### Type scale', '### Element styles', '## Spacing', '## Border radius', '## Elevation', '## Motion', '## Layout', '## Components', '### Buttons', '## Usage guidance for AI agents']) {
    assert.ok(md.includes(heading), `missing ${heading}`);
  }
  assert.match(md, /`--color-primary` \| `#b6fe00` \| Primary/);
  assert.match(md, /Text Primary/);
  // text on the brand color comes from the site's own palette, not plain black
  assert.match(md, /Use Primary `#b6fe00`.*Put `#013900` text on it/);
});

test('summary and compact system read well', () => {
  assert.match(siteSummary(site), /led by #b6fe00.*4px spacing grid/);
  assert.match(compactSystem(site), /\*\*Primary button:\*\*.*border-radius: 999px/);
});

test('older pins without a system get a helpful message', () => {
  assert.match(buildSiteDesignMd({ ...pin, site: undefined, analysis: {} }), /older version of Refboard/);
});

test('bundle has prompt, design, tokens, per-site file and a Claude Code skill', () => {
  const files = bundleFiles([pin, { ...pin, id: 'p2', title: 'Hero' }], { project: 'Acme Shop' });
  const names = files.map((f) => f.name);
  assert.deepEqual(names, [
    'refboard/PROMPT.md', 'refboard/DESIGN.md', 'refboard/tokens.css', 'refboard/sites/tapeco-test.DESIGN.md',
    '.claude/skills/acme-shop-design-references/SKILL.md',
  ]);
  const tokens = files.find((f) => f.name.endsWith('tokens.css')).data;
  const vars = tokens.match(/--[\w-]+(?=:)/g);
  assert.equal(new Set(vars).size, vars.length, 'duplicate CSS variable names');
  assert.match(files.at(-1).data, /^---\nname: acme-shop-design-references\ndescription: /);
});

test('the same site is summarised once in the prompt', () => {
  const out = buildPrompt([pin, { ...pin, id: 'p2', title: 'Hero' }], {});
  assert.equal(out.match(/\*\*Design system of tapeco\.test\*\*/g).length, 1);
  assert.match(out, /same site as reference 1/);
});
