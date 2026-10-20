// Turns a set of saved pins into (1) a prompt for Claude Code and (2) a
// DESIGN.md file. Pure functions, no browser APIs, so they can be unit tested.

const MAX_COLORS = 16;
const MAX_VARS_PER_PIN = 30;

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

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function table(headers, rows) {
  if (!rows.length) return '';
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n');
}

export function imagePath(pin, index) {
  return `refs/${String(index + 1).padStart(2, '0')}-${slug(pin.hostname, 20)}-${slug(pin.title, 28)}.png`;
}

function hexToHsl(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

function colorRole(color) {
  const { s, l } = hexToHsl(color.hex);
  if (s > 0.35 && l > 0.15 && l < 0.85) return 'accent';
  if (color.roles.includes('background')) return 'surface';
  if (color.roles.includes('text')) return 'text';
  return 'border';
}

// Pins tagged with a category win for that category; otherwise every pin counts.
function sourcesFor(pins, category) {
  const tagged = pins.filter((p) => p.categories?.includes(category));
  return tagged.length ? { pins: tagged, tagged: true } : { pins, tagged: false };
}

function sourceNote(src, category) {
  return src.tagged
    ? `From references tagged **${category}**: ${[...new Set(src.pins.map((p) => p.hostname))].join(', ')}.`
    : `No reference was tagged ${category}, so this merges all references.`;
}

function mergeColors(pins) {
  const map = new Map();
  for (const pin of pins) {
    const palette = pin.analysis?.palette || [];
    const total = palette.reduce((sum, c) => sum + c.weight, 0) || 1;
    for (const c of palette) {
      const key = c.hex.toLowerCase();
      const e = map.get(key) || { hex: key, weight: 0, roles: new Set(), sources: new Set() };
      e.weight += c.weight / total;
      c.roles.forEach((r) => e.roles.add(r));
      e.sources.add(pin.hostname);
      map.set(key, e);
    }
  }
  const colors = [...map.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_COLORS)
    .map((c) => ({ ...c, roles: [...c.roles], sources: [...c.sources] }));
  const counters = {};
  return colors.map((c) => {
    const role = colorRole(c);
    counters[role] = (counters[role] || 0) + 1;
    return { ...c, role, token: `--color-${role}-${counters[role]}` };
  });
}

function mergeFonts(pins) {
  const families = new Map();
  for (const pin of pins) {
    for (const f of pin.analysis?.fonts || []) {
      const e = families.get(f.family) || { family: f.family, stack: f.stack, weights: new Set(), sources: new Set(), count: 0 };
      f.weights.forEach((w) => e.weights.add(w));
      e.sources.add(pin.hostname);
      e.count += f.count;
      families.set(f.family, e);
    }
  }
  return [...families.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
    .map((f) => ({ ...f, weights: [...f.weights].sort(), sources: [...f.sources] }));
}

function mergeTypeScale(pins) {
  const map = new Map();
  for (const pin of pins) {
    for (const t of pin.analysis?.typeScale || []) {
      const key = `${t.size}|${t.weight}`;
      if (!map.has(key)) map.set(key, { ...t, source: pin.hostname });
    }
  }
  return [...map.values()].sort((a, b) => parseFloat(b.size) - parseFloat(a.size)).slice(0, 10);
}

function mergeList(pins, field, limit) {
  const map = new Map();
  for (const pin of pins) {
    for (const v of pin.analysis?.[field] || []) {
      const e = map.get(v) || { value: v, sources: new Set() };
      e.sources.add(pin.hostname);
      map.set(v, e);
    }
  }
  return [...map.values()].slice(0, limit).map((e) => ({ value: e.value, sources: [...e.sources] }));
}

export function consolidate(pins) {
  const colorSrc = sourcesFor(pins, 'Color');
  const typeSrc = sourcesFor(pins, 'Typography');
  const layoutSrc = sourcesFor(pins, 'Layout');
  const compSrc = sourcesFor(pins, 'Component');
  const motionSrc = sourcesFor(pins, 'Animation');
  const spacing = mergeList(layoutSrc.pins, 'spacing', 12).sort((a, b) => parseFloat(a.value) - parseFloat(b.value));
  return {
    colors: { src: colorSrc, items: mergeColors(colorSrc.pins) },
    fonts: { src: typeSrc, items: mergeFonts(typeSrc.pins) },
    typeScale: { src: typeSrc, items: mergeTypeScale(typeSrc.pins) },
    spacing: { src: layoutSrc, items: spacing },
    radii: { src: compSrc, items: mergeList(compSrc.pins, 'radii', 8) },
    shadows: { src: compSrc, items: mergeList(compSrc.pins, 'shadows', 6) },
    motion: { src: motionSrc, items: mergeList(motionSrc.pins, 'transitions', 6) },
  };
}

function colorsTable(colors) {
  return table(
    ['Token', 'Value', 'Role', 'Seen as', 'Source'],
    colors.map((c) => [`\`${c.token}\``, `\`${c.hex}\``, c.role, c.roles.join(', '), c.sources.join(', ')]),
  );
}

function fontsTable(fonts) {
  return table(
    ['Family', 'Weights', 'Full stack', 'Source'],
    fonts.map((f) => [f.family, f.weights.join(', '), `\`${f.stack}\``, f.sources.join(', ')]),
  );
}

function typeScaleTable(scale) {
  return table(
    ['Size', 'Weight', 'Line height', 'Letter spacing', 'Family', 'Used on', 'Source'],
    scale.map((t) => [t.size, t.weight, t.lineHeight, t.letterSpacing, t.family, t.tags.join(', '), t.source]),
  );
}

function valueList(items) {
  return items.map((i) => `- \`${i.value}\` (${i.sources.join(', ')})`).join('\n');
}

function tokensSection(tokens, level = '###') {
  const out = [];
  const add = (title, block, note) => {
    if (!block) return;
    out.push(`${level} ${title}`, '', note, '', block, '');
  };
  add('Colors', colorsTable(tokens.colors.items), sourceNote(tokens.colors.src, 'Color'));
  add('Font families', fontsTable(tokens.fonts.items), sourceNote(tokens.fonts.src, 'Typography'));
  add('Type scale', typeScaleTable(tokens.typeScale.items), sourceNote(tokens.typeScale.src, 'Typography'));
  add('Spacing', valueList(tokens.spacing.items), sourceNote(tokens.spacing.src, 'Layout'));
  add('Border radius', valueList(tokens.radii.items), sourceNote(tokens.radii.src, 'Component'));
  add('Shadows', valueList(tokens.shadows.items), sourceNote(tokens.shadows.src, 'Component'));
  add('Motion', valueList(tokens.motion.items), sourceNote(tokens.motion.src, 'Animation'));
  return out.join('\n');
}

function referenceSection(pin, index, opts) {
  const a = pin.analysis || {};
  const lines = [`### ${index + 1}. ${pin.title} — ${pin.hostname}`, ''];
  lines.push(`- **Source:** ${pin.url}`);
  lines.push(
    pin.kind === 'element'
      ? `- **Captured:** one section of the page (\`${a.selector}\`, ${a.size?.width}×${a.size?.height}px)`
      : `- **Captured:** the whole page (visible viewport)`,
  );
  if (pin.categories?.length) lines.push(`- **Focus:** ${pin.categories.join(', ')}`);
  if (pin.tags?.length) lines.push(`- **Tags:** ${pin.tags.join(', ')}`);
  if (pin.image) lines.push(`- **Screenshot:** \`${imagePath(pin, index)}\``);
  lines.push('', `**What I want from this:** ${pin.note || '_(no note — infer from the screenshot and focus tags)_'}`, '');

  const styles = Object.entries(a.keyStyles || {});
  if (pin.kind === 'element' && styles.length) {
    lines.push('**Measured styles of this section:**', '', table(['Property', 'Value'], styles.map(([k, v]) => [k, `\`${v}\``])), '');
  }
  if (a.palette?.length) lines.push(`**Palette:** ${a.palette.slice(0, 8).map((c) => `\`${c.hex}\``).join(' ')}`);
  if (a.fonts?.length) lines.push(`**Fonts:** ${a.fonts.map((f) => `${f.family} (${f.weights.join('/')})`).join(', ')}`);
  if (a.radii?.length) lines.push(`**Radius:** ${a.radii.map((r) => `\`${r}\``).join(' ')}`);
  if (a.shadows?.length) lines.push(`**Shadow:** \`${a.shadows[0]}\``);
  if (a.transitions?.length) lines.push(`**Motion:** \`${a.transitions[0]}\``);
  lines.push('');

  const vars = Object.entries(a.cssVars || {}).slice(0, MAX_VARS_PER_PIN);
  if (vars.length) {
    lines.push('<details><summary>CSS variables defined by the site</summary>', '', '```css', ':root {', ...vars.map(([k, v]) => `  ${k}: ${v};`), '}', '```', '</details>', '');
  }
  if (opts.includeHtml && a.html) {
    lines.push('<details><summary>HTML structure (trimmed)</summary>', '', '```html', a.html, '```', '</details>', '');
  }
  if (opts.includeDesignMd && pin.designMd?.text) {
    lines.push(`**Full design system for ${pin.hostname}** (from the attached \`${pin.designMd.name}\`):`, '', '````markdown', pin.designMd.text.trim(), '````', '');
  }
  return lines.join('\n');
}

