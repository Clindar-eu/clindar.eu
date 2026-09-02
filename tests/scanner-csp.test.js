// Tests for scripts/check-scanner-csp.mjs — the build-time guard on the
// scanner's Content-Security-Policy.
//
// The failure that matters here is not a build that stops; it is a build that
// does not. `style-src 'self'` with an inline style still on the page produces
// no error anywhere on this side: the page just renders unstyled, once, in a
// visitor's browser. So every test below is a page that must be REFUSED, and
// the ones that must be accepted are here to stop the guard being fixed by
// making it fail on everything.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SELF = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'";
const INLINE = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'";

/** The module under test, loaded once. It is ESM; these tests are CommonJS. */
let csp;
test.before(async () => {
  csp = await import('../scripts/check-scanner-csp.mjs');
});

/** A throwaway scanner build directory holding exactly the files given. */
function scannerDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clindar-csp-'));
  for (const [name, contents] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return dir;
}

const quiet = () => {};
const check = (policy, files) =>
  csp.assertScannerStylesMatchPolicy({ policy, scannerDir: scannerDir(files), log: quiet });

// ---------------------------------------------------------------------------
// Reading the policy.
// ---------------------------------------------------------------------------

test('a directive is read as its source list, and falls back to default-src', () => {
  assert.deepEqual(csp.cspDirective(SELF, 'style-src'), ["'self'"]);
  assert.deepEqual(csp.cspDirective(INLINE, 'style-src'), ["'self'", "'unsafe-inline'"]);
  // Absent, so a browser would apply default-src. Reading it any other way
  // would let a policy that says nothing about styles pass as if it forbade
  // them, or as if it allowed everything.
  assert.deepEqual(csp.cspDirective("default-src 'self'; script-src 'self'", 'style-src'), [
    "'self'",
  ]);
  assert.equal(csp.cspDirective("script-src 'self'", 'style-src'), null);
  // A directive whose name is a prefix of another must not answer for it.
  assert.equal(csp.cspDirective("style-src-attr 'none'", 'style-src'), null);
});

// ---------------------------------------------------------------------------
// What has to be refused.
// ---------------------------------------------------------------------------

test('a <style> element in the built page stops the build', () => {
  assert.throws(
    () => check(SELF, { 'index.html': '<head><style>body{color:red}</style></head>' }),
    /a <style> element/,
  );
});

test('a style attribute in the built page stops the build', () => {
  assert.throws(
    () => check(SELF, { 'index.html': '<div class="x" style="color:red">hi</div>' }),
    /a style="" attribute/,
  );
});

test('a style element or attribute built at runtime stops the build', () => {
  assert.throws(
    () => check(SELF, { 'assets/app.js': 'const s=document.createElement("style");' }),
    /built at runtime/,
  );
  assert.throws(
    () => check(SELF, { 'assets/app.js': "el.setAttribute('style', 'color:red');" }),
    /set at runtime/,
  );
  // Template literals count too; a bundler is free to emit either quote style.
  assert.throws(
    () => check(SELF, { 'scanner-capture.js': 'document.createElement(`style`)' }),
    /built at runtime/,
  );
});

test('the failure names the file and quotes what it found', () => {
  assert.throws(
    () => check(SELF, { 'index.html': '<p style="color:red">x</p>' }),
    (error) => error.message.includes('index.html') && error.message.includes('style='),
  );
});

// ---------------------------------------------------------------------------
// What has to be accepted, so the guard stays usable.
// ---------------------------------------------------------------------------

test('the page the scanner actually builds passes', () => {
  check(SELF, {
    'index.html':
      '<head><link rel="stylesheet" href="/scanner/assets/index.css">' +
      '<script type="module" src="/scanner/assets/index.js"></script></head>' +
      '<body><div id="root"></div></body>',
    'assets/index.js': 'document.createElement("a").click();',
    'assets/index.css': '.drop{border:2px dashed}',
  });
});

test('a <style> inside an HTML comment is not a style element', () => {
  // The scanner's own index.html documents this policy in a comment that names
  // <style>. Tripping over the document that documents the rule is how a check
  // gets deleted instead of fixed.
  check(SELF, {
    'index.html': '<!-- this build builds no <style> element and sets no style="" -->\n<div></div>',
  });
});

test("the report's inline styles do not count against the page", () => {
  // The downloaded report is a separate document, opened from disk, governed by
  // no policy of ours - and its markup lives in the page's bundle as a template
  // string. Judging JavaScript on markup would fail this on every build.
  check(SELF, {
    'assets/index.js':
      'const report = `<style>.sev{font-weight:600}</style>' +
      '<span class="dot" style="background:${color}"></span>`;',
  });
});

test('CSS files are not searched for markup', () => {
  check(SELF, { 'assets/index.css': '.x{background:url(data:image/svg+xml,<style>)}' });
});

test("nothing is checked when the policy still permits 'unsafe-inline'", () => {
  // The guard is about keeping a promise the policy makes. Where the policy
  // makes no such promise there is nothing to enforce, and enforcing it anyway
  // would block the documented way back out.
  check(INLINE, { 'index.html': '<style>body{color:red}</style>' });
});

// ---------------------------------------------------------------------------
// The policy the privacy page prints.
// ---------------------------------------------------------------------------

function privacyPage(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clindar-privacy-'));
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, body);
  return file;
}

test('a quoted policy that matches what is sent passes', () => {
  csp.assertPrivacyPageShowsPolicy({
    policy: SELF,
    privacyPage: privacyPage(`<p><span class="impact-code">${SELF}</span></p>`),
    log: quiet,
  });
});

test('a quoted policy one edit behind the deployed one stops the build', () => {
  assert.throws(
    () =>
      csp.assertPrivacyPageShowsPolicy({
        policy: SELF,
        privacyPage: privacyPage(`<p><span class="impact-code">${INLINE}</span></p>`),
        log: quiet,
      }),
    /prints a policy the site does not send/,
  );
});

test('a privacy page that quotes no policy at all stops the build', () => {
  // Deleting the quotation is not a way to pass this check.
  assert.throws(
    () =>
      csp.assertPrivacyPageShowsPolicy({
        policy: SELF,
        privacyPage: privacyPage('<p>We take your privacy seriously.</p>'),
        log: quiet,
      }),
    /quotes no policy/,
  );
});

test('every quoted policy has to agree, not just the first', () => {
  assert.throws(
    () =>
      csp.assertPrivacyPageShowsPolicy({
        policy: SELF,
        privacyPage: privacyPage(
          `<span class="impact-code">${SELF}</span>` +
            `<span class="impact-code">${INLINE}</span>`,
        ),
        log: quiet,
      }),
    /prints a policy the site does not send/,
  );
});
