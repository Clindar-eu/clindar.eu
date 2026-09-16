// Tests for the generated rules catalogue under /catalogue/, and for the
// product navigation that points at it.
//
// WHY THIS FILE EXISTS. Rules 0.15.1 deleted `severity`, `effort`,
// `effortGroup`, `supersedes`, `requires` and `reportOnce` from the governed
// catalogue. The generator went on reading `rule.severity`, and a missing field
// in a template literal is not an error — it is the word `undefined`, rendered
// once per rule, on a public page that exists to be checked by sceptical
// readers. Nothing failed. Nothing could fail. So the assertions below are
// about the artefact: what the pages actually say, not what the generator
// meant.
//
// The catalogue is built into a throwaway directory rather than read out of
// dist/, so a stale dist cannot make this file pass. It needs the submodule
// (for the YAML and for the scanner's own `yaml` parser) and skips without it,
// because CI checks this repo out without submodules on purpose — see
// .github/workflows/responsive.yml.
//
// Run with `node --test tests/`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const HOMEPAGE = read('index.html');
const IMPACT_CSS = read('css/impact.css');

const scannerDir = path.join(root, 'vendor', 'scanner');
const yamlPath = path.join(
  scannerDir, 'packages', 'rules', 'catalogue', 'sdtmig-4.0.yaml',
);
const haveSubmodule =
  fs.existsSync(yamlPath) &&
  fs.existsSync(path.join(scannerDir, 'node_modules', 'yaml', 'package.json'));
const skip = haveSubmodule
  ? false
  : 'vendor/scanner is not installed; run `git submodule update --init` and `npm ci` in it';

/** The generated catalogue, built once into a temp directory. */
const pages = new Map(); // url path -> html
let index = '';

test.before(async () => {
  if (!haveSubmodule) return;
  const { buildCatalogue } = await import('../scripts/build-catalogue.mjs');
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'clindar-catalogue-'));
  const built = buildCatalogue({ scannerDir, distDir: dist });

  for (const urlPath of built.paths) {
    const file = path.join(dist, urlPath.replace(/^\//, ''), 'index.html');
    pages.set(urlPath, fs.readFileSync(file, 'utf8'));
  }
  index = pages.get('/catalogue/');
  assert.ok(index, 'the build produced no /catalogue/ index');
});

// ---------------------------------------------------------------------------
// 1. Product navigation.
// ---------------------------------------------------------------------------

test('the homepage footer offers the Impact Scanner under Product', () => {
  // The Product column, not the page at large: the link has to be findable
  // from the footer nav, which is where the other pages carry it.
  const product = HOMEPAGE.slice(
    HOMEPAGE.indexOf('aria-label="Product links"'),
    HOMEPAGE.indexOf('aria-label="Company links"'),
  );
  assert.ok(product.length > 50, 'could not locate the footer Product nav');

  assert.match(product, /<a href="\/impact\/" class="footer__link">Impact Scanner<\/a>/);
  // The two that were already there stay there.
  assert.match(product, /CDISC Validator<\/a>/);
  assert.match(product, /Request Early Access<\/a>/);
});

test('the catalogue pages carry the same Product column as the rest of the site', { skip }, () => {
  for (const [urlPath, html] of pages) {
    const product = html.slice(
      html.indexOf('aria-label="Product links"'),
      html.indexOf('aria-label="Company links"'),
    );
    assert.ok(product.includes('href="/scanner/"'), `${urlPath}: no scanner link`);
    assert.ok(product.includes('href="/catalogue/"'), `${urlPath}: no catalogue link`);
    assert.ok(product.includes('CDISC Validator'), `${urlPath}: no validator link`);
  }
});

// ---------------------------------------------------------------------------
// 2. Severity, and the rest of the withdrawn scoring model.
// ---------------------------------------------------------------------------

test('no generated page says "severity" at all', { skip }, () => {
  for (const [urlPath, html] of pages) {
    assert.equal(
      /severity/i.test(html), false,
      `${urlPath} still mentions severity`,
    );
  }
});

test('the index table has no Severity heading and no severity cell', { skip }, () => {
  assert.equal(/<th scope="col">Severity<\/th>/.test(index), false);
  assert.equal(/chip--severity-/.test(index), false);
});

test('no rule page carries a Severity fact', { skip }, () => {
  for (const [urlPath, html] of pages) {
    if (urlPath === '/catalogue/') continue;
    assert.equal(/<dt>Severity<\/dt>/.test(html), false, `${urlPath} has a Severity fact`);
  }
});

/**
 * Names of fields the governed model deleted. None of these is an English
 * word, so finding one anywhere on a page means something read it.
 */
const WITHDRAWN_FIELDS = [
  'effortGroup',
  'baseHours',
  'perFindingHours',
  'maxHours',
  'reportOnce',
  'supersedes',
];

