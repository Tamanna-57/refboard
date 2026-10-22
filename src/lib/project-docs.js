// Builds the files Refboard writes into a project folder when you click Build:
// DESIGN.md, SKILL.md, PROMPT.md, references.md, tokens (css/json/tailwind),
// one DESIGN.md per source site, and refboard.json (to restore the board).
// The folder is laid out so it can be handed to Claude Code as-is, or dropped
// into .claude/skills/ as a skill. Pure functions, no browser APIs.

import { consolidate } from './generate.js';
import { siteOf, siteSummary, buildSiteDesignMd, contrast, wcag, fontTokenNames } from './design-md.js';
import { analyzeMotion } from './motion.js';
import { slug, pinPaths } from './paths.js';

/* ---------- markdown helpers ---------- */

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const code = (v) => (v === undefined || v === null || v === '' ? '—' : `\`${v}\``);
function table(headers, rows) {
  if (!rows.length) return '';
  return [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
}
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');
// "rgba(1, 57, 0, 0.08) 0px 2px" → "#01390014 0px 2px"
const hexify = (v) => String(v).replace(/rgba?\(([^)]+)\)/g, (m, inner) => {
  const [r, g, b, a = 1] = inner.split(/[\s,/]+/).filter(Boolean).map(parseFloat);
  return a < 0.05 ? 'transparent' : '#' + hex2(r) + hex2(g) + hex2(b) + (a < 1 ? hex2(a * 255) : '');
});
const toMs = (v) => (typeof v === 'number' ? v : String(v).endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000);
const KIND_LABEL = { element: 'Section', page: 'Screenshot', recording: 'Recording' };

function filesOf(pin) {
  return pin.files?.screenshot || pin.files?.video ? pin.files : pinPaths(pin);
}

/* ---------- gathering the system from many references ---------- */

function sitesOf(pins) {
  const seen = new Map();
  for (const p of pins) {
    const sys = siteOf(p);
    if (sys?.colors && !seen.has(p.hostname)) seen.set(p.hostname, { host: p.hostname, sys, pin: p });
  }
  return [...seen.values()];
}

// The site whose system wins for a focus area: one tagged with it, else the most-referenced.
function leadSite(pins, sites, category) {
  const tagged = pins.find((p) => p.categories?.includes(category) && siteOf(p)?.colors);
  if (tagged) return sites.find((s) => s.host === tagged.hostname);
  const counts = new Map();
  pins.forEach((p) => counts.set(p.hostname, (counts.get(p.hostname) || 0) + 1));
  return [...sites].sort((a, b) => (counts.get(b.host) || 0) - (counts.get(a.host) || 0))[0];
}

function motionTokens(pins, sites) {
  const durations = new Map();
  const easings = new Map();
  const add = (map, k, src) => {
    if (k === undefined || k === null || k === '' || k === 'linear' || Number.isNaN(k)) return;
    const e = map.get(k) || { value: k, n: 0, sources: new Set() };
    e.n++;
    e.sources.add(src);
    map.set(k, e);
  };
  for (const s of sites) {
    for (const d of s.sys.motion?.durations || []) {
      const v = Math.round(toMs(d));
      if (v > 0 && v <= 2000) add(durations, v, s.host);
    }
    for (const e of s.sys.motion?.easings || []) add(easings, e, s.host);
  }
  for (const p of pins.filter((x) => x.kind === 'recording')) {
    for (const e of motionOf(p).effects) {
      if (e.durationSource === 'css' && e.duration > 0 && e.duration <= 2000) add(durations, Math.round(e.duration), p.hostname);
      if (e.easing) add(easings, e.easing, p.hostname);
    }
  }
  const ds = [...durations.values()].sort((a, b) => a.value - b.value).slice(0, 6);
  // Named in order, so the scale reads naturally: fast < base < slow < slower…
  const names = ds.length <= 3 ? ['fast', 'base', 'slow'] : ds.length === 4 ? ['fast', 'base', 'slow', 'slower'] : ['instant', 'fast', 'base', 'slow', 'slower', 'slowest'];
  const durationTokens = ds.map((d, i) => ({ token: `--duration-${names[i]}`, ms: d.value, sources: [...d.sources] }));
  const es = [...easings.values()].sort((a, b) => b.n - a.n).slice(0, 4);
  const easeNames = ['standard', 'emphasized', 'gentle', 'alt'];
  const easingTokens = es.map((e, i) => ({ token: `--ease-${easeNames[i]}`, value: e.value, sources: [...e.sources] }));
  return { durationTokens, easingTokens };
}

function motionOf(pin) {
  return pin.motionAnalysis || analyzeMotion(pin.motion);
}

