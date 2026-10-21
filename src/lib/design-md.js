// Builds a full DESIGN.md for one site from the design system Refboard
// measured on it (pin.site), plus helpers that summarise it for prompts.
// Pure functions, no browser APIs.

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const code = (v) => (v === undefined || v === null || v === '' ? '' : `\`${v}\``);

function table(headers, rows) {
  if (!rows.length) return '';
  return [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
}

/* ---------- color math ---------- */

function rgb(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function luminance(hex) {
  const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const { r, g, b } = rgb(hex);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return Math.round(((x + 0.05) / (y + 0.05)) * 10) / 10;
}

const wcag = (ratio) => (ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA large' : 'fails');

/* ---------- reading a system ---------- */

export function siteOf(pin) {
  return pin.site || pin.analysis?.system || null;
}

const byRole = (sys, role) => sys.colors.filter((c) => c.role === role);
const first = (sys, ...roles) => roles.map((r) => byRole(sys, r)[0]).find(Boolean);

// The best readable text color on a given background.
// Prefers the site's own colors; falls back to black/white only if none is readable.
function textOn(sys, bgHex) {
  const rank = (list) => list.map((c) => ({ ...c, ratio: contrast(c.hex.slice(0, 7), bgHex.slice(0, 7)) })).sort((a, b) => b.ratio - a.ratio);
  const own = rank(sys.colors.filter((c) => c.hex !== bgHex && /^Text|Background|Surface|Primary|Accent/.test(c.role) && c.hex.length === 7));
  if (own[0]?.ratio >= 4.5) return own[0];
  return rank([{ hex: '#ffffff' }, { hex: '#000000' }])[0];
}

function familiesByUsage(sys) {
  const fams = sys.typography?.families || [];
  return {
    display: fams.find((f) => f.usage.includes('display')) || fams[0],
    body: fams.find((f) => f.usage.includes('body')) || fams[0],
    ui: fams.find((f) => f.usage.includes('ui')),
  };
}

function radiusCharacter(sys) {
  const r = sys.radius || [];
  if (!r.length) return 'square corners';
  const full = r.some((x) => x.full);
  const biggest = r.filter((x) => !x.full).map((x) => parseFloat(x.value)).sort((a, b) => b - a)[0];
  return [full && 'pill-shaped controls', biggest && `${biggest}px rounded containers`].filter(Boolean).join(' and ') || 'rounded corners';
}

/* ---------- one-paragraph summary ---------- */

export function siteSummary(sys) {
  const primary = first(sys, 'Primary');
  const bg = first(sys, 'Background');
  const { display, body } = familiesByUsage(sys);
  const parts = [];
  parts.push(`${sys.colors.length} colors${primary ? ` led by ${primary.hex}` : ''}${bg ? ` on ${bg.hex}` : ''}`);
  if (display) parts.push(display === body ? `${display.family} for all text` : `${display.family} for display and ${body?.family || 'a sans-serif'} for body`);
  if (sys.spacing?.base) parts.push(`a ${sys.spacing.base}px spacing grid`);
  parts.push(radiusCharacter(sys));
  if (sys.shadows?.length) parts.push(`${sys.shadows.length} shadow level${sys.shadows.length === 1 ? '' : 's'}`);
  return parts.join(', ') + '.';
}

// A few lines used inside PROMPT.md for each reference.
export function compactSystem(sys) {
  if (!sys?.colors) return '';
  const lines = [];
  lines.push(`- **Colors:** ${sys.colors.slice(0, 8).map((c) => `${c.role} \`${c.hex}\``).join(', ')}`);
  const fams = sys.typography?.families || [];
  if (fams.length) lines.push(`- **Fonts:** ${fams.map((f) => `${f.family} (${f.usage.join('/') || 'text'}, ${f.weights.join('/')})`).join(', ')}`);
  const els = sys.typography?.elements || {};
  const heads = ['h1', 'h2', 'h3', 'p'].filter((k) => els[k]).map((k) => `${k} ${els[k].family} ${els[k].size}/${els[k].weight}${els[k].transform ? ` ${els[k].transform}` : ''}`);
  if (heads.length) lines.push(`- **Type:** ${heads.join(' · ')}`);
  if (sys.spacing?.scale?.length) lines.push(`- **Spacing:** ${sys.spacing.base ? `${sys.spacing.base}px grid; ` : ''}${sys.spacing.scale.slice(0, 10).join(', ')}`);
  if (sys.radius?.length) lines.push(`- **Radius:** ${sys.radius.map((r) => r.value).join(', ')}`);
  const btn = sys.components?.buttons?.[0];
  if (btn) lines.push(`- **Primary button:** ${Object.entries(btn.styles).map(([k, v]) => `${k}: ${v}`).join('; ')}`);
  return lines.join('\n');
}

/* ---------- full DESIGN.md ---------- */

function componentBlock(title, list) {
  if (!list?.length) return [];
  const out = [`### ${title}`, ''];
  list.forEach((v, i) => {
    const label = list.length > 1 ? `**Variant ${i + 1}**${v.sample ? ` (e.g. "${v.sample}")` : ''}, ${v.share}% of ${title.toLowerCase()}` : v.sample ? `e.g. "${v.sample}"` : '';
    if (label) out.push(label, '');
    out.push(table(['Property', 'Value'], Object.entries(v.styles).map(([k, val]) => [k, code(val)])), '');
  });
  return out;
}

function guidance(sys) {
  const rules = [];
  const primary = first(sys, 'Primary');
  const bg = first(sys, 'Background');
  const text = first(sys, 'Text Primary', 'Text Secondary');
  const { display, body } = familiesByUsage(sys);
  const els = sys.typography?.elements || {};

  if (bg && text) rules.push(`Page background \`${bg.hex}\` with body text \`${text.hex}\` (contrast ${contrast(bg.hex.slice(0, 7), text.hex.slice(0, 7))}:1, ${wcag(contrast(bg.hex.slice(0, 7), text.hex.slice(0, 7)))}).`);
  if (primary) {
    const on = textOn(sys, primary.hex);
    rules.push(`Use Primary \`${primary.hex}\` for main calls to action and brand blocks. Put \`${on.hex}\` text on it (contrast ${on.ratio}:1, ${wcag(on.ratio)}).`);
  }
  const accents = byRole(sys, 'Accent');
  if (accents.length) rules.push(`Accents (${accents.map((a) => `\`${a.hex}\``).join(', ')}) are for highlights, badges and small details, not large areas.`);
  if (display && els.h1) rules.push(`Headings: ${display.family} ${els.h1.weight}${els.h1.transform ? `, ${els.h1.transform}` : ''}${els.h1.letterSpacing && els.h1.letterSpacing !== 'normal' ? `, letter-spacing ${els.h1.letterSpacing}` : ''}. The h1 is ${els.h1.size}.`);
  if (body && els.p) rules.push(`Body text: ${body.family} ${els.p.size}, line-height ${els.p.lineHeight}.`);
  if (sys.spacing?.base) rules.push(`Keep spacing on a ${sys.spacing.base}px grid: use multiples of ${sys.spacing.base}px for padding, margins and gaps.`);
  const btn = sys.components?.buttons?.[0];
  if (btn) {
    const s = btn.styles;
    rules.push(`Buttons: ${[s['border-radius'] && `radius ${s['border-radius']}`, s.padding && `padding ${s.padding}`, s['text-transform'] && s['text-transform'], s['font-weight'] && `weight ${s['font-weight']}`].filter(Boolean).join(', ')}.`);
  }
  const card = sys.components?.cards?.[0];
  if (card) rules.push(`Cards: ${[card.styles['border-radius'] && `radius ${card.styles['border-radius']}`, card.styles.padding && `padding ${card.styles.padding}`, card.styles['box-shadow'] ? 'soft shadow' : card.styles.border ? 'thin border' : 'flat fill'].filter(Boolean).join(', ')}.`);
  if (sys.motion?.durations?.length) rules.push(`Motion: ${sys.motion.durations.slice(0, 3).join(' / ')} with \`${sys.motion.easings[0] || 'ease'}\`.`);
  rules.push('Reuse these tokens instead of inventing new colors, sizes or radii. Never copy the site’s logo, product names, copy or photos.');
  return rules;
}