export function buildPrompt(pins, opts = {}) {
  const project = opts.project?.trim() || 'my project';
  const tokens = consolidate(pins);
  const hasImages = pins.some((p) => p.image);
  return [
    `# Design references for ${project}`,
    '',
    `I collected ${pins.length} design reference${pins.length === 1 ? '' : 's'} while browsing. Each one has a note saying what I want to take from it, styles measured from the live site${hasImages ? ', and a screenshot in the `refs/` folder next to this file' : ''}.`,
    '',
    'Use these for patterns, layout, hierarchy and feel. **Do not copy logos, brand names, text, illustrations or photos** from these sites.',
    '',
    '## References',
    '',
    ...pins.map((p, i) => referenceSection(p, i, opts)),
    '## Consolidated design tokens',
    '',
    'Merged from the references above. For each group, references I tagged with that focus take priority.',
    '',
    tokensSection(tokens),
    '## What to do',
    '',
    hasImages ? '1. Look at every screenshot in `refs/` next to its note before writing code.' : '1. Read every reference and its note before writing code.',
    '2. If this project already has a design system or tokens (CSS variables, Tailwind theme, theme file), map these values onto it instead of creating a parallel set. Otherwise, propose tokens from the consolidated list.',
    '3. Build each referenced pattern as a reusable, accessible component that matches my note: the intent, not a pixel copy.',
    '4. Where references disagree, follow the one I tagged for that focus (for example, colors come from the reference tagged Color).',
    '5. Before coding, reply with a short plan: the tokens you will add, the components you will build, and any questions.',
    '',
  ].join('\n');
}