// Filled buttons are Primary (brand-colored or the first filled one), then Secondary.
function buttonNames(list, primaryHex) {
  const filled = list.filter((v) => v.styles['background-color']);
  const primary = filled.find((v) => primaryHex && v.styles['background-color'].toLowerCase() === primaryHex.toLowerCase()) || filled[0];
  const used = {};
  return list.map((v) => {
    let name = v === primary ? 'Primary' : v.styles['background-color'] ? 'Secondary' : v.styles.border ? 'Outline' : 'Ghost';
    used[name] = (used[name] || 0) + 1;
    return used[name] > 1 ? `${name} ${used[name]}` : name;
  });
}

/* ---------- sections of DESIGN.md ---------- */

function referenceBoard(pins) {
  return table(
    ['#', 'Reference', 'Type', 'What to take from it', 'File'],
    pins.map((p, i) => {
      const f = filesOf(p);
      return [i + 1, `${p.title} (${p.hostname})`, KIND_LABEL[p.kind] || p.kind, p.note || (p.categories?.length ? `Focus: ${p.categories.join(', ')}` : '—'), code(f.screenshot || f.contactSheet || f.video)];
    }),
  );
}

function visualDirection(pins, sites, tokens) {
  const out = ['## 1. Visual direction', ''];
  const primary = tokens.colors.items.find((c) => /^primary/i.test(c.role));
  const fonts = tokens.fonts.items;
  const lines = [];
  if (primary) lines.push(`Built around ${primary.hex} as the brand color`);
  if (fonts.length) lines.push(`${fonts.map((f) => f.family).slice(0, 2).join(' and ')} typography`);
  if (lines.length) out.push(`**In one line:** ${lines.join(', with ')}.`, '');
  for (const s of sites) out.push(`- **${s.host}:** ${siteSummary(s.sys)}`);
  if (sites.length) out.push('');
  const notes = pins.filter((p) => p.note);
  if (notes.length) {
    out.push('### Intent (from your notes)', '', ...notes.map((p) => `- **${p.title}** (${KIND_LABEL[p.kind] || p.kind}, ${p.hostname}): ${p.note}`), '');
  }
  out.push('### Reference board', '', referenceBoard(pins), '');
  return out;
}

function colorSection(tokens, sites) {
  const items = tokens.colors.items;
  if (!items.length) return [];
  const out = ['## 2. Color', '', tokens.colors.src.tagged ? `Taken from the references you tagged **Color**.` : 'Merged from all references (tag a reference with **Color** to make it the source).', ''];
  out.push(table(['Token', 'Value', 'Role', 'Seen as', 'Source'], items.map((c) => [code(c.token), code(c.hex), c.role, c.roles.join(', '), c.sources.join(', ')])), '');
  // Contrast pairings: every text-ish color on every background-ish color.
  const bgs = items.filter((c) => /background|surface|primary/i.test(c.role) && c.hex.length === 7).slice(0, 5);
  const texts = items.filter((c) => /text|primary|accent/i.test(c.role) && c.hex.length === 7).slice(0, 6);
  const pairs = [];
  for (const b of bgs) for (const t of texts) if (b.hex !== t.hex && contrast(t.hex, b.hex) >= 3) pairs.push([t, b, contrast(t.hex, b.hex)]);
  pairs.sort((a, b) => b[2] - a[2]);
  if (pairs.length) {
    out.push('### Contrast pairings', '', 'Use the pairs marked AA or better for body text; "AA large" only for headings 24px+ or bold 19px+.', '');
    out.push(table(['Text', 'On background', 'Contrast', 'WCAG'], pairs.slice(0, 12).map(([t, b, r]) => [`${code(t.hex)} ${t.role}`, `${code(b.hex)} ${b.role}`, `${r}:1`, wcag(r)])), '');
  }
  out.push('### Rules', '');
  const primary = items.find((c) => /^primary/i.test(c.role));
  const bg = items.find((c) => /^background/i.test(c.role));
  if (primary) out.push(`- ${code(primary.token)} (${primary.hex}) is for primary actions and brand moments. Use it sparingly so it stays loud.`);
  if (bg) out.push(`- Page background is ${code(bg.token)} (${bg.hex}); cards and raised areas use the Surface colors.`);
  out.push('- Never introduce new hex values in components: add a token first.', '');
  return out;
}

function typographySection(tokens, sites, pins) {
  const fonts = tokens.fonts.items;
  if (!fonts.length) return [];
  const out = ['## 3. Typography', ''];
  out.push('### Families', '', table(['Family', 'Role', 'Weights', 'Fallback stack', 'Source'], fonts.map((f) => [f.family, f.usage?.join(', ') || 'text', f.weights.join(', '), code(f.stack), f.sources.join(', ')])), '');
  out.push('> These are the families the sites load. If a font isn’t licensed for your project, pick the closest available family and keep the scale and weights.', '');
  const scale = tokens.typeScale.items.slice().sort((a, b) => parseFloat(a.size) - parseFloat(b.size));
  if (scale.length) {
    out.push('### Type scale', '', table(['Token', 'Size', 'Weight', 'Line height', 'Tracking', 'Family', 'Used on'], scale.map((t) => [code(t.name ? `--${t.name}` : ''), t.size, t.weight, t.lineHeight, t.letterSpacing, t.family, (t.tags || []).join(', ')])), '');
  }
  const lead = leadSite(pins, sites, 'Typography');
  const els = Object.entries(lead?.sys.typography?.elements || {});
  if (els.length) {
    out.push(`### Text styles (from ${lead.host})`, '', table(['Style', 'Family', 'Size', 'Weight', 'Line height', 'Tracking', 'Case', 'Color'], els.map(([k, v]) => [code(k), v.family, v.size, v.weight, v.lineHeight, v.letterSpacing, v.transform || '—', v.color || '—'])), '');
  }
  return out;
}