export function buildSiteDesignMd(pin, opts = {}) {
  const sys = siteOf(pin);
  const name = pin.pageTitle?.split(/[|—–-]/)[0].trim() || pin.hostname;
  if (!sys?.colors) {
    return `# ${name}\n\n> This reference was saved with an older version of Refboard, so no full design system was captured. Save it again to get one.\n`;
  }
  const date = new Date(opts.date || pin.createdAt || Date.now()).toISOString().slice(0, 10);
  const t = sys.typography || {};
  const out = [
    `# ${name}`,
    '',
    '## Overview',
    '',
    `- **Site:** ${pin.hostname} (${pin.url})`,
    pin.description ? `- **Description:** ${pin.description}` : null,
    `- **Captured:** ${date} with Refboard${sys.stats?.truncated ? ' (very large page, so a sample of it was scanned)' : ''}`,
    `- **Character:** ${siteSummary(sys)}`,
    '',
    '## Colors',
    '',
    table(['Token', 'Value', 'Role', 'Text %', 'Background %'], sys.colors.map((c) => [code(c.token), code(c.hex), c.role, c.usage.text, c.usage.background])),
    '',
    '## Typography',
    '',
    '### Font families',
    '',
    table(['Family', 'Used for', 'Weights', 'Share of text', 'Stack'], (t.families || []).map((f) => [f.family, f.usage.join(', ') || 'text', f.weights.join(', '), `${f.share}%`, code(f.stack)])),
    '',
    '### Type scale',
    '',
    table(['Token', 'Size', 'Weights', 'Line height', 'Letter spacing', 'Transform', 'Used on'], (t.scale || []).map((s) => [code(s.name), s.size, s.weights.join(', '), s.lineHeight, s.letterSpacing, s.transform || '', s.usedOn.join(', ')])),
    '',
  ];
  const els = Object.entries(t.elements || {});
  if (els.length) {
    out.push('### Element styles', '', table(['Element', 'Family', 'Size', 'Weight', 'Line height', 'Letter spacing', 'Color', 'Example'], els.map(([k, v]) => [code(k), v.family, v.size, v.weight, v.lineHeight, v.letterSpacing, v.color || '', v.sample])), '');
  }
  if (t.weights?.length) out.push(`**Weight scale:** ${t.weights.join(', ')}`, '');
  if (t.lineHeights?.length) out.push(`**Line-height ratios:** ${t.lineHeights.join(', ')}`, '');

  out.push('## Spacing', '', sys.spacing?.base ? `Base unit: **${sys.spacing.base}px**. Values in use:` : 'Values in use:', '', (sys.spacing?.scale || []).map(code).join(' '), '');
  if (sys.radius?.length) out.push('## Border radius', '', table(['Value', 'Uses'], sys.radius.map((r) => [code(r.value), r.count])), '');
  if (sys.shadows?.length) out.push('## Elevation', '', table(['Token', 'Value', 'Uses'], sys.shadows.map((s) => [code(s.name), code(s.value), s.count])), '');
  const m = sys.motion || {};
  if (m.durations?.length || m.animations?.length) {
    out.push('## Motion', '');
    if (m.durations?.length) out.push(`- **Durations:** ${m.durations.map(code).join(', ')}`);
    if (m.easings?.length) out.push(`- **Easing:** ${m.easings.map(code).join(', ')}`);
    if (m.animations?.length) out.push(`- **Keyframe animations:** ${m.animations.map(code).join(', ')}`);
    out.push('');
  }
  const l = sys.layout || {};
  if (l.containerWidths?.length || l.gridColumns?.length || sys.breakpoints?.length) {
    out.push('## Layout', '');
    if (l.containerWidths?.length) out.push(`- **Container max-widths:** ${l.containerWidths.map((w) => `${w}px`).join(', ')}`);
    if (l.gridColumns?.length) out.push(`- **Grid columns:** ${l.gridColumns.join(', ')}`);
    if (sys.breakpoints?.length) out.push(`- **Breakpoints:** ${sys.breakpoints.map((b) => `${b}px`).join(', ')}`);
    out.push('');
  }
  const c = sys.components || {};
  if (Object.values(c).some((v) => v?.length)) {
    out.push('## Components', '', ...componentBlock('Buttons', c.buttons), ...componentBlock('Inputs', c.inputs), ...componentBlock('Cards', c.cards), ...componentBlock('Badges', c.badges), ...componentBlock('Links', c.links));
  }
  const vars = Object.entries(sys.cssVars || {});
  if (vars.length) out.push('## CSS variables defined by the site', '', '```css', ':root {', ...vars.slice(0, 80).map(([k, v]) => `  ${k}: ${v};`), '}', '```', '');
  out.push('## Usage guidance for AI agents', '', ...guidance(sys).map((r) => `- ${r}`), '');
  return out.filter((x) => x !== null).join('\n');
}