export function buildDesignMd(pins, opts = {}) {
  const project = opts.project?.trim() || 'Project';
  const tokens = consolidate(pins);
  const elements = pins.filter((p) => p.kind === 'element');
  const out = [
    `# ${project} — Design System`,
    '',
    `> Generated by Refboard from ${pins.length} saved reference${pins.length === 1 ? '' : 's'} on ${new Date(opts.date || Date.now()).toISOString().slice(0, 10)}. Values were measured from live sites. Treat them as a starting point and adjust them to the brand.`,
    '',
    '## Overview',
    '',
    ...pins.map((p) => `- **${p.title}** (${p.hostname}): ${p.note || 'no note'}`),
    '',
    tokensSection(tokens, '##'),
  ];
  if (tokens.colors.items.length) {
    out.push('### CSS variables', '', '```css', ':root {', ...tokens.colors.items.map((c) => `  ${c.token}: ${c.hex};`));
    tokens.fonts.items.slice(0, 2).forEach((f, i) => out.push(`  --font-${i === 0 ? 'primary' : 'secondary'}: ${f.stack};`));
    tokens.radii.items.slice(0, 3).forEach((r, i) => out.push(`  --radius-${i + 1}: ${r.value};`));
    out.push('}', '```', '');
  }
  if (elements.length) {
    out.push('## Components', '');
    for (const p of elements) {
      const styles = Object.entries(p.analysis?.keyStyles || {});
      out.push(`### ${p.title}`, '', `Inspired by ${p.hostname}. ${p.note || ''}`.trim(), '');
      if (styles.length) out.push(table(['Property', 'Value'], styles.map(([k, v]) => [k, `\`${v}\``])), '');
    }
  }
  out.push('## References', '', ...pins.map((p, i) => `${i + 1}. [${p.title}](${p.url})${p.image ? `: \`${imagePath(p, i)}\`` : ''}`), '');
  return out.join('\n');
}

export function imageFiles(pins) {
  return pins.map((p, i) => (p.image ? { name: imagePath(p, i), dataUrl: p.image } : null)).filter(Boolean);
}