function spacingSection(pins, sites) {
  const lead = leadSite(pins, sites, 'Layout');
  if (!lead) return [];
  const sp = lead.sys.spacing || {};
  const l = lead.sys.layout || {};
  const out = ['## 4. Spacing & layout', '', `From ${lead.host}${pins.some((p) => p.categories?.includes('Layout')) ? ' (tagged Layout)' : ''}.`, ''];
  if (sp.base) {
    out.push(`- **Base unit:** ${sp.base}px. Every padding, margin and gap is a multiple of it.`);
    out.push(`- **Spacing tokens:** ${[1, 2, 3, 4, 6, 8, 12, 16, 24].map((n) => `\`--space-${n}\` ${n * sp.base}px`).join(' · ')}`);
  }
  if (sp.scale?.length) out.push(`- **Values seen on the site:** ${sp.scale.join(', ')}`);
  if (l.containerWidths?.length) out.push(`- **Container max-widths:** ${l.containerWidths.map((w) => `${w}px`).join(', ')}`);
  if (l.gridColumns?.length) out.push(`- **Grid columns:** ${l.gridColumns.join(', ')}`);
  if (lead.sys.breakpoints?.length) out.push(`- **Breakpoints:** ${lead.sys.breakpoints.map((b) => `${b}px`).join(', ')}`);
  out.push('');
  return out;
}

function shapeSection(tokens) {
  if (!tokens.radii.items.length && !tokens.shadows.items.length) return [];
  const out = ['## 5. Shape & elevation', ''];
  if (tokens.radii.items.length) out.push('### Radius', '', table(['Token', 'Value', 'Source'], tokens.radii.items.map((r, i) => [code(`--radius-${i + 1}`), code(r.value), r.sources.join(', ')])), '');
  if (tokens.shadows.items.length) out.push('### Elevation', '', table(['Token', 'Value', 'Source'], tokens.shadows.items.map((s, i) => [code(`--shadow-${i + 1}`), code(s.value), s.sources.join(', ')])), '');
  return out;
}

function stateRows(v) {
  const rows = [];
  for (const [state, decl] of Object.entries(v.states || {})) rows.push([`:${state}`, Object.entries(decl).map(([k, val]) => `${k}: ${val}`).join('; ')]);
  return rows;
}

function componentSpec(title, v, extra = []) {
  const out = [`#### ${title}`, ''];
  if (v.sample) out.push(`Example label: “${v.sample}”${v.size ? ` · rendered size ${v.size.width}×${v.size.height}px` : ''} · ${v.count} on the page`, '');
  out.push(table(['Property', 'Value'], [...Object.entries(v.styles).map(([k, val]) => [k, code(val)]), ...extra]), '');
  const states = stateRows(v);
  if (states.length) out.push('States:', '', table(['State', 'Changes'], states.map(([s, c]) => [code(s), c])), '');
  else out.push('_No hover/focus styles were found in the site’s CSS for this component; add a visible focus ring._', '');
  if (v.transition) out.push(`Transition: ${code(v.transition)}`, '');
  return out;
}

