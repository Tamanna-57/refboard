// Injected into the page while a recording runs. Collects what Claude cannot
// see in a video file: the exact animations the browser is running (CSS
// animations/transitions with keyframes, duration, easing), how elements inside
// the recorded area move and fade over time (this also catches JS-driven
// effects such as GSAP), and what the user did (scroll / hover / click), so the
// trigger of each effect can be worked out.
//
// window.__refboardMotion.start(rect) … .stop() → data
(() => {
  const SAMPLE_MS = 100;
  const MAX_ELEMENTS = 160;
  const SAMPLE_BUDGET_MS = 6; // never spend more than this per sample, so the page stays smooth
  const PROPS = ['transform', 'opacity', 'filter', 'clipPath', 'backgroundColor', 'color', 'width', 'height', 'boxShadow', 'borderRadius'];

  function selectorFor(el) {
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 3) {
      let part = el.tagName.toLowerCase();
      if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) {
        parts.unshift(`${part}#${el.id}`);
        break;
      }
      const cls = [...el.classList].filter((c) => /^[a-zA-Z][\w-]*$/.test(c) && c.length < 30).slice(0, 2);
      if (cls.length) part += '.' + cls.join('.');
      parts.unshift(part);
      el = el.parentElement;
    }
    return parts.join(' > ');
  }

  const label = (el) => (el.getAttribute?.('aria-label') || el.innerText || el.alt || '').replace(/\s+/g, ' ').trim().slice(0, 40);

  function intersects(r, box) {
    return r.right > box.left && r.left < box.left + box.width && r.bottom > box.top && r.top < box.top + box.height;
  }

  function animationInfo(a, t0) {
    const effect = a.effect;
    const timing = effect?.getComputedTiming?.() || {};
    const target = effect?.target;
    let keyframes = [];
    try {
      keyframes = (effect.getKeyframes() || []).slice(0, 12).map((k) => {
        const out = { offset: Math.round((k.computedOffset ?? k.offset ?? 0) * 100) / 100 };
        for (const [p, v] of Object.entries(k)) if (!['offset', 'computedOffset', 'composite', 'easing'].includes(p)) out[p] = String(v).slice(0, 120);
        if (k.easing && k.easing !== 'linear') out.easing = k.easing;
        return out;
      });
    } catch {
      /* cross-origin or unsupported */
    }
    return {
      type: a.constructor?.name === 'CSSTransition' ? 'transition' : a.constructor?.name === 'CSSAnimation' ? 'css-animation' : 'web-animation',
      name: a.animationName || a.transitionProperty || a.id || '',
      target: target ? selectorFor(target) : '',
      targetText: target ? label(target) : '',
      duration: typeof timing.duration === 'number' ? Math.round(timing.duration) : null,
      delay: Math.round(timing.delay || 0),
      easing: effect?.getTiming?.().easing || 'linear',
      iterations: timing.iterations === Infinity ? 'infinite' : timing.iterations,
      direction: timing.direction,
      fill: timing.fill,
      seenAt: Math.round(performance.now() - t0),
      keyframes,
    };
  }

  let state = null;

  function sample() {
    const s = state;
    const t = Math.round(performance.now() - s.t0);
    s.scroll.push([t, Math.round(scrollX), Math.round(scrollY)]);
    for (const a of document.getAnimations()) {
      if (s.seenAnims.has(a)) continue;
      s.seenAnims.add(a);
      const target = a.effect?.target;
      if (target && target.closest?.('refboard-picker, refboard-rec')) continue;
      if (s.animations.length < 120) s.animations.push(animationInfo(a, s.t0));
    }
    // Round-robin through the tracked elements within a small time budget per tick.
    const started = performance.now();
    const n = s.tracked.length;
    for (let k = 0; k < n; k++) {
      if (performance.now() - started > SAMPLE_BUDGET_MS) break;
      const rec = s.tracked[(s.cursor + k) % n];
      s.lastIndex = (s.cursor + k) % n;
      const cs = rec.cs;
      for (const p of PROPS) {
        const v = cs[p];
        if (v !== rec.last[p]) {
          rec.series[p] ||= [[0, rec.last[p]]];
          rec.series[p].push([t, v]);
          rec.last[p] = v;
        }
      }
      // Only sticky/fixed elements can move relative to the page while scrolling;
      // reading positions is expensive, so only those are measured.
      if (rec.pinned) {
        const r = rec.el.getBoundingClientRect();
        const y = Math.round(r.top + scrollY);
        const x = Math.round(r.left + scrollX);
        if (x !== rec.lastPos[0] || y !== rec.lastPos[1]) {
          rec.series.position ||= [[0, `${rec.lastPos[0]},${rec.lastPos[1]}`]];
          rec.series.position.push([t, `${x},${y}`]);
          rec.lastPos = [x, y];
        }
      }
    }
    s.cursor = (s.lastIndex + 1) % Math.max(1, n);
  }

  function onEvent(e) {
    if (!state) return;
    const t = Math.round(performance.now() - state.t0);
    if (e.type === 'scroll') {
      if (t - (state.lastScrollEvt || -1000) < 150) return;
      state.lastScrollEvt = t;
      state.events.push({ t, type: 'scroll', y: Math.round(scrollY) });
      return;
    }
    const el = e.target?.closest?.('a, button, [role=button], input, [class*=card], li, img') || e.target;
    if (!el || el.nodeType !== 1 || el.closest('refboard-rec')) return;
    if (e.type === 'mouseover' && state.lastHover === el) return;
    if (e.type === 'mouseover') state.lastHover = el;
    if (state.events.length < 300) state.events.push({ t, type: e.type === 'mouseover' ? 'hover' : 'click', target: selectorFor(el), text: label(el) });
  }

  /* ---------- small on-page indicator, kept outside the recorded area ---------- */

  function indicator(rect, onStop, shortcut) {
    const host = document.createElement('refboard-rec');
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .pill { display: flex; align-items: center; gap: 8px; background: #0a0a0a; color: #fff; border-radius: 999px; padding: 6px 6px 6px 12px;
                font: 600 12px Inter, system-ui, sans-serif; box-shadow: 0 6px 20px rgba(0,0,0,.3); }
        .dot { width: 9px; height: 9px; border-radius: 50%; background: #ff3b30; animation: blink 1s infinite; }
        @keyframes blink { 50% { opacity: .3 } }
        button { border: 0; background: #2a2a2a; color: #fff; border-radius: 999px; padding: 4px 10px; font: inherit; cursor: pointer; }
        small { color: #a3a3a3; font-weight: 500; }
      </style>
      <div class="pill"><span class="dot"></span><span class="time">0:00</span><small>${shortcut ? `${shortcut} to stop` : ''}</small><button>Stop</button></div>`;
    root.querySelector('button').onclick = onStop;
    document.documentElement.appendChild(host);
    // Pick the corner furthest from the recorded area; hide it if the area fills the screen.
    const w = 230;
    const h = 40;
    const spots = [
      [innerWidth - w - 12, 12], [12, 12], [innerWidth - w - 12, innerHeight - h - 12], [12, innerHeight - h - 12],
    ];
    const free = spots.find(([x, y]) => !intersects({ left: x, top: y, right: x + w, bottom: y + h }, rect));
    if (free) Object.assign(host.style, { left: free[0] + 'px', top: free[1] + 'px' });
    else host.style.display = 'none';
    const started = Date.now();
    const timer = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      root.querySelector('.time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 500);
    return () => {
      clearInterval(timer);
      host.remove();
    };
  }

  window.__refboardMotion = {
    start(rect, { shortcut } = {}) {
      if (state) return;
      const box = { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
      // Track what's in the area now, plus what will scroll into it (up to 3 screens below, 1 above).
      const reach = { left: box.left, top: box.top - innerHeight, width: box.width, height: box.height + innerHeight * 4 };
      const candidates = [];
      for (const el of document.body.querySelectorAll('*')) {
        if (candidates.length > 6000) break;
        if (el.closest('refboard-picker, refboard-rec, svg *')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || !intersects(r, reach)) continue;
        candidates.push({ el, area: r.width * r.height, inView: intersects(r, box) });
      }
      // Prefer mid-sized elements (cards, images, headings) over tiny spans and huge wrappers.
      const viewportArea = innerWidth * innerHeight;
      const score = (c) => Math.abs(Math.log((c.area + 1) / (viewportArea * 0.05))) - (c.inView ? 0.5 : 0);
      candidates.sort((a, b) => score(a) - score(b));
      const tracked = candidates.slice(0, MAX_ELEMENTS).map(({ el }) => {
        const cs = getComputedStyle(el); // live object: reading it later gives current values
        const r = el.getBoundingClientRect();
        const last = {};
        for (const p of PROPS) last[p] = cs[p];
        return {
          el, cs, last, series: {}, lastPos: [Math.round(r.left + scrollX), Math.round(r.top + scrollY)],
          pinned: cs.position === 'sticky' || cs.position === 'fixed',
          info: { selector: selectorFor(el), tag: el.tagName.toLowerCase(), text: label(el), transition: cs.transition, animation: cs.animationName !== 'none' ? `${cs.animationName} ${cs.animationDuration} ${cs.animationTimingFunction}` : '' },
        };
      });
      state = {
        t0: performance.now(), startedAt: Date.now(), rect: box, viewport: { width: innerWidth, height: innerHeight }, url: location.href,
        tracked, seenAnims: new Set(), animations: [], events: [], scroll: [], cursor: 0, lastIndex: 0,
      };
      // Animations already running when recording starts (loops, marquees…)
      for (const a of document.getAnimations()) {
        state.seenAnims.add(a);
        const target = a.effect?.target;
        if (target && !target.closest?.('refboard-picker, refboard-rec')) state.animations.push({ ...animationInfo(a, state.t0), seenAt: 0, alreadyRunning: true });
      }
      state.timer = setInterval(sample, SAMPLE_MS);
      for (const type of ['scroll', 'mouseover', 'click']) window.addEventListener(type, onEvent, { capture: true, passive: true });
      state.stopIndicator = indicator(box, () => chrome.runtime.sendMessage({ type: 'recStop' }), shortcut);
    },

    stop() {
      if (!state) return null;
      const s = state;
      state = null;
      clearInterval(s.timer);
      s.stopIndicator?.();
      for (const type of ['scroll', 'mouseover', 'click']) window.removeEventListener(type, onEvent, { capture: true });
      const changes = [];
      const moved = new Map(); // element → vertical page-position change
      const transformed = new Set(s.tracked.filter((r) => r.series.transform).map((r) => r.el));
      const insideTransformed = (el) => {
        for (let p = el.parentElement; p; p = p.parentElement) if (transformed.has(p)) return true;
        return false;
      };
      for (const rec of s.tracked) {
        const pos = rec.series.position;
        // A transform animation (on the element or a parent) also moves the box;
        // that's not scroll-linked movement.
        if (pos && (rec.series.transform || insideTransformed(rec.el))) delete rec.series.position;
        else if (pos) moved.set(rec.el, Number(pos.at(-1)[1].split(',')[1]) - Number(pos[0][1].split(',')[1]));
      }
      for (const rec of s.tracked) {
        // Sticky/parallax: report the outermost element that moved, not each of its children.
        const dy = moved.get(rec.el);
        if (dy !== undefined) {
          for (let p = rec.el.parentElement; p; p = p.parentElement) {
            if (moved.has(p) && Math.abs(moved.get(p) - dy) < 3) {
              delete rec.series.position;
              break;
            }
          }
        }
        for (const [prop, series] of Object.entries(rec.series)) {
          if (series.length < 2) continue;
          changes.push({ ...rec.info, prop, samples: series.length, series: series.length > 40 ? [...series.slice(0, 20), ...series.slice(-20)] : series });
        }
      }
      return {
        duration: Math.round(performance.now() - s.t0),
        rect: s.rect,
        viewport: s.viewport,
        url: s.url,
        animations: s.animations,
        changes: changes.slice(0, 300),
        events: s.events,
        scroll: s.scroll.filter((_, i) => i % 3 === 0),
      };
    },

    active: () => !!state,
  };
})();
