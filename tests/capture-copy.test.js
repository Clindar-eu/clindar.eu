// The copy is the product claim, so it gets a test.
//
// The widget once said "Get the full written report" and "The report is on its
// way" over an endpoint that forwarded an address to a mailing list and stopped.
// Nothing failed, no test broke, and the sentence was simply untrue for as long
// as it was on screen. This file is what would have caught it.
//
// Run with `node --test tests/`.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const WIDGET = read('widget/scanner-capture.js');
const PRIVACY = read('impact/privacy/index.html');
const IMPACT = read('impact/index.html');

/**
 * Phrases that promise a report by email. Each is checked against the widget's
 * COPY object and the two pages that describe it. If a future change genuinely
 * emails a personalised report, this file changes in the same commit as the
 * code that sends it — and not a commit earlier.
 */
const DELIVERY_PROMISES = [
  'the report is on its way',
  'check your inbox',
  'send me the report',
  'get the full written report',
  'the written report',
  'report to your inbox',
  'emailed to you',
];

test('the widget promises no report by email', () => {
  const copy = WIDGET.slice(WIDGET.indexOf('var COPY = {'), WIDGET.indexOf('function el('));
  assert.ok(copy.length > 100, 'could not locate the COPY block');

  const lowered = copy.toLowerCase();
  for (const promise of DELIVERY_PROMISES) {
    assert.equal(lowered.includes(promise), false, `widget copy still says "${promise}"`);
  }
});

test('the scanner pages promise no report by email', () => {
  for (const [name, html] of [
    ['impact/privacy/index.html', PRIVACY],
    ['impact/index.html', IMPACT],
  ]) {
    const lowered = html.toLowerCase();
    for (const promise of DELIVERY_PROMISES) {
      // "emailed to you" is allowed only where the page is denying it.
      if (promise === 'emailed to you' && lowered.includes('cannot email it to you')) continue;
      assert.equal(lowered.includes(promise), false, `${name} still says "${promise}"`);
    }
  }
});

test('the widget still says what it does send, and what it does not', () => {
  assert.match(WIDGET, /never left this browser/);
  assert.match(WIDGET, /mailing list/i);
  // The confirmation names what happened — a subscription — and no more.
  assert.match(WIDGET, /done: 'Added to the list\.'/);
});

test('the widget has a distinct confirmation for a deploy that sent nothing', () => {
  assert.match(WIDGET, /dev: 'Development mode — nothing was sent\.'/);
  assert.match(WIDGET, /subscribed === false/);
  assert.match(read('widget/scanner-capture.css'), /clindar-capture__done--unsent/);
});

test('the widget and the function agree on the error codes', () => {
  const fn = read('netlify/functions/subscribe.js');
  const codes = [...fn.matchAll(/error: '([a-z_]+)'/g)].map((m) => m[1]);

  assert.ok(codes.includes('subscribe_failed'), 'the function no longer returns subscribe_failed');
  assert.equal(codes.includes('delivery_failed'), false, 'delivery_failed came back');

  // Every code the function can return has a sentence in the widget, and the
  // widget's fallback is one of them.
  for (const code of new Set(codes)) {
    if (code === 'method_not_allowed' || code === 'forbidden') continue;
    if (code === 'unsupported_media_type' || code === 'invalid_json') continue;
    if (code === 'payload_too_large') continue;
    assert.ok(WIDGET.includes(`${code}:`), `the widget has no message for ${code}`);
  }
});

test('the privacy page still describes the exact payload a reader can verify', () => {
  assert.match(PRIVACY, /\{"email":"…"\}/);
  assert.match(PRIVACY, /\/\.netlify\/functions\/subscribe/);
  // The report being local is the load-bearing half of the corrected claim.
  // Collapsed, because the sentence is wrapped across lines in the source.
  assert.match(PRIVACY.replace(/\s+/g, ' '), /downloads out of the tab/i);
});