function componentsSection(pins, sites, tokens) {
  const lead = leadSite(pins, sites, 'Component');
  const out = ['## 6. Components', ''];
  const c = lead?.sys.components || {};
  const primaryHex = tokens.colors.items.find((x) => /^primary/i.test(x.role))?.hex;
  if (lead && Object.values(c).some((v) => v?.length)) {
    out.push(`Specs measured on ${lead.host}${pins.some((p) => p.categories?.includes('Component')) ? ' (tagged Component)' : ''}. Values are exact computed styles; states come from the site’s CSS.`, '');
    if (c.buttons?.length) {
      out.push('### Button', '');
      const names = buttonNames(c.buttons, primaryHex);
      // Primary first, then the rest in the order they're used.
      c.buttons.map((v, i) => [names[i], v]).sort((a, b) => (a[0] === 'Primary' ? -1 : b[0] === 'Primary' ? 1 : 0))
        .forEach(([name, v]) => out.push(...componentSpec(`${name} button`, v)));
    }
    if (c.inputs?.length) out.push('### Input', '', ...c.inputs.flatMap((v, i) => componentSpec(i ? `Input ${i + 1}` : 'Text input', v)));
    if (c.cards?.length) out.push('### Card', '', ...c.cards.flatMap((v, i) => componentSpec(i ? `Card ${i + 1}` : 'Card', v)));
    if (c.badges?.length) out.push('### Badge', '', ...c.badges.flatMap((v, i) => componentSpec(i ? `Badge ${i + 1}` : 'Badge', v)));
    if (c.links?.length) out.push('### Link', '', ...c.links.flatMap((v) => componentSpec('Text link', v)));
  }
  const sections = pins.filter((p) => p.kind === 'element');
  if (sections.length) {
    out.push('### Patterns you picked', '', 'Sections saved from the references. Rebuild the pattern with this project’s tokens; match the intent, not the pixels.', '');
    for (const p of sections) {
      const f = filesOf(p);
      const ks = p.analysis?.keyStyles || {};
      const layout = ['display', 'flex-direction', 'justify-content', 'align-items', 'gap', 'grid-template-columns', 'padding', 'max-width', 'position']
        .filter((k) => ks[k]).map((k) => [k, code(hexify(ks[k]))]);
      const look = ['background-color', 'background-image', 'color', 'border', 'border-radius', 'box-shadow', 'backdrop-filter', 'font-family', 'font-size', 'font-weight', 'transition']
        .filter((k) => ks[k]).map((k) => [k, code(hexify(ks[k]))]);
      out.push(`#### ${p.title}`, '', `- **From:** ${p.hostname} (${p.url})`, `- **Screenshot:** ${code(f.screenshot)}`, `- **Intent:** ${p.note || '_no note_'}`);
      if (p.analysis?.size) out.push(`- **Size when captured:** ${p.analysis.size.width}×${p.analysis.size.height}px`);
      out.push('');
      if (layout.length) out.push('Layout:', '', table(['Property', 'Value'], layout), '');
      if (look.length) out.push('Look:', '', table(['Property', 'Value'], look), '');
    }
  }
  return out.length > 2 ? out : [];
}

function motionSection(pins, sites, mt) {
  const recordings = pins.filter((p) => p.kind === 'recording');
  const keyframes = sites.flatMap((s) => (s.sys.keyframes || []).filter((k) => k.used).map((k) => ({ ...k, host: s.host })));
  const loops = sites.flatMap((s) => (s.sys.runningAnimations || []).filter((a) => a.iterations === 'infinite').map((a) => ({ ...a, host: s.host })));
  const seenHover = new Set();
  const hovers = sites.flatMap((s) => Object.entries(s.sys.components || {}).flatMap(([kind, list]) => (list || []).filter((v) => v.transition && v.states?.hover).map((v) => ({ kind, v, host: s.host }))))
    .filter(({ kind, v }) => {
      const key = kind + JSON.stringify(v.states.hover) + v.transition;
      return !seenHover.has(key) && seenHover.add(key);
    });
  if (!recordings.length && !keyframes.length && !mt.durationTokens.length && !hovers.length) return [];
  const out = ['## 7. Motion & interaction', ''];
  if (mt.durationTokens.length || mt.easingTokens.length) {
    out.push('### Motion tokens', '');
    out.push(table(['Token', 'Value', 'Source'], [...mt.durationTokens.map((d) => [code(d.token), `${d.ms}ms`, d.sources.join(', ')]), ...mt.easingTokens.map((e) => [code(e.token), code(e.value), e.sources.join(', ')])]), '');
  }
  if (recordings.length) {
    out.push('### Recorded effects', '', 'Each recording has a video, a contact sheet (key frames in one image, numbered with timestamps) and the individual frames. Open the contact sheet to see the motion; the numbers below are measured from the live page.', '');
    recordings.forEach((p, i) => {
      const f = filesOf(p);
      const m = motionOf(p);
      out.push(`#### R${i + 1}. ${p.title}`, '');
      out.push(`- **From:** ${p.hostname} (${p.url})`);
      if (p.note) out.push(`- **What I want:** ${p.note}`);
      out.push(`- **Files:** video ${code(f.video)}, contact sheet ${code(f.contactSheet)}, ${plural((f.frames || []).length, 'frame')} in ${code((f.frames?.[0] || '').split('/').slice(0, 2).join('/') + '/')}`);
      out.push(`- **Recorded area:** ${p.region?.width}×${p.region?.height}px for ${(p.duration / 1000).toFixed(1)}s`);
      out.push(`- **Summary:** ${m.summary}`, '');
      if (m.effects.length) {
        out.push(table(['#', 'Trigger', 'What happens', 'Duration', 'Easing', 'Stagger'], m.effects.slice(0, 12).map((e, j) => [j + 1, e.trigger.text, e.what || e.text, e.duration ? `${e.duration}ms${e.durationSource === 'measured' ? ' (measured)' : ''}` : 'follows scroll', e.easing ? code(e.easing) : '—', e.stagger ? `${e.stagger}ms` : '—'])), '');
        const snippets = m.effects.filter((e) => e.css).slice(0, 4);
        if (snippets.length) out.push('Starting point:', '', '```css', snippets.map((e) => `/* ${e.name} — ${e.trigger.text} */\n${e.css}`).join('\n\n'), '```', '');
      }
    });
  }
  if (hovers.length) {
    out.push('### Interaction feedback', '', table(['Component', 'Hover / focus change', 'Transition', 'Source'], hovers.slice(0, 8).map(({ kind, v, host }) => [kind.replace(/s$/, ''), Object.entries(v.states.hover).map(([k, val]) => `${k}: ${val}`).join('; '), code(v.transition), host])), '');
  }
  if (keyframes.length || loops.length) {
    out.push('### Keyframe animations used by the sites', '');
    for (const k of keyframes.slice(0, 6)) out.push(`- ${code(k.name)} (${k.host})`, '', '```css', k.css, '```', '');
    for (const a of loops.slice(0, 6)) out.push(`- Looping: ${code(a.name)} on ${code(a.target)}, ${a.duration}ms (${a.host})`);
    if (loops.length) out.push('');
  }
  out.push('### Motion rules', '', '- Animate `transform` and `opacity` only (plus color for hovers); never animate layout properties like width/top.', '- Wrap every non-essential animation in `@media (prefers-reduced-motion: no-preference)`.', '- Scroll reveals: add a class with an IntersectionObserver (threshold ≈ 0.2) and use the recorded duration, easing and stagger.', '- Reuse the motion tokens above instead of new durations.', '');
  return out;
}