/* ---------- tokens.css and SKILL.md for a set of pins ---------- */

export function buildTokensCss(tokens, pins) {
  const lines = ['/* Generated by Refboard from your saved references. Rename to fit your project. */', ':root {'];
  for (const c of tokens.colors.items) lines.push(`  ${c.token}: ${c.hex};`);
  const used = new Set();
  tokens.fonts.items.forEach((f, i) => {
    const want = f.usage?.includes('body') ? 'body' : f.usage?.includes('display') ? 'display' : f.usage?.includes('ui') ? 'ui' : 'alt';
    let name = want;
    for (let n = 2; used.has(name); n++) name = `${want}-${n}`;
    used.add(name);
    lines.push(`  --font-${name}: ${f.stack};`);
  });
  const sizes = [...new Map(tokens.typeScale.items.filter((t) => t.name).map((t) => [t.name, t])).values()].sort((a, b) => parseFloat(a.size) - parseFloat(b.size));
  for (const t of sizes) lines.push(`  --${t.name}: ${t.size};`);
  const base = pins.map((p) => siteOf(p)?.spacing?.base).find(Boolean);
  if (base) for (const n of [1, 2, 3, 4, 6, 8, 12, 16, 24]) lines.push(`  --space-${n}: ${n * base}px;`);
  tokens.radii.items.forEach((r, i) => lines.push(`  --radius-${i + 1}: ${r.value};`));
  tokens.shadows.items.forEach((s, i) => lines.push(`  --shadow-${i + 1}: ${s.value};`));
  lines.push('}', '');
  return lines.join('\n');
}

