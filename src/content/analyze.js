// Injected into the page. Reads computed styles and turns them into a design
// system summary: semantic colors, typography (families, size + weight scale,
// heading styles), spacing scale and base unit, radius, elevation, motion,
// breakpoints, layout, detected components and CSS variables.
//
// window.__refboardAnalyze.element(el) → one section (+ the whole site's system)
// window.__refboardAnalyze.page()      → the whole page
(() => {
  const MAX_NODES = 8000;
  const TIME_BUDGET_MS = 700;
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'HEAD', 'TITLE', 'BR', 'WBR']);

  /* ---------- color helpers ---------- */

  function parseColor(value) {
    const m = value && value.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    if (a < 0.05) return null;
    return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a: Math.round(a * 100) / 100 };
  }

  const hex2 = (n) => n.toString(16).padStart(2, '0');
  const toHex = (c) => '#' + hex2(c.r) + hex2(c.g) + hex2(c.b) + (c.a < 1 ? hex2(Math.round(c.a * 255)) : '');

  function luminance({ r, g, b }) {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }

  function saturation({ r, g, b }) {
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const l = (max + min) / 2;
    return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  }

  const colorDistance = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b) + Math.abs(a.a - b.a) * 255;

  // "2px solid rgb(1, 57, 0)" → "2px solid #013900"
  const hexify = (v) => v.replace(/rgba?\([^)]+\)/g, (m) => (parseColor(m) ? toHex(parseColor(m)) : 'transparent'));

  /* ---------- small utils ---------- */

  const px = (v) => Math.round(parseFloat(v) * 10) / 10;
  const roundPx = (v) => Math.round(parseFloat(v));
  const isNone = (v) => !v || v === 'none' || v === 'normal' || v === 'auto' || v === '0px' || v === '0s';

  function counter() {
    const map = new Map();
    return {
      add(key, by = 1, extra) {
        if (key === null || key === undefined || key === '') return;
        const e = map.get(key) || { value: key, count: 0, extra: {} };
        e.count += by;
        if (extra) for (const k in extra) (e.extra[k] ||= new Set()).add(extra[k]);
        map.set(key, e);
      },
      top(n = Infinity) {
        return [...map.values()].sort((a, b) => b.count - a.count).slice(0, n);
      },
      size: () => map.size,
    };
  }

  function hasOwnText(el) {
    for (const node of el.childNodes) if (node.nodeType === 3 && node.textContent.trim().length > 1) return true;
    return false;
  }

  function ownTextLength(el) {
    let n = 0;
    for (const node of el.childNodes) if (node.nodeType === 3) n += node.textContent.trim().length;
    return n;
  }

  const primaryFamily = (stack) => stack.split(',')[0].trim().replace(/^["']|["']$/g, '');
  const sampleText = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);

  /* ---------- the scan ---------- */

  function scan(root) {
    const started = performance.now();
    const colors = new Map(); // hex -> { c, text, bg, border, tags:Set }
    const families = new Map();
    const typeScale = counter();
    const weights = counter();
    const lineHeights = counter();
    const letterSpacings = counter();
    const radii = counter();
    const shadows = counter();
    const spacing = counter();
    const durations = counter();
    const easings = counter();
    const animations = counter();
    const maxWidths = counter();
    const gridCols = counter();
    const buttons = counter();
    const inputs = counter();
    const cards = counter();
    const links = counter();
    const badges = counter();
    let textElements = 0;
    let truncated = false;

    const addColor = (value, kind, weight, tag) => {
      const c = parseColor(value);
      if (!c) return;
      const key = toHex(c);
      const e = colors.get(key) || { c, hex: key, text: 0, bg: 0, border: 0, tags: new Set() };
      e[kind] += weight;
      if (tag) e.tags.add(tag);
      colors.set(key, e);
    };

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (SKIP_TAGS.has(node.tagName) || node.tagName === 'REFBOARD-PICKER') return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest('svg') && node.tagName !== 'svg') return NodeFilter.FILTER_REJECT;
        // Skip display:none subtrees (but walk into display:contents wrappers).
        if (node.checkVisibility && !node.checkVisibility()) {
          return getComputedStyle(node).display === 'contents' ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let el = root;
    let seen = 0;
    while (el) {
      if (seen >= MAX_NODES || (seen % 200 === 0 && performance.now() - started > TIME_BUDGET_MS)) {
        truncated = true;
        break;
      }
      seen++;
      const s = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0 && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0;
      if (visible) {
        const tag = el.tagName.toLowerCase();
        const area = rect.width * rect.height;

        addColor(s.backgroundColor, 'bg', area, tag);
        if (parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none') addColor(s.borderTopColor, 'border', 1, tag);

        const textLen = ownTextLength(el);
        if (textLen > 1) {
          textElements++;
          addColor(s.color, 'text', Math.min(textLen, 200), tag);
          const family = primaryFamily(s.fontFamily);
          const f = families.get(family) || { family, stack: s.fontFamily, weights: new Set(), count: 0, chars: 0, tags: counter(), sizes: new Set() };
          f.weights.add(s.fontWeight);
          f.count++;
          f.chars += textLen;
          f.tags.add(tag);
          f.sizes.add(roundPx(s.fontSize));
          families.set(family, f);
          const size = roundPx(s.fontSize);
          typeScale.add(`${size}|${s.fontWeight}|${family}`, textLen, { tag, lh: s.lineHeight, ls: s.letterSpacing, tt: s.textTransform });
          weights.add(s.fontWeight, textLen);
          if (s.lineHeight !== 'normal') lineHeights.add(Math.round((parseFloat(s.lineHeight) / parseFloat(s.fontSize)) * 100) / 100, textLen);
          if (s.letterSpacing !== 'normal' && s.letterSpacing !== '0px') letterSpacings.add(s.letterSpacing, textLen);
        }

        const r = roundPx(s.borderTopLeftRadius);
        if (r > 0) radii.add(r >= 999 || r >= Math.min(rect.width, rect.height) / 2 ? 'full' : r);
        if (s.boxShadow !== 'none') shadows.add(s.boxShadow);
        for (const prop of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginBottom', 'rowGap', 'columnGap']) {
          const v = roundPx(s[prop]);
          if (v > 0 && v < 400) spacing.add(v);
        }
        if (!isNone(s.transitionDuration)) {
          s.transitionDuration.split(',').forEach((d) => !isNone(d.trim()) && durations.add(d.trim()));
          s.transitionTimingFunction.split(/,(?![^(]*\))/).forEach((t) => easings.add(t.trim()));
        }
        if (s.animationName && s.animationName !== 'none') {
          animations.add(s.animationName);
          if (!isNone(s.animationDuration)) durations.add(s.animationDuration);
        }
        if (s.maxWidth.endsWith('px') && rect.width > 480) maxWidths.add(roundPx(s.maxWidth));
        if (s.display === 'grid' && s.gridTemplateColumns !== 'none') gridCols.add(s.gridTemplateColumns.split(' ').length);

        // Components, grouped by visual signature
        const hasBg = !!parseColor(s.backgroundColor);
        const hasBorder = parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none';
        // innerText is expensive on big containers, so only read it for candidates.
        const text = () => textLen > 0 || !!el.textContent.trim();
        const isButtonish = tag === 'button' || el.getAttribute('role') === 'button' || (tag === 'input' && /submit|button/.test(el.type)) || tag === 'a';
        if (isButtonish && (hasBg || hasBorder) && rect.height >= 24 && rect.height <= 90 && rect.width < 420 && parseFloat(s.paddingLeft) >= 6 && text()) {
          const sig = componentStyles(s, ['background-color', 'color', 'border', 'border-radius', 'padding', 'font-family', 'font-size', 'font-weight', 'text-transform', 'letter-spacing', 'box-shadow']);
          buttons.add(JSON.stringify(sig), 1, { sample: sampleText(el), height: Math.round(rect.height) });
        } else if (tag === 'a' && !hasBg && textLen > 0) {
          links.add(JSON.stringify(componentStyles(s, ['color', 'font-weight', 'text-decoration-line', 'text-underline-offset'])), 1, { sample: sampleText(el) });
        }
        if ((tag === 'input' && !/hidden|checkbox|radio|submit|button|range|file|color/.test(el.type)) || tag === 'textarea' || tag === 'select') {
          inputs.add(JSON.stringify(componentStyles(s, ['background-color', 'color', 'border', 'border-radius', 'padding', 'font-size', 'height', 'box-shadow'])), 1, { height: Math.round(rect.height) });
        }
        if (/^(div|article|li|section|a|aside)$/.test(tag) && rect.width >= 140 && rect.width <= 720 && rect.height >= 90 && rect.height <= 900 &&
            r >= 4 && (s.boxShadow !== 'none' || hasBorder || hasBg) && text()) {
          cards.add(JSON.stringify(componentStyles(s, ['background-color', 'border', 'border-radius', 'padding', 'box-shadow'])), 1, { sample: sampleText(el), width: Math.round(rect.width) });
        }
        if (hasBg && r >= 6 && rect.height >= 16 && rect.height <= 34 && rect.width <= 180 && !isButtonish && text()) {
          badges.add(JSON.stringify(componentStyles(s, ['background-color', 'color', 'border-radius', 'padding', 'font-size', 'font-weight', 'text-transform'])), 1, { sample: sampleText(el) });
        }
      }
      el = walker.nextNode();
    }

    return {
      colors: semanticColors(colors, root),
      typography: typography(families, typeScale, weights, lineHeights, letterSpacings, textElements),
      spacing: spacingScale(spacing),
      radius: radii.top(8).map((e) => ({ value: e.value === 'full' ? '9999px' : `${e.value}px`, count: e.count, full: e.value === 'full' }))
        .sort((a, b) => parseFloat(a.value) - parseFloat(b.value)),
      shadows: elevation(shadows),
      motion: {
        durations: durations.top(6).map((e) => e.value).sort((a, b) => parseFloat(a) - parseFloat(b)),
        easings: easings.top(4).map((e) => e.value),
        animations: animations.top(6).map((e) => e.value),
      },
      layout: {
        containerWidths: maxWidths.top(4).map((e) => e.value).sort((a, b) => a - b),
        gridColumns: gridCols.top(4).map((e) => e.value).sort((a, b) => a - b),
      },
      components: {
        buttons: variants(buttons, 3),
        links: variants(links, 1),
        inputs: variants(inputs, 2),
        cards: variants(cards, 2),
        badges: variants(badges, 2),
      },
      stats: { nodesScanned: seen, textElements, truncated, ms: Math.round(performance.now() - started) },
    };
  }

  function componentStyles(s, props) {
    const out = {};
    for (const p of props) {
      let v = s.getPropertyValue(p).trim();
      if (p === 'font-family') v = primaryFamily(v);
      if (p === 'border' && (v.startsWith('0px') || v.includes(' none'))) continue;
      if (/color$/.test(p)) {
        const c = parseColor(v);
        if (!c) continue;
        v = toHex(c);
      }
      if (!v || v === 'none' || v === 'normal' || v === 'auto' || (v === '0px' && p !== 'border-radius')) continue;
      out[p] = hexify(v);
    }
    return out;
  }

  function variants(c, n) {
    const total = c.top().reduce((sum, e) => sum + e.count, 0);
    return c.top(n).map((e) => ({
      styles: JSON.parse(e.value),
      count: e.count,
      share: total ? Math.round((e.count / total) * 100) : 0,
      sample: [...(e.extra.sample || [])].find((t) => t && t.length < 32) || '',
    }));
  }

  /* ---------- colors → semantic roles ---------- */

  function semanticColors(map, root) {
    // Merge near-duplicates (e.g. #ffffff vs #fefefe) into the more used one.
    const all = [...map.values()].map((e) => ({ ...e, total: e.text * 400 + e.bg + e.border * 300 }));
    all.sort((a, b) => b.total - a.total);
    const kept = [];
    for (const e of all) {
      const twin = kept.find((k) => colorDistance(k.c, e.c) < 12);
      if (twin) {
        twin.text += e.text;
        twin.bg += e.bg;
        twin.border += e.border;
        twin.total += e.total;
        e.tags.forEach((t) => twin.tags.add(t));
      } else kept.push(e);
    }

    // The page background is the biggest background area (or white by default).
    let pageBg = kept.filter((e) => e.bg > 0).sort((a, b) => b.bg - a.bg)[0];
    if (!pageBg && root === document.body) {
      pageBg = { c: { r: 255, g: 255, b: 255, a: 1 }, hex: '#ffffff', text: 0, bg: 1, border: 0, total: 1, tags: new Set(['html']) };
      kept.push(pageBg);
    }

    const totalText = kept.reduce((s, e) => s + e.text, 0) || 1;
    const totalBg = kept.reduce((s, e) => s + e.bg, 0) || 1;
    // Brand color: a saturated color that is used as a fill (CTAs, brand blocks),
    // not a very dark tinted color that is mostly body text.
    const darkText = (e) => luminance(e.c) < 0.05 && e.text / totalText > e.bg / totalBg;
    const saturated = kept
      .filter((e) => e.c.a >= 0.5 && saturation(e.c) > 0.35 && luminance(e.c) < 0.92 && !darkText(e) && e !== pageBg)
      .sort((a, b) => (b.bg / totalBg) * 2 + b.text / totalText - ((a.bg / totalBg) * 2 + a.text / totalText));
    const primary = saturated[0];

    // Drop colors that barely appear (a stray default border, a 1px divider).
    const meaningful = kept.filter((e) => e === pageBg || e.text / totalText > 0.005 || e.bg / totalBg > 0.002 || e.border >= 3);

    const out = meaningful.slice(0, 18).map((e) => {
      const lum = luminance(e.c);
      const sat = saturation(e.c);
      const textShare = e.text / totalText;
      const bgShare = e.bg / totalBg;
      let role;
      if (e === pageBg) role = 'Background';
      else if (e === primary) role = 'Primary';
      else if (sat > 0.35 && lum < 0.92 && e.c.a >= 0.5 && !darkText(e)) role = 'Accent';
      else if (bgShare >= textShare && e.bg > 0) role = lum > 0.8 ? 'Surface' : lum < 0.06 ? 'Surface Dark' : 'Surface Muted';
      else if (e.text > 0) role = lum < 0.07 ? 'Text Primary' : lum < 0.35 ? 'Text Secondary' : 'Text Light';
      else role = 'Border';
      return {
        hex: e.hex,
        role,
        usage: { text: Math.round(textShare * 100), background: Math.round(bgShare * 100), border: e.border },
        weight: Math.round(e.total),
        tags: [...e.tags].slice(0, 5),
      };
    });

    const order = ['Primary', 'Accent', 'Background', 'Surface', 'Surface Muted', 'Surface Dark', 'Text Primary', 'Text Secondary', 'Text Light', 'Border'];
    out.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || b.weight - a.weight);
    const counts = {};
    for (const c of out) {
      const base = c.role.toLowerCase().replace(/\s+/g, '-');
      counts[base] = (counts[base] || 0) + 1;
      c.token = `--color-${base}${counts[base] > 1 ? `-${counts[base]}` : ''}`;
    }
    return out;
  }

  /* ---------- typography ---------- */

  const SIZE_NAMES_UP = ['text-lg', 'text-xl', 'text-2xl', 'text-3xl', 'text-4xl', 'text-5xl', 'text-6xl', 'text-7xl', 'text-8xl', 'text-9xl'];
  const SIZE_NAMES_DOWN = ['text-sm', 'text-xs', 'text-2xs', 'text-3xs'];

  function typography(families, typeScale, weights, lineHeights, letterSpacings, textElements) {
    const totalChars = [...families.values()].reduce((s, f) => s + f.chars, 0) || 1;
    const fams = [...families.values()]
      .filter((f) => f.chars / totalChars > 0.003 || f.count >= 2)
      .sort((a, b) => b.chars - a.chars)
      .slice(0, 6)
      .map((f) => {
        const tags = f.tags.top().map((t) => t.value);
        const usage = [];
        if (tags.some((t) => /^h[1-3]$/.test(t)) || Math.max(...f.sizes) >= 32) usage.push('display');
        if (tags.some((t) => /^(p|li|span|div|td|blockquote)$/.test(t))) usage.push('body');
        if (tags.some((t) => /^(button|a|label|input|nav)$/.test(t))) usage.push('ui');
        return {
          family: f.family,
          stack: f.stack,
          weights: [...f.weights].sort((a, b) => a - b),
          share: Math.round((f.chars / totalChars) * 100),
          usage,
        };
      });

    // Size scale: unique rounded sizes, named relative to the body size.
    const bySize = new Map();
    for (const e of typeScale.top()) {
      const [size, weight, family] = e.value.split('|');
      const cur = bySize.get(size) || { size: +size, chars: 0, weights: new Set(), families: new Set(), tags: new Set(), lineHeight: null, letterSpacing: null, transform: null };
      cur.chars += e.count;
      cur.weights.add(weight);
      cur.families.add(family);
      (e.extra.tag || new Set()).forEach((t) => cur.tags.add(t));
      cur.lineHeight ||= [...(e.extra.lh || [])][0];
      cur.letterSpacing ||= [...(e.extra.ls || [])][0];
      const tt = [...(e.extra.tt || [])].find((t) => t !== 'none');
      if (tt) cur.transform = tt;
      bySize.set(size, cur);
    }
    const sizes = [...bySize.values()].sort((a, b) => a.size - b.size);
    const body = [...sizes].sort((a, b) => b.chars - a.chars)[0];
    const baseIndex = sizes.indexOf(body);
    const scale = sizes.map((s, i) => ({
      name: i === baseIndex ? 'text-base' : i < baseIndex ? SIZE_NAMES_DOWN[baseIndex - i - 1] || `text-${i}` : SIZE_NAMES_UP[i - baseIndex - 1] || `text-${i}`,
      size: `${s.size}px`,
      weights: [...s.weights].sort((a, b) => a - b),
      families: [...s.families],
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      transform: s.transform,
      usedOn: [...s.tags].slice(0, 5),
      share: Math.round((s.chars / totalChars) * 100),
    }));

    return {
      families: fams,
      scale: scale.slice(-14),
      weights: weights.top(8).map((e) => e.value).sort((a, b) => a - b),
      lineHeights: lineHeights.top(4).map((e) => e.value).sort((a, b) => a - b),
      letterSpacings: letterSpacings.top(4).map((e) => e.value),
      elements: elementStyles(),
      textElements,
    };
  }

  // How the site styles real headings, body text, links and buttons.
  function elementStyles() {
    const out = {};
    for (const sel of ['h1', 'h2', 'h3', 'h4', 'p', 'a', 'button', 'small', 'label']) {
      const el = [...document.querySelectorAll(sel)].find((n) => {
        const r = n.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && n.textContent.trim() && !n.closest('refboard-picker');
      });
      if (!el) continue;
      const s = getComputedStyle(el);
      out[sel] = {
        family: primaryFamily(s.fontFamily),
        size: `${px(s.fontSize)}px`,
        weight: s.fontWeight,
        lineHeight: s.lineHeight,
        letterSpacing: s.letterSpacing,
        transform: s.textTransform !== 'none' ? s.textTransform : undefined,
        color: parseColor(s.color) ? toHex(parseColor(s.color)) : undefined,
        sample: sampleText(el),
      };
    }
    return out;
  }

  /* ---------- spacing, elevation ---------- */

  function spacingScale(c) {
    const entries = c.top(40);
    const total = entries.reduce((s, e) => s + e.count, 0) || 1;
    let base = null;
    for (const unit of [8, 4, 6, 5]) {
      const fit = entries.filter((e) => e.value % unit === 0).reduce((s, e) => s + e.count, 0) / total;
      if (fit >= 0.7) {
        base = unit;
        break;
      }
    }
    return {
      base,
      scale: entries.slice(0, 14).map((e) => e.value).sort((a, b) => a - b).map((v) => `${v}px`),
    };
  }

  function elevation(c) {
    const blur = (v) => {
      const nums = v.replace(/rgba?\([^)]*\)/g, '').match(/-?\d+(\.\d+)?px/g) || [];
      return parseFloat(nums[2] || '0');
    };
    const list = c.top(6).map((e) => ({ value: e.value, count: e.count, blur: blur(e.value) })).sort((a, b) => a.blur - b.blur);
    const names = ['shadow-sm', 'shadow', 'shadow-md', 'shadow-lg', 'shadow-xl', 'shadow-2xl'];
    return list.map((s, i) => ({ name: names[i] || `shadow-${i}`, value: hexify(s.value), count: s.count }));
  }

  /* ---------- stylesheet-level info ---------- */

  function sheetInfo() {
    const names = new Set();
    const breakpoints = new Set();
    const visit = (rules, depth = 0) => {
      for (const rule of rules || []) {
        if (rule.media && rule.cssRules) {
          for (const m of (rule.conditionText || rule.media.mediaText || '').matchAll(/(min|max)-width:\s*([\d.]+)(px|em|rem)/g)) {
            breakpoints.add(Math.round(parseFloat(m[2]) * (m[3] === 'px' ? 1 : 16)));
          }
          if (depth < 2) visit(rule.cssRules, depth + 1);
        } else if (rule.style && /^(:root|html|body)\b/.test(rule.selectorText || '') && names.size < 200) {
          for (const prop of rule.style) if (prop.startsWith('--')) names.add(prop);
        }
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        visit(sheet.cssRules);
      } catch {
        /* cross-origin stylesheet */
      }
    }
    const root = getComputedStyle(document.documentElement);
    const vars = {};
    for (const name of [...names].slice(0, 160)) {
      const v = root.getPropertyValue(name).trim();
      if (v && v.length < 120) vars[name] = v;
    }
    return { cssVars: vars, breakpoints: [...breakpoints].filter((b) => b >= 320 && b <= 2560).sort((a, b) => a - b).slice(0, 10) };
  }

  /* ---------- section-level extras ---------- */

  const KEY_PROPS = [
    'display', 'position', 'width', 'height', 'max-width',
    'flex-direction', 'justify-content', 'align-items', 'gap',
    'grid-template-columns', 'padding', 'margin',
    'background-color', 'background-image', 'color',
    'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-transform',
    'border', 'border-radius', 'box-shadow', 'backdrop-filter', 'opacity',
    'transition', 'animation-name', 'animation-duration', 'transform',
  ];
  const BORING = new Set(['none', 'normal', 'auto', '0px', 'static', 'visible', 'rgba(0, 0, 0, 0)', '0s', '1', 'all 0s ease 0s']);

  function keyStyles(el) {
    const s = getComputedStyle(el);
    const out = {};
    for (const prop of KEY_PROPS) {
      let v = s.getPropertyValue(prop).trim();
      if (!v || BORING.has(v) || v.startsWith('0px none')) continue;
      if (prop === 'font-family') v = v.split(',').slice(0, 3).join(',');
      if (prop === 'background-image' && v.length > 200) v = v.slice(0, 200) + '…';
      out[prop] = v;
    }
    return out;
  }

  function selectorFor(el) {
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 4) {
      let part = el.tagName.toLowerCase();
      if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) {
        parts.unshift(`${part}#${el.id}`);
        break;
      }
      const classes = [...el.classList].filter((c) => /^[a-zA-Z][\w-]*$/.test(c)).slice(0, 2);
      if (classes.length) part += '.' + classes.join('.');
      parts.unshift(part);
      el = el.parentElement;
    }
    return parts.join(' > ');
  }

  function htmlSnippet(el, limit = 6000) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('script, style, noscript, iframe, template, link, refboard-picker').forEach((n) => n.remove());
    clone.querySelectorAll('svg').forEach((svg) => (svg.innerHTML = ''));
    clone.querySelectorAll('*').forEach((n) => {
      for (const attr of [...n.attributes]) {
        const keep = ['class', 'id', 'href', 'role', 'type', 'aria-label', 'alt', 'src', 'placeholder'].includes(attr.name);
        if (!keep || attr.value.length > 300) n.removeAttribute(attr.name);
      }
    });
    let html = clone.outerHTML.replace(/\s{2,}/g, ' ');
    if (html.length > limit) html = html.slice(0, limit) + '\n<!-- …trimmed -->';
    return html;
  }

  function guessTitle(el) {
    const label = el.getAttribute('aria-label') || el.querySelector('h1,h2,h3,h4')?.textContent || el.textContent || '';
    const text = label.replace(/\s+/g, ' ').trim();
    const tag = el.tagName.toLowerCase();
    const name = { nav: 'Navigation', header: 'Header', footer: 'Footer', form: 'Form', button: 'Button', aside: 'Sidebar', img: 'Image' }[tag];
    if (name) return text ? `${name}: ${text.slice(0, 40)}` : name;
    return text.slice(0, 60) || tag;
  }

  function pageMeta() {
    const icon = document.querySelector('link[rel~="icon"]')?.href || new URL('/favicon.ico', location.href).href;
    return {
      url: location.href,
      hostname: location.hostname.replace(/^www\./, ''),
      pageTitle: document.title,
      description: document.querySelector('meta[name="description"]')?.content || '',
      favicon: icon,
    };
  }

  // Older parts of Refboard (and older saved pins) read these flat fields.
  function legacy(system) {
    return {
      palette: system.colors.map((c) => ({ hex: c.hex, weight: c.weight, roles: rolesOf(c), role: c.role })),
      fonts: system.typography.families.map((f) => ({ family: f.family, stack: f.stack, weights: f.weights, count: f.share, usage: f.usage })),
      typeScale: system.typography.scale.map((t) => ({
        family: t.families[0], size: t.size, weight: t.weights[t.weights.length - 1], lineHeight: t.lineHeight,
        letterSpacing: t.letterSpacing, count: t.share, tags: t.usedOn, name: t.name,
      })).reverse(),
      radii: system.radius.map((r) => r.value),
      shadows: system.shadows.map((s) => s.value),
      spacing: system.spacing.scale,
      transitions: system.motion.durations.length ? [`${system.motion.durations.join(' / ')} ${system.motion.easings[0] || ''}`.trim()] : [],
    };
  }

  function rolesOf(c) {
    const roles = [];
    if (c.usage.background) roles.push('background');
    if (c.usage.text) roles.push('text');
    if (c.usage.border) roles.push('border');
    return roles.length ? roles : ['background'];
  }

  let siteCache = null;
  function site() {
    if (siteCache && siteCache.url === location.href && performance.now() - siteCache.at < 15000) return siteCache.system;
    const system = { ...scan(document.body), ...sheetInfo() };
    siteCache = { url: location.href, at: performance.now(), system };
    return system;
  }

  window.__refboardAnalyze = {
    element(el) {
      const r = el.getBoundingClientRect();
      const system = scan(el);
      return {
        ...pageMeta(),
        title: guessTitle(el),
        site: site(),
        analysis: {
          selector: selectorFor(el),
          size: { width: Math.round(r.width), height: Math.round(r.height) },
          keyStyles: keyStyles(el),
          ...legacy(system),
          system,
          cssVars: site().cssVars,
          html: htmlSnippet(el),
        },
      };
    },
    page() {
      const system = site();
      return {
        ...pageMeta(),
        title: document.title || location.hostname,
        site: system,
        analysis: {
          selector: null,
          size: { width: innerWidth, height: innerHeight },
          keyStyles: keyStyles(document.body),
          ...legacy(system),
          system,
          cssVars: system.cssVars,
          html: null,
        },
      };
    },
  };
})();