function rulesSection(tokens, sites, pins) {
  const doList = [];
  const dont = [];
  const lead = leadSite(pins, sites, 'Component');
  const base = sites.map((s) => s.sys.spacing?.base).find(Boolean);
  if (tokens.colors.items.length) doList.push('Use color tokens by role (primary, surface, text-*) and the contrast pairings above.');
  if (base) doList.push(`Keep spacing on the ${base}px grid.`);
  const btn = lead?.sys.components?.buttons?.[0];
  if (btn?.styles['border-radius']) doList.push(`Give buttons the measured shape: radius ${btn.styles['border-radius']}, padding ${btn.styles.padding || '—'}.`);
  doList.push('Include hover, focus-visible and active states for every interactive element.');
  doList.push('Follow the intent in the notes for each reference.');
  dont.push('Copy logos, product names, copy, photos or illustrations from the reference sites.');
  dont.push('Add colors, font sizes, radii or durations that aren’t tokens.');
  dont.push('Use the Primary color for large backgrounds unless a reference explicitly does.');
  dont.push('Ship motion without a reduced-motion fallback.');
  return ['## 8. Do’s and don’ts', '', '**Do**', '', ...doList.map((x) => `- ${x}`), '', '**Don’t**', '', ...dont.map((x) => `- ${x}`), ''];
}

