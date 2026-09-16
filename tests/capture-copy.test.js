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
const LINK = read('widget/scanner-signup-link.js');
const PRIVACY = read('impact/privacy/index.html');
const IMPACT = read('impact/index.html');
const SUBSCRIBE = read('impact/subscribe/index.html');

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
  assert.match(WIDGET, /never left your browser/);
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

/**
 * Claims that are false the moment the mailing list exists.
 *
 * The scanner header once said "once this page has loaded the scanner makes no
 * network request at all" while the widget below it posted an address to a
 * same-origin path. These pages make the same argument to the same reader, and
 * a reader who finds one overstatement stops trusting the careful sentences
 * around it — which are the ones doing the real work.
 *
 * Scoped to the rendered prose, not the source: the pages explain in comments
 * why the absolute wording went, and quoting it there is how the next editor
 * learns not to reintroduce it.
 */
const OVERCLAIMS = [
  'no network request at all',
  'nothing can leave',
  'nowhere to send it',
  'physically incapable',
  'makes no request after',
];

/** HTML with comments and tags removed, collapsed to comparable prose. */
const prose = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();

test('neither scanner page claims more than the mailing list allows', () => {
  for (const [name, html] of [
    ['impact/index.html', IMPACT],
    ['impact/privacy/index.html', PRIVACY],
  ]) {
    const text = prose(html);
    for (const claim of OVERCLAIMS) {
      assert.equal(text.includes(claim), false, `${name} claims "${claim}"`);
    }
  }
});

test('the landing page scopes its no-request claim to scanning', () => {
  const text = prose(IMPACT);

  assert.ok(
    text.includes('scanning itself makes no network request'),
    'the landing page no longer scopes the claim to the act of scanning',
  );
  // The exception has to be on the same page as the claim, or the claim is the
  // only half a skimming reader takes away.
  assert.ok(
    text.includes('one request can happen'),
    'the landing page stopped disclosing the optional mailing-list request',
  );
});

test('the privacy page forbids script, and carries none', () => {
  // Two halves of one claim, checked together because either alone is
  // reassuring and wrong. The page tells a DPO that no script runs here; the
  // header is what makes that enforced rather than a description of today's
  // markup, and the markup is what makes the header honest rather than
  // aspirational.
  const toml = read('netlify.toml');
  const block = toml.slice(toml.indexOf('for = "/impact/privacy/*"'));
  const policy = block.match(/Content-Security-Policy = "([^"]+)"/);
  assert.ok(policy, 'the privacy page has no headers block of its own');

  assert.match(policy[1], /script-src 'none'/, "the privacy page's script-src widened");
  assert.ok(
    !/connect-src[^;]*plausible/.test(policy[1]),
    'connect-src permits plausible again on a page that can run no script',
  );
  assert.ok(
    !/script-src[^;]*plausible/.test(policy[1]),
    'script-src permits plausible again on the page that says it loads none',
  );

  assert.ok(!/<script/i.test(PRIVACY), 'the privacy page grew a script the header forbids');
  assert.ok(!/\son[a-z]+\s*=/i.test(PRIVACY), 'the privacy page grew an inline event handler');
});

test('the widget is still the only thing in the site that can post the address', () => {
  // If a second sender ever appears, the pages above describe a payload that is
  // no longer the only one, and this test is the thing that says so.
  //
  // scanner-signup-link.js is in the list precisely because it is the file most
  // likely to grow one: it sits where the form used to sit, on a page whose
  // policy would refuse the request.
  const senders = [
    'widget/scanner-capture.js',
    'widget/scanner-signup-link.js',
    'js/plausible-init.js',
    'js/impact-analytics.js',
  ]
    .map((p) => [p, read(p)])
    .filter(([, body]) => /\/\.netlify\/functions\/subscribe/.test(body))
    .map(([p]) => p);

  assert.deepEqual(senders, ['widget/scanner-capture.js']);
});

/*
 * The split funnel.
 *
 * The capture form used to be injected onto the scanner page, and that one form
 * was the whole reason the scanner's policy read `connect-src 'self'`. It now
 * lives on /impact/subscribe/ and the scanner carries a link instead. These
 * tests hold the two halves of that apart, because the cheapest way to undo it
 * is to put a form back where the link is and never notice the console error.
 */