/**
 * Wording only the withdrawn score/severity/effort model could produce.
 *
 * Checked against the WHOLE page, generator chrome and verbatim rule prose
 * alike. It was briefly narrowed to the chrome, because three rules — VAR-001,
 * VAR-002 and CORE-002 — ended their remediation with "their shared setup is
 * charged once", which is the deleted `effortGroup` mechanism surviving in
 * prose that this repo only reproduces. Rules 0.15.2 fixed those sentences at
 * source, so the narrowing is gone: a defect in the asset is still a defect on
 * the page, and this file is what says so.
 *
 * Deliberately NOT the bare word "effort": rule prose uses it in its ordinary
 * English sense ("in an effort to remove Define-XML implementation", which is a
 * quotation from the IG, and "Low effort, but a stale structure string is a
 * conformance finding"). Banning the word would fail on the asset rather than
 * on the defect.
 */
const WITHDRAWN_PRESENTATION = [
  'What it costs to fix',
  'What it costs to miss',
  'Estimated hours',
  'Indicative hours',
  'Shared setup',
  'shared setup',
  'charged once',
  'Per finding',
  'Capped at',
  'programme-level work',
  'impact score',
  'take the score on trust',
];

test('no generated page references a deleted scoring field', { skip }, () => {
  for (const [urlPath, html] of pages) {
    for (const field of WITHDRAWN_FIELDS) {
      assert.equal(
        html.toLowerCase().includes(field.toLowerCase()), false,
        `${urlPath} still names the deleted field "${field}"`,
      );
    }
  }
});

test('no generated page presents the withdrawn scoring model', { skip }, () => {
  for (const [urlPath, html] of pages) {
    const body = html.toLowerCase();
    for (const phrase of WITHDRAWN_PRESENTATION) {
      assert.equal(
        body.includes(phrase.toLowerCase()), false,
        `${urlPath} still says "${phrase}"`,
      );
    }
  }
});

test('the scanner landing page promises no hours, effort or cost estimate', () => {
  // The card here used to offer "indicative hours per study, plus the
  // programme-level work that is done once rather than per study". The scanner
  // withdrew all three ranges with the model that produced them, so the page
  // was promising an output the product does not have.
  const page = read('impact/index.html').toLowerCase();
  for (const phrase of [
    'indicative hours',
    'estimated hours',
    'effort estimate',
    'programme-level work',
    'hours per study',
    'what it costs',
    'severity',
    'impact score',
  ]) {
    assert.equal(page.includes(phrase), false, `impact/index.html still promises "${phrase}"`);
  }
  // And still says what the scanner does produce, in the terms the rule pages
  // use, so removing the claim did not remove the card's job.
  assert.match(read('impact/index.html'), /links to the rule it came from/i);
});

// ---------------------------------------------------------------------------
// 2b. The withdrawn breakage headline.
// ---------------------------------------------------------------------------

/**
 * "Which of your studies break when you move to SDTMIG v4.0?" led this site's
 * scanner page. The scanner's governed copy names it a prohibited public claim
 * — `PROHIBITED_PUBLIC_CLAIMS` in `packages/core/src/governed/copy.ts`, "the
 * withdrawn breakage headline" — and its own UI is held to it by
 * `apps/web/src/App.test.tsx`. Nothing held THIS repo to it, which is how the
 * claim outlived its withdrawal on the one page most people read first.
 *
 * Why it is prohibited: the scanner reads Define-XML metadata. It can say a
 * study declares something v4.0 changes. It cannot say the study breaks, and a
 * reader who acts on "break" is acting on a conformance verdict this product
 * does not produce and has no inputs for.
 *
 * The patterns are the governed ones, deliberately: if the two lists drift, the
 * site starts claiming something the product forbids itself to claim.
 */