function tailwindTheme(tokens, pins, mt) {
  const base = pins.map((p) => siteOf(p)?.spacing?.base).find(Boolean);
  const colors = Object.fromEntries(tokens.colors.items.map((c) => [c.token.replace('--color-', ''), `var(${c.token})`]));
  const theme = {
    colors,
    fontFamily: Object.fromEntries(tokens.fonts.items.map((f) => [fontTokenNames(tokens.fonts.items).get(f), f.stack.split(',').map((x) => x.trim().replace(/^["']|["']$/g, ''))])),
    fontSize: Object.fromEntries(tokens.typeScale.items.filter((t) => t.name).map((t) => [t.name.replace('text-', ''), t.size])),
    spacing: base ? Object.fromEntries([1, 2, 3, 4, 6, 8, 12, 16, 24].map((n) => [n, `${n * base}px`])) : undefined,
    borderRadius: Object.fromEntries(tokens.radii.items.map((r, i) => [`r${i + 1}`, r.value])),
    boxShadow: Object.fromEntries(tokens.shadows.items.map((s, i) => [`e${i + 1}`, s.value])),
    transitionDuration: Object.fromEntries(mt.durationTokens.map((d) => [d.token.replace('--duration-', ''), `${d.ms}ms`])),
    transitionTimingFunction: Object.fromEntries(mt.easingTokens.map((e) => [e.token.replace('--ease-', ''), e.value])),
  };
  return `// Generated by Refboard. Merge into tailwind.config.js → theme.extend\n// Colors point at the CSS variables in tokens.css.\nmodule.exports = ${JSON.stringify(theme, null, 2)};\n`;
}

export function buildProjectDesignMd(board, pins, opts = {}) {
  const tokens = consolidate(pins);
  const sites = sitesOf(pins);
  const mt = motionTokens(pins, sites);
  const counts = ['page', 'element', 'recording'].map((k) => [k, pins.filter((p) => p.kind === k).length]).filter(([, n]) => n);
  const date = new Date(opts.date || Date.now()).toISOString().slice(0, 10);
  const out = [
    `# ${board.name} — Design System`,
    '',
    `> Built by Refboard on ${date} from ${plural(pins.length, 'reference')} (${counts.map(([k, n]) => plural(n, KIND_LABEL[k].toLowerCase())).join(', ')}) across ${plural(sites.length || new Set(pins.map((p) => p.hostname)).size, 'site')}. This is the source of truth for UI work in this project: tokens live in \`tokens.css\`, screenshots in \`screenshots/\`, recordings and their key frames in \`recordings/\` and \`frames/\`.`,
    '',
    '**Contents:** 1. Visual direction · 2. Color · 3. Typography · 4. Spacing & layout · 5. Shape & elevation · 6. Components · 7. Motion & interaction · 8. Do’s and don’ts · 9. Implementation',
    '',
    ...visualDirection(pins, sites, tokens),
    ...colorSection(tokens, sites),
    ...typographySection(tokens, sites, pins),
    ...spacingSection(pins, sites),
    ...shapeSection(tokens),
    ...componentsSection(pins, sites, tokens),
    ...motionSection(pins, sites, mt),
    ...rulesSection(tokens, sites, pins),
    '## 9. Implementation',
    '',
    '- Import `tokens.css` once (e.g. in your global stylesheet) and use the variables everywhere.',
    '- Using Tailwind? Merge `tailwind.theme.js` into `theme.extend`; it maps every token.',
    '- Machine-readable tokens (W3C design-token format) are in `tokens.json`.',
    sites.length ? `- Full measured systems per source site: ${sites.map((s) => code(`sites/${slug(s.host, 40)}.DESIGN.md`)).join(', ')}.` : null,
    '',
  ];
  return out.filter((x) => x !== null).join('\n');
}

export function buildProjectSkillMd(board, pins, opts = {}) {
  const tokens = consolidate(pins);
  const sites = sitesOf(pins);
  const mt = motionTokens(pins, sites);
  const name = `${slug(board.name, 40)}-design`;
  const recordings = pins.filter((p) => p.kind === 'recording');
  const base = sites.map((s) => s.sys.spacing?.base).find(Boolean);
  const fonts = tokens.fonts.items.map((f) => `${f.family} (${f.usage?.join('/') || 'text'})`).join(', ');
  const kinds = [pins.some((p) => p.kind !== 'recording') && 'screenshots', recordings.length && 'screen recordings'].filter(Boolean).join(' and ');
  return [
    '---',
    `name: ${name}`,
    `description: Design system and visual references for ${board.name}: colors, typography, spacing, components with hover/focus states, and motion, measured from ${plural(pins.length, 'saved reference')} with ${kinds || 'captures'}. Use whenever building, styling, animating or reviewing UI for ${board.name}.`,
    '---',
    '',
    `# ${board.name} design`,
    '',
    'This folder is a design brief collected with Refboard. Everything in it was measured from real websites the user saved, with their notes on what to take from each.',
    '',
    '## Files',
    '',
    table(['File', 'Use it for'], [
      [code('DESIGN.md'), 'The full design system: color, type, spacing, components, motion, rules. Read the relevant section before coding.'],
      [code('tokens.css'), 'CSS variables for every token. Import it and use the variables.'],
      [code('tailwind.theme.js'), 'The same tokens as a Tailwind `theme.extend`.'],
      [code('references.md'), 'Every capture with the user’s note and file paths.'],
      [code('screenshots/'), 'What each saved page or section looks like.'],
      recordings.length ? [code('frames/*/contact-sheet.jpg'), 'Key frames of each recording in one image, numbered with timestamps. This is how you see the motion.'] : null,
      recordings.length ? [code('recordings/'), 'The original videos (for humans; you cannot play them).'] : null,
      sites.length ? [code('sites/'), 'The complete measured system of each source site.'] : null,
    ].filter(Boolean)),
    '',
    '## Workflow',
    '',
    '1. Read `references.md` to understand what the user wants from each reference.',
    '2. Look at the screenshots, and the contact sheets for anything that moves.',
    '3. Read the matching sections of `DESIGN.md` (components and motion have exact values and states).',
    '4. If the project already has a theme, map these tokens onto it; otherwise add `tokens.css`.',
    '5. Build. Then check the list below before you finish.',
    '',
    '## Quick reference',
    '',
    tokens.colors.items.length ? `- **Colors:** ${tokens.colors.items.slice(0, 8).map((c) => `${c.role} ${code(c.hex)}`).join(', ')}` : null,
    fonts ? `- **Fonts:** ${fonts}` : null,
    base ? `- **Spacing:** ${base}px grid` : null,
    tokens.radii.items.length ? `- **Radius:** ${tokens.radii.items.map((r) => r.value).join(', ')}` : null,
    mt.durationTokens.length ? `- **Motion:** ${mt.durationTokens.map((d) => `${d.ms}ms`).join(' / ')}${mt.easingTokens[0] ? ` with ${code(mt.easingTokens[0].value)}` : ''}` : null,
    '',
    recordings.length ? '## Motion to reproduce' : null,
    recordings.length ? '' : null,
    ...recordings.flatMap((p, i) => {
      const m = motionOf(p);
      const f = filesOf(p);
      return [`- **R${i + 1}. ${p.title}** (${code(f.contactSheet)})${p.note ? `: ${p.note}` : ''}`, ...(m.effects.length ? m.effects.slice(0, 5).map((e) => `  - ${e.text}`) : [`  - ${m.summary}`])];
    }),
    recordings.length ? '' : null,
    '## Rules',
    '',
    '- Use tokens only; no new hex values, sizes, radii or durations.',
    '- Every interactive element gets hover, focus-visible and active states (see DESIGN.md §6).',
    '- Animate transform/opacity; respect `prefers-reduced-motion`.',
    '- Match the intent of the notes, not the pixels. Never copy logos, brand names, copy or imagery.',
    '',
    '## Before you finish',
    '',
    '- [ ] Colors, type, spacing and radii come from the tokens',
    '- [ ] Text/background pairs are AA (see DESIGN.md §2 contrast table)',
    '- [ ] Hover, focus and active states exist and match §6',
    recordings.length ? '- [ ] Motion matches the recorded trigger, duration, easing and stagger (§7)' : null,
    '- [ ] Works at the breakpoints in §4',
    '',
  ].filter((x) => x !== null).join('\n');
}

export function buildProjectPrompt(board, pins) {
  return [
    `# Build brief: ${board.name}`,
    '',
    `I collected ${plural(pins.length, 'design reference')} for ${board.name} with Refboard. This folder has everything: \`DESIGN.md\` (the design system), \`tokens.css\`, screenshots, and for animations, recordings with key-frame contact sheets.`,
    '',
    '## What I want',
    '',
    ...pins.map((p, i) => `${i + 1}. **${p.title}** (${KIND_LABEL[p.kind] || p.kind} from ${p.hostname}): ${p.note || 'see the capture'}${p.categories?.length ? ` _(focus: ${p.categories.join(', ')})_` : ''}`),
    '',
    '## How to work',
    '',
    '1. Read `SKILL.md`, then `references.md` and the relevant parts of `DESIGN.md`.',
    '2. Reply first with a short plan: tokens to add, components to build, motion to implement, and any questions.',
    '3. Build reusable, accessible components with the tokens; match the intent of each note, not a pixel copy.',
    '4. Don’t copy logos, brand names, text or images from the reference sites.',
    '',
  ].join('\n');
}

export function buildReferencesMd(board, pins) {
  const out = [`# References — ${board.name}`, '', `${plural(pins.length, 'capture')}, newest last.`, ''];
  pins.forEach((p, i) => {
    const f = filesOf(p);
    out.push(`## ${i + 1}. ${p.title}`, '');
    out.push(`- **Type:** ${KIND_LABEL[p.kind] || p.kind}${p.source === 'shortcut' ? ' (shortcut)' : ''}`);
    out.push(`- **Site:** ${p.hostname} — ${p.url}`);
    out.push(`- **Saved:** ${new Date(p.createdAt).toISOString().slice(0, 16).replace('T', ' ')}`);
    out.push(`- **Note:** ${p.note || '_none_'}`);
    if (p.categories?.length) out.push(`- **Focus:** ${p.categories.join(', ')}`);
    if (p.tags?.length) out.push(`- **Tags:** ${p.tags.join(', ')}`);
    if (f.screenshot) out.push(`- **Screenshot:** ${code(f.screenshot)}`);
    if (f.video) out.push(`- **Video:** ${code(f.video)}`);
    if (f.contactSheet) out.push(`- **Contact sheet:** ${code(f.contactSheet)}`);
    if (p.kind === 'element' && p.analysis?.selector) out.push(`- **Element:** ${code(p.analysis.selector)}${p.analysis.size ? `, ${p.analysis.size.width}×${p.analysis.size.height}px` : ''}`);
    if (p.kind === 'recording') {
      const m = motionOf(p);
      out.push(`- **Motion:** ${m.summary}`);
      for (const e of m.effects.slice(0, 6)) out.push(`  - ${e.text}`);
    }
    const sys = siteOf(p);
    if (sys?.colors) out.push(`- **Site character:** ${siteSummary(sys)}`);
    out.push('');
  });
  return out.join('\n');
}

export function buildTokensJson(tokens, pins, mt) {
  const base = pins.map((p) => siteOf(p)?.spacing?.base).find(Boolean);
  const group = (entries, type) => Object.fromEntries(entries.map(([k, v]) => [k, { $value: v, $type: type }]));
  const json = {
    color: group(tokens.colors.items.map((c) => [c.token.replace('--color-', ''), c.hex]), 'color'),
    fontFamily: group(tokens.fonts.items.map((f) => [fontTokenNames(tokens.fonts.items).get(f), f.stack.split(',').map((x) => x.trim().replace(/^["']|["']$/g, ''))]), 'fontFamily'),
    fontSize: group(tokens.typeScale.items.filter((t) => t.name).map((t) => [t.name.replace('text-', ''), t.size]), 'dimension'),
    spacing: base ? group([1, 2, 3, 4, 6, 8, 12, 16, 24].map((n) => [String(n), `${n * base}px`]), 'dimension') : {},
    radius: group(tokens.radii.items.map((r, i) => [`r${i + 1}`, r.value]), 'dimension'),
    shadow: group(tokens.shadows.items.map((s, i) => [`e${i + 1}`, s.value]), 'shadow'),
    duration: group(mt.durationTokens.map((d) => [d.token.replace('--duration-', ''), `${d.ms}ms`]), 'duration'),
    easing: group(mt.easingTokens.map((e) => [e.token.replace('--ease-', ''), e.value]), 'cubicBezier'),
  };
  return JSON.stringify(json, null, 2) + '\n';
}

function buildTokensCssFull(tokens, pins, mt) {
  const lines = ['/* Generated by Refboard. Import once, then use the variables. */', ':root {', '  /* color */'];
  for (const c of tokens.colors.items) lines.push(`  ${c.token}: ${c.hex};`);
  lines.push('  /* type */');
  const fontNames = fontTokenNames(tokens.fonts.items);
  tokens.fonts.items.forEach((f) => lines.push(`  --font-${fontNames.get(f)}: ${f.stack};`));
  const sizes = [...new Map(tokens.typeScale.items.filter((t) => t.name).map((t) => [t.name, t])).values()].sort((a, b) => parseFloat(a.size) - parseFloat(b.size));
  for (const t of sizes) lines.push(`  --${t.name}: ${t.size};`);
  const base = pins.map((p) => siteOf(p)?.spacing?.base).find(Boolean);
  if (base) {
    lines.push('  /* spacing */');
    for (const n of [1, 2, 3, 4, 6, 8, 12, 16, 24]) lines.push(`  --space-${n}: ${n * base}px;`);
  }
  if (tokens.radii.items.length) lines.push('  /* radius */', ...tokens.radii.items.map((r, i) => `  --radius-${i + 1}: ${r.value};`));
  if (tokens.shadows.items.length) lines.push('  /* elevation */', ...tokens.shadows.items.map((s, i) => `  --shadow-${i + 1}: ${s.value};`));
  if (mt.durationTokens.length || mt.easingTokens.length) {
    lines.push('  /* motion */', ...mt.durationTokens.map((d) => `  ${d.token}: ${d.ms}ms;`), ...mt.easingTokens.map((e) => `  ${e.token}: ${e.value};`));
  }
  lines.push('}', '', '@media (prefers-reduced-motion: reduce) {', '  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }', '}', '');
  return lines.join('\n');
}

// Pin metadata without the heavy image/video data, so the board can be rebuilt from the folder.
export function buildRestoreJson(board, pins, opts = {}) {
  const lite = pins.map(({ image, thumb, video, frames, contactSheet, ...p }) => ({ ...p, files: filesOf({ image, video, frames, contactSheet, ...p }), frameTimes: (frames || []).map((f) => f.t) }));
  return JSON.stringify({ app: 'refboard', version: 3, generatedAt: new Date(opts.date || Date.now()).toISOString(), project: board, pins: lite }) + '\n';
}

// Everything Build writes (text files; media is written when captured).
export function buildProjectFiles(board, pins, opts = {}) {
  const ordered = [...pins].sort((a, b) => a.createdAt - b.createdAt);
  const tokens = consolidate(ordered);
  const sites = sitesOf(ordered);
  const mt = motionTokens(ordered, sites);
  const files = [
    { name: 'SKILL.md', data: buildProjectSkillMd(board, ordered, opts) },
    { name: 'DESIGN.md', data: buildProjectDesignMd(board, ordered, opts) },
    { name: 'PROMPT.md', data: buildProjectPrompt(board, ordered) },
    { name: 'references.md', data: buildReferencesMd(board, ordered) },
    { name: 'tokens.css', data: buildTokensCssFull(tokens, ordered, mt) },
    { name: 'tokens.json', data: buildTokensJson(tokens, ordered, mt) },
    { name: 'tailwind.theme.js', data: tailwindTheme(tokens, ordered, mt) },
    { name: 'refboard.json', data: buildRestoreJson(board, ordered, opts) },
  ];
  for (const s of sites) files.push({ name: `sites/${slug(s.host, 40)}.DESIGN.md`, data: buildSiteDesignMd(s.pin, opts) });
  return files;
}