test("the scanner's policy permits no connection at all", () => {
  const toml = read('netlify.toml');
  const block = toml.slice(toml.indexOf('for = "/scanner/*"'));
  const policy = block.match(/Content-Security-Policy = "([^"]+)"/);
  assert.ok(policy, 'the scanner has no headers block of its own');

  assert.match(policy[1], /connect-src 'none'/, "the scanner's connect-src widened");
  assert.ok(
    !/connect-src[^;]*plausible/.test(policy[1]),
    'connect-src permits plausible on the scanner page',
  );
  assert.match(policy[1], /form-action 'none'/, 'the scanner page may now post a form');
});

/**
 * JavaScript with its comments removed.
 *
 * The files below document what they must never do — "it may not call fetch,
 * XMLHttpRequest or sendBeacon", "it may not read event.detail" — and a test
 * that greps the raw source fails on the sentence forbidding the thing. That is
 * the kind of failure that gets a test deleted rather than fixed, so the prose
 * comes out first and only the code is judged.
 */
const code = (js) => js.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ 	]*\/\/.*$/gm, ' ');

test('the scanner page carries a link, and nothing that can make a request', () => {
  const body = code(LINK);
  for (const primitive of [/fetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /new WebSocket/, /EventSource/]) {
    assert.equal(primitive.test(body), false, `the signup link now uses ${primitive}`);
  }
  // A form needs somewhere to post, and this page has nowhere.
  assert.equal(/createElement\(\s*(['"`])form/.test(body), false, 'the signup link builds a form');
  assert.match(LINK, /SIGNUP_URL = '\/impact\/subscribe\/'/);
});

test('the scanner page passes nothing about the scan to the signup page', () => {
  // The scanner dispatches its event with no detail at all, and this file must
  // not start expecting one. A query string is the other way scan context could
  // reach the next page, so the href is asserted to be a bare path.
  const body = code(LINK);
  assert.equal(/\.detail/.test(body), false, 'the signup link reads the event detail');
  assert.equal(/[?#]/.test("/impact/subscribe/"), false);

  const hrefs = [...body.matchAll(/href = ([A-Z_]+);/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ['SIGNUP_URL', 'PRIVACY_URL'], 'the link now builds an href at runtime');

  for (const leak of ['score', 'band', 'finding', 'ruleId', 'fileName', 'study', 'category', 'count']) {
    assert.equal(
      new RegExp(`(search|hash|query|params)[^
]*${leak}`, 'i').test(body),
      false,
      `the signup link now carries ${leak}`,
    );
  }
});

test('the signup page mounts the form, open, and says which page sends what', () => {
  assert.match(SUBSCRIBE, /data-clindar-capture="open"/);
  assert.match(SUBSCRIBE, /\/impact\/subscribe\/scanner-capture\.js/);

  const text = prose(SUBSCRIBE);
  // Both halves of the distinction, on the page that is one of them.
  assert.ok(text.includes("connect-src 'none'"), 'the signup page stopped naming the scanner policy');
  assert.ok(
    text.includes('/.netlify/functions/subscribe'),
    'the signup page stopped naming the endpoint it posts to',
  );
  assert.ok(text.includes('{"email":"…"}'), 'the signup page stopped printing the payload');
});

test('the widget sends the address, and the honeypot only when it is filled', () => {
  // The exact body the privacy page prints for a reader to compare against
  // their own network panel. The honeypot rides along only when something
  // automated filled a field no human can see.
  assert.match(WIDGET, /var payload = \{ email: email \};/);
  assert.match(WIDGET, /if \(instance\.trap\.value !== ''\) payload\.company = instance\.trap\.value;/);

  // Nothing about the scan is assembled into the request. The score arrives on
  // the reveal event and decides visibility; it must never reach the body.
  const submit = WIDGET.slice(WIDGET.indexOf('function submitForm('), WIDGET.indexOf('.then(function (response)'));
  for (const leak of ['score', 'band', 'finding', 'ruleId', 'fileName', 'study', 'result']) {
    assert.equal(
      new RegExp(`payload\\.${leak}`, 'i').test(submit),
      false,
      `the request body now carries ${leak}`,
    );
  }
});