const WITHDRAWN_BREAKAGE = [
  // The governed pattern, copied from copy.ts.
  /studies\s+break|will\s+break|which\s+studies\s+(?:break|fail)/i,
  // And the scanner's on-screen form, which is wider at both ends.
  /which of your studies break|studies break|will break|will fail/i,
  // Close variants that assert the same thing in other words. Scoped to
  // studies and to the migration, so ordinary prose about a parse failing or a
  // build breaking is untouched.
  /\bstud(?:y|ies)\b[^.?!]{0,40}\b(?:break|breaks|breaking|broken|fail|fails|failing)\b/i,
  /\b(?:break|breaks|fail|fails)\b[^.?!]{0,40}\bwhen you move to\b/i,
  /\bwhich[^.?!]{0,30}won['’]?t\s+(?:survive|make it)\b/i,
];

/** Every page this repo publishes, read as the reader receives it. */
const PUBLIC_PAGES = [
  'index.html',
  'impact/index.html',
  'impact/privacy/index.html',
  'impact/subscribe/index.html',
];

test('no public page carries the withdrawn breakage headline', () => {
  for (const page of PUBLIC_PAGES) {
    const html = read(page);
    for (const pattern of WITHDRAWN_BREAKAGE) {
      const m = pattern.exec(html);
      assert.equal(
        m, null,
        `${page} makes the withdrawn breakage claim: "${m && m[0]}"`,
      );
    }
  }
});

test('no generated catalogue page carries it either', { skip }, () => {
  for (const [urlPath, html] of pages) {
    for (const pattern of WITHDRAWN_BREAKAGE) {
      const m = pattern.exec(html);
      assert.equal(m, null, `${urlPath} makes the withdrawn breakage claim: "${m && m[0]}"`);
    }
  }
});

test('the scanner page leads with the claim that replaced it', () => {
  // Absence alone would pass on a page with no headline at all. This is the
  // sentence the product can support: Define-XML declares what v4.0 changes
  // about it, and the scanner reports the change, not a verdict.
  const html = read('impact/index.html');
  assert.match(
    html,
    /<h1 class="impact-hero__title">See what changes when your studies move to SDTMIG(?:&nbsp;| )v4\.0<\/h1>/,
  );
  // The description a search result shows is the same claim, and drifted from
  // the headline once already.
  const description = html.match(/<meta name="description" content="([^"]*)"/);
  assert.ok(description, 'impact/index.html has no meta description');
  assert.match(description[1], /see what changes when your studies move to SDTMIG v4\.0/i);
});

test('no generated page renders the word undefined', { skip }, () => {
  for (const [urlPath, html] of pages) {
    assert.equal(html.includes('undefined'), false, `${urlPath} renders "undefined"`);
  }
});

test('no generated page renders empty metadata', { skip }, () => {
  // A deleted field that survives as an empty cell is the same defect as
  // `undefined`, only quieter.
  for (const [urlPath, html] of pages) {
    for (const empty of ['<dd></dd>', '<dd> </dd>', '<td></td>', '<dt></dt>']) {
      assert.equal(html.includes(empty), false, `${urlPath} has an ${empty}`);
    }
    assert.equal(/>(null|NaN)</.test(html), false, `${urlPath} renders null or NaN`);
  }
});

test('the catalogue stylesheet has dropped the severity chips', () => {
  assert.equal(/chip--severity/.test(IMPACT_CSS), false);
  // The confidence chips are still in use and must not have gone with them.
  assert.match(IMPACT_CSS, /\.chip--confidence-confirmed\b/);
  assert.match(IMPACT_CSS, /\.chip--confidence-draft\b/);
  assert.match(IMPACT_CSS, /\.chip--confidence-needs-verification\b/);
});

