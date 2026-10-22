// Turns raw motion data recorded on a page (content/motion.js) into a list of
// effects that a coding agent can implement: trigger, targets, what changes,
// timing (exact from CSS when available, otherwise measured), stagger, and a
// CSS starting point. Pure functions, no browser APIs.

const SAMPLE_MS = 100;

/* ---------- value parsing ---------- */

export function parseTransform(v) {
  const id = { tx: 0, ty: 0, scale: 1, rotate: 0 };
  if (!v || v === 'none') return id;
  const m3 = v.match(/^matrix3d\(([^)]+)\)/);
  const m2 = v.match(/^matrix\(([^)]+)\)/);
  let a, b, e, f;
  if (m3) {
    const n = m3[1].split(',').map(parseFloat);
    [a, b, e, f] = [n[0], n[1], n[12], n[13]];
  } else if (m2) {
    const n = m2[1].split(',').map(parseFloat);
    [a, b, e, f] = [n[0], n[1], n[4], n[5]];
  } else return id;
  return { tx: Math.round(e), ty: Math.round(f), scale: Math.round(Math.hypot(a, b) * 100) / 100, rotate: Math.round((Math.atan2(b, a) * 180) / Math.PI) };
}

const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');
function hexColor(v) {
  const m = String(v).match(/rgba?\(([^)]+)\)/);
  if (!m) return v;
  const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
  if (a < 0.05) return 'transparent';
  return '#' + hex2(r) + hex2(g) + hex2(b) + (a < 1 ? hex2(a * 255) : '');
}

const ms = (v) => (String(v).endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000);

