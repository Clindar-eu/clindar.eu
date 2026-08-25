// Site build: assemble dist/ from the static site plus the scanner submodule.
//
// Deliberately dependency-free — plain Node, no package.json at the site root.
// Netlify therefore runs no install step for the site itself; the only npm
// install that happens is the scanner's own, inside vendor/scanner.

import { execSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const scanner = join(root, 'vendor', 'scanner');

// The scanner is served from a path, not the root, so its assets must be built
// with a matching base or every emitted URL 404s under /scanner/.
const SCANNER_BASE = '/scanner/';

// Allowlist, not a denylist: the repo root also holds CLAUDE.md, Clindar.md and
// the brief in docs/, none of which should ever reach the public directory.
// Add new public files here as they are created.
const PUBLIC_ENTRIES = ['index.html', 'css', 'js', 'images', 'impact'];

// Copied into dist/scanner/ rather than served from the site root: the widget
// only ever runs on the scanner page, and it must be same-origin with it.
const WIDGET_ENTRIES = ['scanner-capture.js', 'scanner-capture.css'];

// Run through a shell: npm is a .cmd shim on Windows, which recent Node
// refuses to spawn directly. Every command below is a fixed string with no
// interpolated input, so there is nothing here for a shell to mis-parse.
function run(cmd, cwd) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function step(label) {
  console.log(`\n== ${label}`);
}

// ---------------------------------------------------------------------------
// The scanner's Content-Security-Policy.
//
// A <meta http-equiv> policy and a response-header policy are BOTH enforced,
// and they compose by intersection: a request has to satisfy each of them. So a
// policy shipped inside the scanner's own index.html can never be relaxed by
// netlify.toml, only tightened — and keeping the same policy in two repos
// invites them to drift apart with nothing checking.
//
// netlify.toml is therefore the one place the policy is written. The built
// index.html gets a meta tag generated from it: identical by construction, so
// the intersection is exactly the header, and the page still carries its own
// copy for anyone who saves it or serves it from somewhere that sends no
// headers at all.
// ---------------------------------------------------------------------------

const CSP_META_RE = new RegExp(
  '[ \\t]*<meta\\s[^>]*http-equiv=["\']Content-Security-Policy["\'][^>]*>\\s*\\n',
  'gi',
);

/**
 * Load the capture widget from the scanner's HTML.
 *
 * Injected here rather than committed upstream because the URLs are
 * /scanner/-absolute: they are a fact about how this site serves the build, not
 * about the scanner. The scanner's own dev server simply has no widget, which
 * is the right answer for it. What upstream does need is the container element
 * and the scored event — see docs/scanner-integration.md.
 */
function linkWidget(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  if (html.includes('scanner-capture.js')) return;

  const tags =
    '    <link rel="stylesheet" href="/scanner/scanner-capture.css" />\n' +
    '    <script src="/scanner/scanner-capture.js" defer></script>\n';

  const closing = html.match(/([ \t]*)<\/head>/i);
  if (!closing) throw new Error(`no </head> in ${htmlPath}`);
  writeFileSync(htmlPath, html.replace(closing[0], tags + closing[0]));
  console.log('  linked from scanner/index.html');
}

/** The CSP netlify.toml applies to /scanner/*. */
function scannerCspFromNetlifyToml() {
  const toml = readFileSync(join(root, 'netlify.toml'), 'utf8');

  // Enough TOML for this file's shape: split on the [[headers]] table markers
  // and take the block whose `for` is the scanner path.
  const block = toml
    .split(/^\[\[headers\]\]\s*$/m)
    .slice(1)
    .find((b) => /^\s*for\s*=\s*"\/scanner\/\*"\s*$/m.test(b));
  if (!block) {
    throw new Error('netlify.toml has no [[headers]] block for "/scanner/*"');
  }

  const match = block.match(/^\s*Content-Security-Policy\s*=\s*"([^"]+)"\s*$/m);
  if (!match) {
    throw new Error(
      'the "/scanner/*" headers block in netlify.toml sets no Content-Security-Policy',
    );
  }

  const policy = match[1].trim();
  if (/[<>"]/.test(policy)) {
    throw new Error(`scanner CSP holds characters unsafe to inline: ${policy}`);
  }
  if (!/(^|;)\s*connect-src\s/.test(policy)) {
    // connect-src is the directive the privacy claim rests on. Its absence
    // would silently fall back to default-src, which nobody would have meant.
    throw new Error(`scanner CSP sets no connect-src: ${policy}`);
  }
  return policy;
}

/** Replace whatever CSP the scanner build shipped with the one from netlify.toml. */
function applyScannerCsp(htmlPath, policy) {
  const html = readFileSync(htmlPath, 'utf8');

  const shipped = html.match(CSP_META_RE) ?? [];
  if (shipped.length > 0) {
    // Not fatal — what deploys is still the policy below — but it means the
    // scanner has started authoring one again, and the two would drift.
    console.warn(
      `  ! the scanner build shipped ${shipped.length} CSP meta tag(s); replacing them.\n` +
        '    Remove it upstream: netlify.toml owns this policy.',
    );
  }

  const stripped = html.replace(CSP_META_RE, '');
  const meta =
    '    <meta\n' +
    '      http-equiv="Content-Security-Policy"\n' +
    `      content="${policy}"\n` +
    '    />\n';

  // Ahead of the first script or stylesheet, so the policy is in force before
  // the parser reaches anything it governs.
  const anchor = stripped.search(/[ \t]*<(script|link)\b/i);
  if (anchor === -1) {
    throw new Error(`no <script> or <link> in ${htmlPath} to place the CSP before`);
  }
  const out = stripped.slice(0, anchor) + meta + stripped.slice(anchor);

  // The whole point of generating it: what ships is what netlify.toml says.
  if ((out.match(CSP_META_RE) ?? []).length !== 1 || !out.includes(`content="${policy}"`)) {
    throw new Error(`failed to apply the scanner CSP to ${htmlPath}`);
  }

  writeFileSync(htmlPath, out);
  console.log(`  ${policy}`);
}

step('clean');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

step('copy static site');
for (const entry of PUBLIC_ENTRIES) {
  const from = join(root, entry);
  if (!existsSync(from)) throw new Error(`missing public entry: ${entry}`);
  cpSync(from, join(dist, entry), { recursive: true });
  console.log(`  ${entry}`);
}

step('scanner submodule');
if (!existsSync(join(scanner, 'package.json'))) {
  // Netlify initialises submodules itself, but a fresh local clone may not have.
  run('git submodule update --init --recursive', root);
}
run('npm ci', scanner);
run('npm run build:rules', scanner);
run(`npm -w @clindar/web run build -- --base=${SCANNER_BASE}`, scanner);

step('copy scanner into dist/scanner');
const scannerDist = join(scanner, 'apps', 'web', 'dist');
if (!existsSync(join(scannerDist, 'index.html'))) {
  throw new Error(`scanner build produced no index.html at ${scannerDist}`);
}
cpSync(scannerDist, join(dist, 'scanner'), { recursive: true });

// The capture widget lives in this repo, not in the scanner: it is the site's
// funnel, it changes on the site's schedule, and keeping it here is what lets
// the scanner stay a thing that only reads files. It is copied in beside the
// scanner's own assets so it loads under script-src 'self'.
step('copy capture widget into dist/scanner');
for (const entry of WIDGET_ENTRIES) {
  const from = join(root, 'widget', entry);
  if (!existsSync(from)) throw new Error(`missing widget file: ${entry}`);
  cpSync(from, join(dist, 'scanner', entry));
  console.log(`  ${entry}`);
}
linkWidget(join(dist, 'scanner', 'index.html'));

step('scanner CSP from netlify.toml');
applyScannerCsp(join(dist, 'scanner', 'index.html'), scannerCspFromNetlifyToml());

console.log('\nbuild complete -> dist/');
