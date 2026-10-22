import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMotion, parseTransform, parseTransitions, describeChange } from '../src/lib/motion.js';

// What content/motion.js records for a scroll reveal: 3 cards fade up one after another.
export const revealMotion = {
  duration: 3200,
  rect: { left: 0, top: 0, width: 1200, height: 700 },
  viewport: { width: 1280, height: 800 },
  url: 'https://tapeco.test/',
  events: [{ t: 250, type: 'scroll', y: 400 }, { t: 2100, type: 'hover', target: 'div.card', text: 'Masking tape' }],
  scroll: [[0, 0, 0], [300, 0, 400], [3000, 0, 420]],
  animations: [
    { type: 'css-animation', name: 'scroll-x', target: 'div.marquee > span', targetText: 'STICK BY YOU', duration: 8000, delay: 0, easing: 'linear', iterations: 'infinite', direction: 'normal', seenAt: 0, alreadyRunning: true,
      keyframes: [{ offset: 0, transform: 'translateX(0px)' }, { offset: 1, transform: 'translateX(-50%)' }] },
    { type: 'transition', name: 'box-shadow', target: 'div.grid > div.card', targetText: 'Masking tape', duration: 350, delay: 0, easing: 'ease', seenAt: 2150 },
  ],
  changes: [0, 1, 2].flatMap((i) => [
    { selector: `div.grid > div.card:nth-child(${i + 1})`, tag: 'div', text: ['Masking tape', 'OPP tape', 'Cloth tape'][i], prop: 'opacity',
      transition: 'opacity 0.6s ease-out, transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1)', samples: 8,
      series: [[0, '0'], [300 + i * 120, '0.3'], [500 + i * 120, '0.8'], [900 + i * 120, '1']] },
    { selector: `div.grid > div.card:nth-child(${i + 1})`, tag: 'div', text: ['Masking tape', 'OPP tape', 'Cloth tape'][i], prop: 'transform',
      transition: 'opacity 0.6s ease-out, transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1)', samples: 8,
      series: [[0, 'matrix(1, 0, 0, 1, 0, 40)'], [300 + i * 120, 'matrix(1, 0, 0, 1, 0, 25)'], [900 + i * 120, 'none']] },
  ]),
};

test('parses transforms and transitions', () => {
  assert.deepEqual(parseTransform('matrix(1, 0, 0, 1, 0, 40)'), { tx: 0, ty: 40, scale: 1, rotate: 0 });
  assert.deepEqual(parseTransitions('opacity 0.6s ease-out, transform 600ms cubic-bezier(0.2, 0.8, 0.2, 1) 0.1s').transform, { duration: 600, delay: 100, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  assert.match(describeChange('transform', 'matrix(1, 0, 0, 1, 0, 40)', 'none').text, /moves up 40px/);
});

test('scroll reveal becomes staggered effects with exact CSS timing', () => {
  const m = analyzeMotion(revealMotion);
  const fade = m.effects.find((e) => e.properties.includes('opacity'));
  assert.equal(fade.trigger.type, 'scroll');
  assert.equal(fade.count, 3);
  assert.equal(fade.duration, 600);
  assert.equal(fade.durationSource, 'css');
  assert.equal(fade.stagger, 120);
  assert.match(fade.text, /fades in .* when it scrolls into view over 600ms .*every ~120ms/);
  assert.match(fade.css, /\.is-visible/);
  const rise = m.effects.find((e) => e.properties.includes('transform') && e.kind !== 'keyframes');
  assert.match(rise.text, /moves up 40px/);
});

test('loops and hover transitions are recognised', () => {
  const m = analyzeMotion(revealMotion);
  const loop = m.effects.find((e) => e.kind === 'keyframes');
  assert.equal(loop.trigger.type, 'loop');
  assert.match(loop.css, /@keyframes scroll-x/);
  const hover = m.effects.find((e) => e.properties.includes('box-shadow'));
  assert.equal(hover.trigger.type, 'hover');
  assert.match(m.summary, /Triggers: .*scroll/);
});

test('no data is handled', () => {
  assert.equal(analyzeMotion(null).effects.length, 0);
});