// "opacity 0.6s cubic-bezier(...) 0.1s, transform 0.6s ease" → { opacity: {...}, transform: {...} }
export function parseTransitions(css) {
  const out = {};
  if (!css || css === 'none' || /^all 0s/.test(css)) return out;
  for (const part of css.split(/,(?![^(]*\))/)) {
    const tokens = part.trim().match(/[^\s(]+(\([^)]*\))?/g) || [];
    const prop = tokens.find((t) => /^[a-z-]+$/.test(t) && !/^(ease|linear|ease-in|ease-out|ease-in-out|step-start|step-end)$/.test(t)) || 'all';
    const times = tokens.filter((t) => /^-?[\d.]+m?s$/.test(t));
    const easing = tokens.find((t) => /^(ease|linear|ease-in|ease-out|ease-in-out|cubic-bezier\(|steps\()/.test(t)) || 'ease';
    const duration = times[0] ? ms(times[0]) : 0;
    if (duration > 0) out[prop] = { duration, delay: times[1] ? ms(times[1]) : 0, easing };
  }
  return out;
}

/* ---------- describing one property change ---------- */

const CSS_PROP = { backgroundColor: 'background-color', clipPath: 'clip-path', boxShadow: 'box-shadow', borderRadius: 'border-radius' };
export const cssProp = (p) => CSS_PROP[p] || p;

export function describeChange(prop, from, to) {
  if (prop === 'opacity') {
    const a = parseFloat(from);
    const b = parseFloat(to);
    if (Math.abs(a - b) < 0.05) return null;
    return { text: b > a ? `fades in (opacity ${a} → ${b})` : `fades out (opacity ${a} → ${b})`, from: String(a), to: String(b) };
  }
  if (prop === 'transform') {
    const a = parseTransform(from);
    const b = parseTransform(to);
    const bits = [];
    const dy = b.ty - a.ty;
    const dx = b.tx - a.tx;
    if (Math.abs(dy) >= 2) bits.push(`moves ${dy < 0 ? 'up' : 'down'} ${Math.abs(dy)}px`);
    if (Math.abs(dx) >= 2) bits.push(`moves ${dx < 0 ? 'left' : 'right'} ${Math.abs(dx)}px`);
    if (Math.abs(b.scale - a.scale) >= 0.02) bits.push(`scales ${a.scale} → ${b.scale}`);
    if (Math.abs(b.rotate - a.rotate) >= 2) bits.push(`rotates ${a.rotate}° → ${b.rotate}°`);
    if (!bits.length) return null;
    const fmt = (t) => [t.tx || t.ty ? `translate(${t.tx}px, ${t.ty}px)` : '', t.scale !== 1 ? `scale(${t.scale})` : '', t.rotate ? `rotate(${t.rotate}deg)` : ''].filter(Boolean).join(' ') || 'none';
    return { text: bits.join(', '), from: fmt(a), to: fmt(b) };
  }
  if (prop === 'position') {
    const [, y1] = String(from).split(',').map(Number);
    const [, y2] = String(to).split(',').map(Number);
    if (Math.abs(y2 - y1) < 3) return null;
    return { text: `moves on the page while scrolling (${y2 - y1 > 0 ? '+' : ''}${y2 - y1}px vertically): sticky or parallax`, from, to };
  }
  if (prop === 'backgroundColor' || prop === 'color') {
    const a = hexColor(from);
    const b = hexColor(to);
    if (a === b) return null;
    return { text: `${prop === 'color' ? 'text color' : 'background'} changes ${a} → ${b}`, from: a, to: b };
  }
  if (prop === 'filter') return { text: `filter changes ${from} → ${to}`, from, to };
  if (prop === 'clipPath') return { text: 'is revealed with a clip-path animation', from, to };
  if (prop === 'boxShadow') return { text: 'shadow changes (elevation)', from: hexColor(from), to: hexColor(to) };
  if (prop === 'width' || prop === 'height') {
    if (Math.abs(parseFloat(from) - parseFloat(to)) < 2) return null;
    return { text: `${prop} ${Math.round(parseFloat(from))}px → ${Math.round(parseFloat(to))}px`, from, to };
  }
  if (prop === 'borderRadius') return { text: `corner radius ${from} → ${to}`, from, to };
  return null;
}

/* ---------- triggers ---------- */

function triggerFor(t, events, alreadyRunning) {
  if (alreadyRunning) return { type: 'loop', text: 'runs continuously (already playing when recording started)' };
  const before = events.filter((e) => e.t <= t + 50 && t - e.t <= 700).sort((a, b) => b.t - a.t);
  const hover = before.find((e) => e.type === 'hover');
  const click = before.find((e) => e.type === 'click');
  const scroll = before.find((e) => e.type === 'scroll');
  if (click && (!scroll || click.t >= scroll.t)) return { type: 'click', text: `on click${click.text ? ` ("${click.text}")` : ''}`, target: click.target };
  if (hover && (!scroll || hover.t >= scroll.t - 100)) return { type: 'hover', text: `on hover${hover.text ? ` over "${hover.text}"` : ''}`, target: hover.target };
  if (scroll) return { type: 'scroll', text: 'when it scrolls into view' };
  if (t < 400) return { type: 'load', text: 'on page load / immediately' };
  return { type: 'time', text: `automatically after ~${Math.round(t / 100) / 10}s` };
}

/* ---------- main ---------- */

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

function isLoop(series) {
  // Many changes that keep coming back to earlier values → an oscillating loop.
  if (series.length < 8) return false;
  const values = series.map((s) => s[1]);
  return new Set(values).size < values.length * 0.8;
}

export function analyzeMotion(data) {
  if (!data) return { effects: [], durations: [], easings: [], summary: 'No motion data was recorded.' };
  const events = data.events || [];
  const effects = [];
  const explained = new Set(); // "selector|prop" covered by a CSS animation/transition

  // 1. Keyframe animations the browser reported (exact data).
  const byName = new Map();
  for (const a of data.animations.filter((x) => x.type !== 'transition')) {
    const key = `${a.name}|${a.duration}|${a.easing}`;
    const g = byName.get(key) || { ...a, targets: [], starts: [] };
    if (g.targets.length < 12) g.targets.push({ selector: a.target, text: a.targetText });
    g.starts.push(a.seenAt);
    byName.set(key, g);
  }
  for (const g of byName.values()) {
    const props = [...new Set(g.keyframes.flatMap((k) => Object.keys(k).filter((p) => !['offset', 'easing'].includes(p))))];
    g.targets.forEach((t) => props.forEach((p) => explained.add(`${t.selector}|${p}`)));
    const trig = triggerFor(Math.min(...g.starts), events, g.alreadyRunning || g.iterations === 'infinite');
    effects.push({
      kind: 'keyframes',
      name: g.name || 'animation',
      trigger: trig,
      targets: g.targets,
      count: g.starts.length,
      properties: props,
      duration: g.duration,
      durationSource: 'css',
      delay: g.delay,
      easing: g.easing,
      iterations: g.iterations,
      direction: g.direction,
      stagger: staggerOf(g.starts),
      keyframes: g.keyframes,
      what: `${capital(targetText(g.targets, g.starts.length))}: \`@keyframes ${g.name || 'animation'}\` animates ${props.map(cssProp).join(', ') || 'properties'}${g.iterations === 'infinite' ? ' in a loop' : ''}`,
      text: `\`@keyframes ${g.name || 'animation'}\` on ${targetText(g.targets, g.starts.length)} ${trig.text}: animates ${props.map(cssProp).join(', ') || 'properties'} over ${g.duration}ms (${g.easing})${g.iterations === 'infinite' ? ', looping forever' : g.iterations > 1 ? `, ${g.iterations} times` : ''}.`,
    });
  }

  // 2. Measured changes, grouped into effects (same change + trigger).
  const groups = new Map();
  for (const c of data.changes || []) {
    const first = c.series[1];
    const last = c.series[c.series.length - 1];
    const loop = isLoop(c.series);
    const d = describeChange(c.prop, c.series[0][1], loop ? c.series[0][1] : last[1]);
    if (!d && !loop) continue;
    const tStart = first[0];
    const tEnd = last[0];
    const css = parseTransitions(c.transition);
    const cssTiming = css[cssProp(c.prop)] || css.all;
    const trig = c.prop === 'position' ? { type: 'scroll', text: 'while scrolling' } : triggerFor(tStart, events, false);
    const sig = `${c.prop}|${loop ? 'loop' : d.text.replace(/\d+/g, (n) => Math.round(n / 4) * 4)}|${trig.type}`;
    const g = groups.get(sig) || { prop: c.prop, change: d, loop, trigger: trig, items: [] };
    g.items.push({ selector: c.selector, text: c.text, tStart, tEnd, cssTiming, animation: c.animation });
    groups.set(sig, g);
  }

  for (const g of groups.values()) {
    const items = g.items.sort((a, b) => a.tStart - b.tStart);
    const already = items.filter((i) => explained.has(`${i.selector}|${cssProp(g.prop)}`) || explained.has(`${i.selector}|${g.prop}`));
    if (already.length === items.length) continue;
    const timing = items.find((i) => i.cssTiming)?.cssTiming;
    const measured = Math.max(SAMPLE_MS, median(items.map((i) => i.tEnd - i.tStart)) + SAMPLE_MS);
    const stagger = staggerOf(items.map((i) => i.tStart));
    const what = g.loop ? `keeps animating ${cssProp(g.prop)} in a loop` : g.change.text;
    const timeText = timing
      ? `over ${timing.duration}ms (${timing.easing}${timing.delay ? `, ${timing.delay}ms delay` : ''}), from its CSS transition`
      : `over ~${measured}ms (measured; easing not exposed, likely JavaScript-driven)`;
    effects.push({
      kind: g.prop === 'position' ? 'scroll-linked' : timing ? 'transition' : 'measured',
      name: what,
      trigger: g.trigger,
      targets: items.slice(0, 12).map((i) => ({ selector: i.selector, text: i.text })),
      count: items.length,
      properties: [cssProp(g.prop)],
      from: g.change?.from,
      to: g.change?.to,
      duration: g.prop === 'position' ? null : timing ? timing.duration : measured,
      durationSource: g.prop === 'position' ? 'scroll' : timing ? 'css' : 'measured',
      delay: timing?.delay || 0,
      easing: timing?.easing || null,
      stagger,
      startsAt: items[0].tStart,
      targetKey: items.map((i) => i.selector).sort().join('|'),
      what: `${capital(targetText(items, items.length))} ${what}`,
      text: `${capital(targetText(items, items.length))} ${what} ${g.prop === 'position' ? '' : g.trigger.text + ' '}${g.prop === 'position' ? '' : timeText}${stagger ? `, one after another every ~${stagger}ms` : ''}.`.replace(/\s+\./, '.'),
    });
  }

  // 3. Transitions the browser reported that weren't sampled (e.g. tiny hover effects),
  //    grouped so that the same transition on several elements shows its stagger.
  const covered = (t) => effects.some((e) => e.targets.some((x) => x.selector === t.target) && e.properties.includes(t.name));
  const tGroups = new Map();
  for (const t of data.animations.filter((x) => x.type === 'transition')) {
    if ([...explained].some((k) => k.startsWith(`${t.target}|`)) || covered(t)) continue;
    const trig = triggerFor(t.seenAt, events, false);
    const key = `${t.target}|${t.name}|${t.duration}|${t.easing}|${trig.type}`;
    const g = tGroups.get(key) || { ...t, trig, starts: [], texts: [] };
    g.starts.push(t.seenAt);
    if (t.targetText && g.texts.length < 3) g.texts.push(t.targetText);
    tGroups.set(key, g);
  }
  for (const g of tGroups.values()) {
    const targets = [{ selector: g.target, text: g.texts[0] || g.targetText }];
    const count = g.starts.length;
    const stagger = staggerOf(g.starts);
    effects.push({
      kind: 'transition', name: `transitions ${g.name}`, trigger: g.trig, targets, count,
      properties: [g.name], duration: g.duration, durationSource: 'css', delay: g.delay, easing: g.easing, stagger, startsAt: Math.min(...g.starts),
      targetKey: `${g.target}#${count}`,
      what: `${capital(targetText(targets, count))} transitions ${g.name}`,
      text: `${capital(targetText(targets, count))} transitions ${g.name} ${g.trig.text} over ${g.duration}ms (${g.easing})${stagger ? `, one after another every ~${stagger}ms` : ''}.`,
    });
  }

  // What the user triggered first (in time order), background loops last.
  effects.sort((a, b) => (a.trigger.type === 'loop') - (b.trigger.type === 'loop') || (a.startsAt ?? 0) - (b.startsAt ?? 0));
  mergeCompanions(effects);
  for (const e of effects) e.css = cssSnippet(e);

  const durations = [...new Set(effects.filter((e) => e.durationSource === 'css' && e.duration).map((e) => e.duration))].sort((a, b) => a - b);
  const easings = [...new Set(effects.map((e) => e.easing).filter((x) => x && x !== 'linear'))];
  const scrolled = (data.scroll || []).length ? Math.abs(data.scroll.at(-1)[2] - data.scroll[0][2]) : 0;
  const triggers = [...new Set(effects.map((e) => e.trigger.type))];
  const summary = effects.length
    ? `${effects.length} effect${effects.length === 1 ? '' : 's'} over ${(data.duration / 1000).toFixed(1)}s${scrolled ? `, scrolled ${scrolled}px` : ''}. Triggers: ${triggers.join(', ')}.`
    : `No animation was detected in the recorded area during ${(data.duration / 1000).toFixed(1)}s. The recording and frames still show the visual result.`;
  return { effects: effects.slice(0, 40), durations, easings, summary, scrolled, duration: data.duration };
}

// "Fades in" and "moves up 40px" on the same elements at the same moment are one
// effect ("fades in and moves up 40px"), so merge them.
function mergeCompanions(effects) {
  for (let i = 0; i < effects.length; i++) {
    const a = effects[i];
    if (!a.targetKey || a.kind === 'scroll-linked') continue;
    for (let j = effects.length - 1; j > i; j--) {
      const b = effects[j];
      if (b.targetKey !== a.targetKey || b.trigger.type !== a.trigger.type || Math.abs((b.startsAt ?? 0) - (a.startsAt ?? 0)) > 150 || b.kind === 'scroll-linked') continue;
      a.parts = [...(a.parts || [{ prop: a.properties[0], from: a.from, to: a.to, duration: a.duration, easing: a.easing }]), { prop: b.properties[0], from: b.from, to: b.to, duration: b.duration, easing: b.easing }];
      a.properties = [...a.properties, ...b.properties];
      const bWhat = b.name;
      a.name = `${a.name} and ${bWhat}`;
      a.what = `${a.what} and ${bWhat}`;
      a.text = a.text.replace(/ (when|on|automatically|over)/, ` and ${bWhat} $1`);
      if (a.durationSource !== 'css' && b.durationSource === 'css') Object.assign(a, { duration: b.duration, durationSource: 'css', easing: b.easing });
      effects.splice(j, 1);
    }
  }
}

function staggerOf(starts) {
  if (starts.length < 3) return 0;
  const s = [...starts].sort((a, b) => a - b);
  const gaps = s.slice(1).map((t, i) => t - s[i]).filter((g) => g > 0);
  if (gaps.length < 2) return 0;
  const m = median(gaps);
  const spread = Math.max(...gaps) - Math.min(...gaps);
  return m >= 40 && spread <= Math.max(150, m) ? Math.round(m / 10) * 10 : 0;
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function targetText(targets, count) {
  const t = targets[0] || {};
  const name = `\`${t.selector || 'element'}\`${t.text ? ` ("${t.text}")` : ''}`;
  return count > 1 ? `${count} elements like ${name}` : name;
}

function cleanSelector(sel, many) {
  const last = (sel || '.element').split(' > ').pop();
  return many ? last.replace(/:nth-(child|of-type)\([^)]*\)/g, '') : last;
}

export function cssSnippet(e) {
  const sel = cleanSelector(e.targets[0]?.selector, e.count > 1);
  const easing = e.easing || 'cubic-bezier(0.2, 0.8, 0.2, 1)';
  if (e.kind === 'keyframes' && e.keyframes?.length) {
    const frames = e.keyframes
      .map((k) => `  ${Math.round(k.offset * 100)}% { ${Object.entries(k).filter(([p]) => p !== 'offset').map(([p, v]) => `${p === 'easing' ? 'animation-timing-function' : p.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}: ${v};`).join(' ')} }`)
      .join('\n');
    return `@keyframes ${e.name} {\n${frames}\n}\n${sel} {\n  animation: ${e.name} ${e.duration}ms ${easing}${e.delay ? ` ${e.delay}ms` : ''}${e.iterations === 'infinite' ? ' infinite' : ''}${e.direction && e.direction !== 'normal' ? ` ${e.direction}` : ''} both;\n}`;
  }
  if (e.kind === 'scroll-linked') return `/* ${sel} moves relative to the page while scrolling: use position: sticky, or a scroll-driven animation (animation-timeline: scroll()) for parallax. */`;
  const parts = e.parts || [{ prop: e.properties[0], from: e.from, to: e.to, duration: e.duration, easing: e.easing }];
  const transition = parts.map((p) => `${p.prop} ${p.duration || e.duration}ms ${p.easing || easing}`).join(',\n              ');
  const decl = (key) => parts.filter((p) => p[key] !== undefined).map((p) => `  ${p.prop}: ${p[key]};`).join('\n');
  const stagger = e.stagger ? `\n${sel} { transition-delay: calc(var(--i) * ${e.stagger}ms); } /* set --i: 0, 1, 2… on each item */` : '';
  if (e.trigger.type === 'hover') {
    const to = decl('to');
    return `${sel} {\n  transition: ${transition};\n}\n${sel}:hover {\n${to || '  /* final state: see the contact sheet */'}\n}`;
  }
  if (e.trigger.type === 'scroll' || e.trigger.type === 'load') {
    return `${sel} {\n${decl('from')}\n  transition: ${transition};\n}\n${sel}.is-visible {\n${decl('to')}\n}${stagger}\n/* add .is-visible with an IntersectionObserver${e.trigger.type === 'load' ? ' or right after load' : ''} */`;
  }
  return `${sel} {\n  transition: ${transition};\n}`;
}
