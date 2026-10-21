// Injected into the page. Reads computed styles from an element (or the whole
// page) and turns them into a compact summary: palette, fonts, type scale,
// radii, shadows, spacing, motion, CSS variables and a trimmed HTML snippet.
(() => {
  const MAX_NODES = 1500;

  function toHex(value) {
    const m = value && value.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    const [r, g, b, a = 1] = parts;
    if (a < 0.05) return null;
    const hex = '#' + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
    return a < 1 ? `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}` : hex;
  }

  function isVisible(el, style) {
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function hasOwnText(el) {
    for (const node of el.childNodes) {
      if (node.nodeType === 3 && node.textContent.trim().length > 1) return true;
    }
    return false;
  }

  function bump(map, key, by = 1, extra) {
    if (!key) return;
    const entry = map.get(key) || { value: key, count: 0, roles: new Set(), tags: new Set() };
    entry.count += by;
    if (extra?.role) entry.roles.add(extra.role);
    if (extra?.tag) entry.tags.add(extra.tag);
    map.set(key, entry);
  }

  function top(map, n) {
    return [...map.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, n)
      .map((e) => ({ value: e.value, count: Math.round(e.count), roles: [...e.roles], tags: [...e.tags] }));
  }

  function primaryFamily(fontFamily) {
    return fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
  }

  function collect(root) {
    const colors = new Map();
    const fonts = new Map();
    const typeScale = new Map();
    const radii = new Map();
    const shadows = new Map();
    const spacing = new Map();
    const transitions = new Map();

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let el = root;
    let seen = 0;
    while (el && seen < MAX_NODES) {
      seen++;
      const s = getComputedStyle(el);
      if (isVisible(el, s)) {
        const rect = el.getBoundingClientRect();
        const area = Math.min((rect.width * rect.height) / 10000, 40);
        const tag = el.tagName.toLowerCase();

        bump(colors, toHex(s.backgroundColor), 1 + area, { role: 'background' });
        if (parseFloat(s.borderTopWidth) > 0) bump(colors, toHex(s.borderTopColor), 1, { role: 'border' });

        if (hasOwnText(el)) {
          bump(colors, toHex(s.color), 2, { role: 'text' });
          const family = primaryFamily(s.fontFamily);
          const f = fonts.get(family) || { family, stack: s.fontFamily, weights: new Set(), count: 0 };
          f.weights.add(s.fontWeight);
          f.count++;
          fonts.set(family, f);
          const key = `${family}|${s.fontSize}|${s.fontWeight}|${s.lineHeight}|${s.letterSpacing}`;
          bump(typeScale, key, 1, { tag });
        }

        if (s.borderTopLeftRadius !== '0px') bump(radii, s.borderRadius);
        if (s.boxShadow !== 'none') bump(shadows, s.boxShadow);
        for (const prop of ['paddingTop', 'paddingLeft', 'gap', 'marginBottom']) {
          const v = s[prop];
          if (v && v !== '0px' && v !== 'normal' && v !== 'auto') bump(spacing, v);
        }
        if (s.transitionDuration && s.transitionDuration !== '0s') {
          bump(transitions, `${s.transitionProperty} ${s.transitionDuration} ${s.transitionTimingFunction}`);
        }
      }
      el = walker.nextNode();
    }

    return {
      palette: top(colors, 14).map((c) => ({ hex: c.value, weight: c.count, roles: c.roles })),
      fonts: [...fonts.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map((f) => ({ family: f.family, stack: f.stack, weights: [...f.weights].sort(), count: f.count })),
      typeScale: top(typeScale, 10)
        .map((t) => {
          const [family, size, weight, lineHeight, letterSpacing] = t.value.split('|');
          return { family, size, weight, lineHeight, letterSpacing, count: t.count, tags: t.tags.slice(0, 4) };
        })
        .sort((a, b) => parseFloat(b.size) - parseFloat(a.size)),
      radii: top(radii, 6).map((r) => r.value),
      shadows: top(shadows, 5).map((r) => r.value),
      spacing: top(spacing, 10).map((r) => r.value).sort((a, b) => parseFloat(a) - parseFloat(b)),
      transitions: top(transitions, 5).map((r) => r.value),
      nodesScanned: seen,
    };
  }

  // Styles of the picked element itself, minus the boring defaults.
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

  function cssVariables() {
    const names = new Set();
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin stylesheet
      }
      for (const rule of rules || []) {
        if (!rule.style || !/^(:root|html|body)\b/.test(rule.selectorText || '')) continue;
        for (const prop of rule.style) if (prop.startsWith('--')) names.add(prop);
        if (names.size > 150) break;
      }
    }
    const root = getComputedStyle(document.documentElement);
    const vars = {};
    for (const name of [...names].slice(0, 120)) {
      const v = root.getPropertyValue(name).trim();
      if (v && v.length < 120) vars[name] = v;
    }
    return vars;
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
    clone.querySelectorAll('script, style, noscript, iframe, template, link').forEach((n) => n.remove());
    clone.querySelectorAll('svg').forEach((svg) => {
      svg.innerHTML = '';
    });
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
    const name = { nav: 'Navigation', header: 'Header', footer: 'Footer', form: 'Form', button: 'Button', aside: 'Sidebar' }[tag];
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

  window.__refboardAnalyze = {
    element(el) {
      const r = el.getBoundingClientRect();
      return {
        ...pageMeta(),
        title: guessTitle(el),
        analysis: {
          selector: selectorFor(el),
          size: { width: Math.round(r.width), height: Math.round(r.height) },
          keyStyles: keyStyles(el),
          ...collect(el),
          cssVars: cssVariables(),
          html: htmlSnippet(el),
        },
      };
    },
    page() {
      return {
        ...pageMeta(),
        title: document.title || location.hostname,
        analysis: {
          selector: null,
          size: { width: innerWidth, height: innerHeight },
          keyStyles: keyStyles(document.body),
          ...collect(document.body),
          cssVars: cssVariables(),
          html: null,
        },
      };
    },
  };
})();
