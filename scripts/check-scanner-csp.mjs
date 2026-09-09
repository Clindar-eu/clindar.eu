// Build-time checks on the scanner's Content-Security-Policy.
//
// A tightened directive is cheap to write and expensive to be wrong about. A
// page that needs an inline style under `style-src 'self'` does not fail
// loudly: it renders unstyled, in the visitor's browser, on a page nobody on
// this side is looking at. So the artefact is checked rather than the
// intention, on every build, against the policy that will actually be sent.
//
// Extracted from build.mjs so the checks themselves can be tested. A guard that
// silently passes when it should fail is worse than no guard, and that is not a
// failure a build you keep running successfully will ever show you — see
// tests/scanner-csp.test.js.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** One directive's source list, falling back to default-src the way a browser does. */
export function cspDirective(policy, name) {
  const parts = policy.split(';').map((part) => part.trim());
  const matches = (part, directive) => part === directive || part.startsWith(`${directive} `);

  const found =
    parts.find((part) => matches(part, name)) ??
    (name === 'default-src' ? undefined : parts.find((part) => matches(part, 'default-src')));

  if (found === undefined) return null;
  return found.split(/\s+/).slice(1);
}

// What style-src actually governs, and nothing else.
//
// In markup: <style> elements, and style="" attributes. At runtime: the two
// calls that produce either of those. Assigning through CSSOM — `el.style.color
// = ...`, which is what React's style prop compiles to — is exempt from
// style-src by specification, and is deliberately not looked for here: a check
// that forbids what the browser allows is a check that gets deleted.
const INLINE_STYLE_IN_MARKUP = [
  ['a <style> element', /<style[\s>]/i],
  ['a style="" attribute', /\sstyle\s*=\s*["']/i],
];
const INLINE_STYLE_AT_RUNTIME = [
  ['a <style> element built at runtime', /createElement\(\s*(['"`])style\1/],
  ['a style attribute set at runtime', /setAttribute\(\s*(['"`])style\1/],
];

function filesUnder(dir) {
  const files = [];
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(dir);
  return files;
}

/**
 * Fail if the policy forbids inline styles and the built scanner still uses them.
 *
 * THE SCANNER PAGE ONLY, AND THAT DISTINCTION IS THE WHOLE DESIGN. The
 * downloadable report is full of inline styles — it has to be, being one file
 * that must render on its own from somebody's disk — and its markup lives in
 * this bundle as a template string. It is also not governed by this policy or
 * any other of ours: it is written to a Blob, saved, and opened from the
 * filesystem.
 *
 * So markup is judged in the HTML files, where a <style> tag really is a <style>
 * tag, and JavaScript is judged only on the two calls that would build one at
 * runtime. A grep for `<style` across the bundle would fail on the report every
 * time, and a check that cries wolf on correct code does not survive its second
 * build.
 *
 * The runtime half is a static reading of minified code and cannot see a tag
 * name held in a variable. It is a tripwire for the ordinary mistake, not a
 * proof. The proof is the browser, which is why the same policy also goes into
 * the page's own meta tag where a visitor's browser enforces it on the spot.
 */
export function assertScannerStylesMatchPolicy({ policy, scannerDir, log = console.log }) {
  const sources = cspDirective(policy, 'style-src') ?? [];
  if (sources.includes("'unsafe-inline'")) {
    log("  style-src permits 'unsafe-inline'; nothing to check");
    return;
  }

  const files = filesUnder(scannerDir);
  const found = [];

  for (const file of files) {
    const rules = file.endsWith('.html')
      ? INLINE_STYLE_IN_MARKUP
      : file.endsWith('.js')
        ? INLINE_STYLE_AT_RUNTIME
        : [];
    if (rules.length === 0) continue;

    // Comments come out of the HTML first. A <style> inside <!-- --> is not a
    // style element, and the scanner's own index.html explains this exact
    // policy inside one — so without this the check trips over the document
    // that documents it, which is the kind of failure that gets a check
    // deleted rather than fixed.
    const text = readFileSync(file, 'utf8');
    const subject = file.endsWith('.html') ? text.replace(/<!--[\s\S]*?-->/g, '') : text;

    for (const [what, re] of rules) {
      const hit = subject.match(re);
      if (hit) found.push(`${file}: ${what} (${JSON.stringify(hit[0])})`);
    }
  }

  if (found.length > 0) {
    throw new Error(
      `the scanner policy sets style-src ${sources.join(' ')}, which forbids inline ` +
        `styles, but the built page uses them:\n  ${found.join('\n  ')}\n` +
        'Move the rule into a same-origin stylesheet. Reopening the directive is the ' +
        'last resort, not the first, and it reopens it for the whole page.',
    );
  }
  log(`  no inline styles in ${files.length} scanner files`);
}

/**
 * Fail if the policy permits no connection and the built scanner names one.
 *
 * `connect-src 'none'` is the scanner's whole privacy claim in one directive,
 * and it is a claim the browser will keep whatever the bundle says: a fetch to
 * a named endpoint under this policy is refused, not honoured. So the risk this
 * guards is not exfiltration — it is a page that has quietly acquired a feature
 * which now fails in the console of every visitor who uses it, on the one page
 * that promises a clean network panel.
 *
 * That is exactly how the email capture widget behaved before it moved to
 * /impact/subscribe/: it was copied into dist/scanner/ by this build, and one
 * same-origin POST was the entire reason the policy read 'self'. If a future
 * edit puts it back, or adds anything else that names an endpoint, the build
 * stops here rather than shipping a form that cannot submit.
 *
 * Named destinations only, and deliberately so. A blanket search for `fetch(`
 * would fail on Vite's module-preload polyfill, which is present in every build
 * and reaches nothing — and a check that cries wolf on correct code does not
 * survive its second build. What this looks for is a URL somebody wrote.
 */
export function assertScannerReachesNothing({ policy, scannerDir, log = console.log }) {
  const sources = cspDirective(policy, 'connect-src') ?? [];
  if (!(sources.length === 1 && sources[0] === "'none'")) {
    log(`  connect-src permits ${sources.join(' ') || 'nothing declared'}; nothing to check`);
    return;
  }

  const NAMED_DESTINATION = [
    ['the subscribe function', /\/\.netlify\/functions\//],
    ['the capture widget, which posts to it', /scanner-capture\.(js|css)/],
  ];

  const found = [];
  for (const file of filesUnder(scannerDir)) {
    if (!/\.(html|js|css)$/.test(file)) continue;

    // Comments come out of the HTML first, for the same reason as above: the
    // scanner's index.html explains this policy in prose, and a check that
    // trips over the document explaining it is a check that gets deleted.
    const text = readFileSync(file, 'utf8');
    const subject = file.endsWith('.html') ? text.replace(/<!--[\s\S]*?-->/g, '') : text;

    for (const [what, re] of NAMED_DESTINATION) {
      const hit = subject.match(re);
      if (hit) found.push(`${file}: ${what} (${JSON.stringify(hit[0])})`);
    }
  }

  if (found.length > 0) {
    throw new Error(
      "the scanner policy sets connect-src 'none', so the page can open no connection " +
        'at all, but the built page names one:\n  ' +
        found.join('\n  ') +
        '\nMove whatever needs it to a page that is allowed one — /impact/subscribe/ is ' +
        'where the mailing-list form went, and why. Reopening this directive changes what ' +
        '/impact/privacy/ can tell a DPO, so it is a product decision and not a build fix.',
    );
  }
  log("  connect-src 'none': the built scanner names no endpoint");
}

/**
 * Fail if /impact/privacy/ prints a policy the site does not send.
 *
 * That page quotes the scanner's CSP verbatim and then reasons about it in front
 * of a reader deciding whether to trust us with a Define-XML. A quoted policy
 * one edit behind the deployed one is not a stale doc — it is a false statement
 * about what a browser is enforcing, on the page whose entire job is to be
 * checkable.
 */
export function assertPrivacyPageShowsPolicy({ policy, privacyPage, log = console.log }) {
  const html = readFileSync(privacyPage, 'utf8');
  const quoted = [...html.matchAll(/<span class="impact-code">(default-src[^<]*)<\/span>/g)].map(
    (match) => match[1],
  );

  if (quoted.length === 0) {
    throw new Error(`${privacyPage} quotes no policy; it is supposed to print the scanner's`);
  }
  for (const shown of quoted) {
    if (shown !== policy) {
      throw new Error(
        `${privacyPage} prints a policy the site does not send.\n` +
          `  shown:  ${shown}\n  sent:   ${policy}`,
      );
    }
  }
  log(`  privacy page quotes the policy verbatim (${quoted.length}x)`);
}