test('the generator reads no field the governed model deleted', () => {
  const src = read('scripts/build-catalogue.mjs');
  // Property access, not prose: the file's header comment names all six
  // deliberately, to say they are gone and why.
  for (const field of [
    'severity', 'effort', 'effortGroup', 'supersedes', 'requires', 'reportOnce',
  ]) {
    assert.equal(
      new RegExp(`rule\\.${field}\\b`).test(src), false,
      `the generator still reads rule.${field}`,
    );
  }
  assert.equal(/SEVERITY_LABELS/.test(src), false, 'SEVERITY_LABELS is unused; remove it');
  assert.equal(/renderEffort|function hours\(/.test(src), false, 'effort rendering is dead code');
});

// ---------------------------------------------------------------------------
// 3. The four columns, and one sizing for all of them.
// ---------------------------------------------------------------------------

const COLUMNS = ['Rule', 'What it finds', 'Basis', 'Detectability'];

/** Every `<table class="rule-table">` on the index, markup and all. */
function tables(html) {
  return [...html.matchAll(/<table class="rule-table">([\s\S]*?)<\/table>/g)].map((m) => m[1]);
}

test('every category table has the four intended columns, in order', { skip }, () => {
  const all = tables(index);
  assert.ok(all.length >= 2, `expected several category tables, found ${all.length}`);

  for (const [i, table] of all.entries()) {
    const headings = [...table.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map((m) => m[1]);
    assert.deepEqual(headings, COLUMNS, `table ${i} has the wrong columns`);
  }
});

test('every row has one cell per column', { skip }, () => {
  for (const [i, table] of tables(index).entries()) {
    const rows = [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
    // The first <tr> is the heading row; the rest are rules.
    for (const row of rows.slice(1)) {
      const cells = [...row.matchAll(/<td[ >]/g)].length;
      assert.equal(cells, COLUMNS.length, `table ${i} has a row of ${cells} cells`);
    }
  }
});

test('every category table is sized by the same colgroup', { skip }, () => {
  const all = tables(index);
  const colgroups = all.map((t) => {
    const m = t.match(/<colgroup>[\s\S]*?<\/colgroup>/);
    assert.ok(m, 'a category table has no colgroup');
    return m[0].replace(/\s+/g, ' ').trim();
  });

  assert.equal(colgroups.length, all.length, 'not every table is sized');
  // Identical, not merely present: two tables sized differently put Basis in
  // two places, which is the whole defect this replaces.
  for (const cg of colgroups) {
    assert.equal(cg, colgroups[0], 'category tables are sized differently');
  }

  const cols = [...colgroups[0].matchAll(/class="(rule-table__col--[a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(cols, [
    'rule-table__col--id',
    'rule-table__col--what',
    'rule-table__col--basis',
    'rule-table__col--detect',
  ]);
});

test('the stylesheet gives those columns stable widths', () => {
  // A colgroup is advisory under the default auto layout; fixed is what makes
  // the widths a property of the page rather than of the longest title in a
  // section.
  assert.match(IMPACT_CSS, /\.rule-table\s*\{[^}]*table-layout:\s*fixed/);
  assert.match(IMPACT_CSS, /\.rule-table\s*\{[^}]*min-width:\s*\d/);

  const widths = {};
  for (const m of IMPACT_CSS.matchAll(
    /\.rule-table__col--([a-z]+)\s*\{\s*width:\s*([^;]+);/g,
  )) {
    widths[m[1]] = m[2].trim();
  }
  assert.deepEqual(Object.keys(widths).sort(), ['basis', 'detect', 'id', 'what']);

  // "What it finds" is the flexible one, and the only flexible one: with fixed
  // layout it takes whatever the other three leave.
  assert.equal(widths.what, 'auto');
  for (const col of ['id', 'basis', 'detect']) {
    assert.match(widths[col], /^[\d.]+(rem|px|em)$/, `${col} has no stable width`);
  }

  // Long titles wrap inside their column instead of widening the table.
  assert.match(IMPACT_CSS, /\.rule-table td\s*\{[^}]*overflow-wrap:\s*(anywhere|break-word)/);
});

// ---------------------------------------------------------------------------
// 4. What must keep working.
// ---------------------------------------------------------------------------

test('every rule links to a page that was generated', { skip }, () => {
  let linked = 0;
  for (const table of tables(index)) {
    for (const m of table.matchAll(/<td class="rule-table__id"><a href="([^"]+)">([^<]+)<\/a>/g)) {
      const [, href, id] = m;
      assert.equal(href, `/catalogue/${id.toLowerCase()}/`, `${id} links to ${href}`);
      assert.ok(pages.has(href), `${id} links to ${href}, which was not generated`);
      linked += 1;
    }
  }
  assert.equal(linked, pages.size - 1, 'the index does not link every generated rule page');
});

const BASIS_LABELS = ['Confirmed', 'Draft', 'Needs verification'];
const DETECTABILITY_LABELS = [
  'Define-XML conclusive',
  'Define-XML heuristic',
  'Data required',
  'Protocol required',
  'External context required',
];

test('every row still carries a Basis label and a Detectability label', { skip }, () => {
  let rows = 0;
  for (const table of tables(index)) {
    for (const m of table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
      if (cells.length === 0) continue; // the heading row
      rows += 1;

      const basis = cells[2].replace(/<[^>]+>/g, '').trim();
      assert.ok(BASIS_LABELS.includes(basis), `unknown basis "${basis}"`);
      assert.match(cells[2], /class="chip chip--confidence-[a-z-]+"/);

      const detect = cells[3].replace(/<[^>]+>/g, '').trim();
      assert.ok(DETECTABILITY_LABELS.includes(detect), `unknown detectability "${detect}"`);
    }
  }
  assert.ok(rows > 40, `expected the whole catalogue, measured ${rows} rows`);
});

test('rule pages still carry Basis and Detectability as facts', { skip }, () => {
  for (const [urlPath, html] of pages) {
    if (urlPath === '/catalogue/') continue;
    assert.match(html, /<dt>Basis<\/dt>/, `${urlPath} has no Basis fact`);
    assert.match(html, /<dt>Detectability<\/dt>/, `${urlPath} has no Detectability fact`);
    assert.match(html, /<dt>Finding type<\/dt>/, `${urlPath} has no Finding type fact`);
  }
});

test('the tables still scroll inside their own box on a narrow screen', { skip }, () => {
  const wrapped = [...index.matchAll(
    /<div class="rule-table__scroll">\s*<table class="rule-table">/g,
  )].length;
  assert.equal(wrapped, tables(index).length, 'a category table is not in a scroll container');

  // The container scrolls; the page must not. See scripts/audit-responsive.mjs,
  // which fails a PR whose pages scroll sideways at 320px.
  assert.match(IMPACT_CSS, /\.rule-table__scroll\s*\{[^}]*overflow-x:\s*auto/);
});