export function buildSkillMd(pins, tokens, opts = {}) {
  const project = opts.project?.trim() || 'this project';
  const slugName = (opts.project || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  const colors = tokens.colors.items.slice(0, 8).map((c) => `\`${c.token}: ${c.hex}\` (${c.role})`).join(', ');
  const fonts = tokens.fonts.items.map((f) => f.family).join(', ');
  return [
    '---',
    `name: ${slugName}-design-references`,
    `description: Visual design references, tokens and screenshots for ${project}. Use when building, styling or reviewing any UI, page, component or theme in this project.`,
    '---',
    '',
    `# Design references for ${project}`,
    '',
    `${pins.length} references were collected with Refboard. Before writing or changing UI:`,
    '',
    '1. Read `refboard/PROMPT.md`: each reference, what the user wants from it, and the measured styles.',
    '2. Look at the screenshots in `refboard/refs/`.',
    '3. Use the tokens in `refboard/DESIGN.md` and `refboard/tokens.css`. Full per-site systems are in `refboard/sites/`.',
    '',
    '## Core tokens',
    '',
    colors ? `- Colors: ${colors}` : null,
    fonts ? `- Fonts: ${fonts}` : null,
    '',
    '## Rules',
    '',
    '- Map these tokens onto the project’s existing theme if it has one; do not create a parallel set.',
    '- Match the intent in the user’s notes, not a pixel copy. Never copy logos, brand names, copy or photos.',
    '- When references disagree, follow the one tagged with that focus (Color, Typography, Layout, Component, Animation).',
    '',
  ].filter((x) => x !== null).join('\n');
}
