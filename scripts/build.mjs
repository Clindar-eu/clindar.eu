// Site build: assemble dist/ from the static site plus the scanner submodule.
//
// Deliberately dependency-free — plain Node, no package.json at the site root.
// Netlify therefore runs no install step for the site itself; the only npm
// install that happens is the scanner's own, inside vendor/scanner.

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
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
const PUBLIC_ENTRIES = ['index.html', 'css', 'js', 'images'];

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

console.log('\nbuild complete -> dist/');
