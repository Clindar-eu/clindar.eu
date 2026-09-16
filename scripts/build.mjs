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
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCatalogue } from './build-catalogue.mjs';
import {
  assertPrivacyPageShowsPolicy,
  assertScannerReachesNothing,
  assertScannerStylesMatchPolicy,
} from './check-scanner-csp.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const scanner = join(root, 'vendor', 'scanner');

// The scanner is served from a path, not the root, so its assets must be built
// with a matching base or every emitted URL 404s under /scanner/.
const SCANNER_BASE = '/scanner/';

// Canonical origin, for the sitemap. The pages carry their own <link rel=
// "canonical"> with the same value.
const SITE_ORIGIN = 'https://clindar.eu';

// Allowlist, not a denylist: the repo root also holds CLAUDE.md, Clindar.md and
// the brief in docs/, none of which should ever reach the public directory.
// Add new public files here as they are created.
const PUBLIC_ENTRIES = ['index.html', 'css', 'js', 'images', 'impact'];

// Copied into dist/scanner/ rather than served from the site root: it only ever
// runs on the scanner page and must be same-origin with it, because that page
// permits script from nowhere else.
//
// This used to be the email capture widget. It is now a link to the page that
// carries the form, because a form needs somewhere to post it and the scanner
// page is served with `connect-src 'none'` — see the /scanner/* block in
// netlify.toml for the whole argument.
const SCANNER_ENTRIES = ['scanner-signup-link.js', 'scanner-signup-link.css'];

// The capture widget itself, copied beside the page that mounts it. That page
// is under /impact/, where the site baseline permits the one same-origin POST
// the form needs.
const SUBSCRIBE_ENTRIES = ['scanner-capture.js', 'scanner-capture.css'];

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
 * Load the signup link from the scanner's HTML.
 *
 * Injected here rather than committed upstream because the URLs are
 * /scanner/-absolute: they are a fact about how this site serves the build, not
 * about the scanner. The scanner's own dev server simply has no link, which is
 * the right answer for it. What upstream does need is the container element and
 * the scanned event — see docs/scanner-integration.md.
 */
function linkSignupLink(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  if (html.includes('scanner-signup-link.js')) return;

  const tags =
    '    <link rel="stylesheet" href="/scanner/scanner-signup-link.css" />\n' +
    '    <script src="/scanner/scanner-signup-link.js" defer></script>\n';

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

/**
 * Fail the build if a secret from the environment reached the publish directory.
 *
 * On Netlify's free plan an environment variable cannot be scoped to Functions,
 * so ESP_API_KEY is present in the build environment on every build even though
 * only the subscribe function has any use for it. Nothing here reads it — the
 * only `process.env` in this repo is inside that function, at request time —
 * but "nothing reads it today" is a fact about the current code, and this
 * directory is served to the public. So check the artefact rather than trust
 * the code: whatever a future edit does, a secret that lands in dist/ stops the
 * deploy instead of shipping.
 *
 * Values are matched, never printed. A failure names the variable and the file.
 */
function assertNoSecretsInPublish() {
  const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)S?$/i;
  // Below this, a value is more likely to collide with ordinary page text than
  // to be a credential worth protecting.
  const MIN_SECRET_LENGTH = 8;

  const secrets = Object.entries(process.env).filter(
    ([name, value]) =>
      SECRET_NAME.test(name) && typeof value === 'string' && value.length >= MIN_SECRET_LENGTH,
  );

  if (secrets.length === 0) {
    console.log('  no secrets in the build environment to check for');
    return;
  }

  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(dist);

  // Bytes, not text: a secret that arrived through a font or an image is still
  // a published secret, and this way there is no encoding to be wrong about.
  for (const file of files) {
    const contents = readFileSync(file);
    for (const [name] of secrets) {
      if (contents.includes(Buffer.from(process.env[name], 'utf8'))) {
        throw new Error(
          `${name} reached the publish directory: ${file}\n` +
            'Nothing in the build may read a secret. Remove the reference; do not redeploy.',
        );
      }
    }
    if (contents.includes(Buffer.from('ESP_API_KEY', 'utf8'))) {
      // The name is not the secret, but nothing published has a reason to
      // mention it, and a page that names it is usually one edit from the value.
      console.warn(`  ! ${file} names ESP_API_KEY. Check why.`);
    }
  }

  console.log(
    `  ${files.length} files checked against ${secrets.length} secret(s) in the environment`,
  );
}

/** Write sitemap.xml and the robots.txt that points at it. */
function writeSitemap(paths) {
  const urls = paths
    .map((path) => `  <url><loc>${SITE_ORIGIN}${path}</loc></url>`)
    .join('\n');

  writeFileSync(
    join(dist, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
  );
  writeFileSync(
    join(dist, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`,
  );
  console.log(`  ${paths.length} urls`);
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

// The funnel lives in this repo, not in the scanner: it changes on the site's
// schedule, and keeping it here is what lets the scanner stay a thing that only
// reads files. Both halves are copied in beside the page that mounts them, so
// each loads under that page's own script-src 'self'.
step('copy signup link into dist/scanner');
for (const entry of SCANNER_ENTRIES) {
  const from = join(root, 'widget', entry);
  if (!existsSync(from)) throw new Error(`missing widget file: ${entry}`);
  cpSync(from, join(dist, 'scanner', entry));
  console.log(`  ${entry}`);
}
linkSignupLink(join(dist, 'scanner', 'index.html'));

// The form itself, beside the page that mounts it. The <link> and <script> tags
// are authored in impact/subscribe/index.html rather than injected: that page is
// ours, so there is nothing to discover about it at build time.
step('copy capture widget into dist/impact/subscribe');
for (const entry of SUBSCRIBE_ENTRIES) {
  const from = join(root, 'widget', entry);
  if (!existsSync(from)) throw new Error(`missing widget file: ${entry}`);
  cpSync(from, join(dist, 'impact', 'subscribe', entry));
  console.log(`  ${entry}`);
}

step('scanner CSP from netlify.toml');
const scannerCsp = scannerCspFromNetlifyToml();
applyScannerCsp(join(dist, 'scanner', 'index.html'), scannerCsp);
assertScannerStylesMatchPolicy({ policy: scannerCsp, scannerDir: join(dist, 'scanner') });
assertScannerReachesNothing({ policy: scannerCsp, scannerDir: join(dist, 'scanner') });
assertPrivacyPageShowsPolicy({
  policy: scannerCsp,
  privacyPage: join(dist, 'impact', 'privacy', 'index.html'),
});

// Read-only with respect to the submodule, and downstream of the scanner build
// so it renders the same catalogue the scanner was compiled against.
step('catalogue pages from the submodule');
const catalogue = buildCatalogue({ scannerDir: scanner, distDir: dist });
console.log(`  ${catalogue.ruleCount} rules from catalogue ${catalogue.version}`);

// The catalogue is only an SEO surface if it can be found. Fifty pages behind
// one index link is exactly the shape a crawler is slowest to walk on its own.
step('sitemap');
writeSitemap([
  '/',
  '/impact/',
  '/impact/privacy/',
  '/impact/subscribe/',
  '/scanner/',
  ...catalogue.paths,
]);

// Last, over the finished artefact: everything above has had its turn to write.
step('secret scan');
assertNoSecretsInPublish();

console.log('\nbuild complete -> dist/');
