import { CATEGORIES } from '../lib/constants.js';

const $ = (sel) => document.querySelector(sel);
const send = (msg) => chrome.runtime.sendMessage(msg);

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

$('#page-title').textContent = tab?.title || 'This page';
try {
  $('#page-host').textContent = new URL(tab.url).hostname.replace(/^www\./, '');
} catch {
  $('#page-host').textContent = '';
}
if (tab?.favIconUrl) $('#favicon').src = tab.favIconUrl;
else $('#favicon').hidden = true;

for (const c of CATEGORIES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = c;
  b.setAttribute('aria-pressed', 'false');
  b.onclick = () => b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
  $('#categories').appendChild(b);
}

const { boards, lastBoardId } = await send({ type: 'getBoards' });
const select = $('#board');
for (const b of boards) select.add(new Option(b.name, b.id, false, b.id === lastBoardId));
select.add(new Option('+ New board…', '__new'));
select.onchange = () => {
  $('#new-board').hidden = select.value !== '__new';
  if (!$('#new-board').hidden) $('#new-board').focus();
};
const boardValue = () => (select.value === '__new' ? '__new:' + ($('#new-board').value.trim() || 'Untitled') : select.value);

function status(text, isError = false) {
  const el = $('#status');
  el.hidden = false;
  el.textContent = text;
  el.className = isError ? 'error' : '';
}

$('#open-board').onclick = async () => {
  await send({ type: 'openBoard' });
  window.close();
};

$('#pick').onclick = async () => {
  const res = await send({ type: 'startPicker', tabId: tab.id });
  if (res?.ok) window.close();
  else status(res?.error || 'Could not start the picker on this page.', true);
};

$('#page-form').onsubmit = async (e) => {
  e.preventDefault();
  const btn = $('#save-page');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  const res = await send({
    type: 'savePage',
    tabId: tab.id,
    windowId: tab.windowId,
    fields: {
      note: $('#note').value.trim(),
      categories: [...document.querySelectorAll('.chip[aria-pressed="true"]')].map((b) => b.textContent),
      tags: $('#tags').value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
      board: boardValue(),
    },
  });
  btn.disabled = false;
  btn.textContent = 'Save whole page';
  if (res?.ok) {
    status('Saved ✓ Open the board to see it.');
    $('#page-form').reset();
    document.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  } else {
    status(res?.error || 'Could not save this page.', true);
  }
};
