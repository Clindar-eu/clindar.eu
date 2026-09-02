// The company identity is a legal claim, so it gets a test.
//
// The site is hand-authored HTML plus one generator, with no shared partial
// system. Migrating it to a template engine for a footer line would be a much
// larger change than the line is worth, so the strings are repeated — and this
// file is what stops them drifting apart. scripts/company.mjs is the source of
// truth; every page below has to agree with it exactly.
//
// Run with `node --test "tests/*.test.js"`.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/** Pages that carry a footer and are written by hand. */
const HAND_AUTHORED = ['index.html', 'impact/index.html', 'impact/privacy/index.html'];

/** The generator that owns the catalogue index and every rule page. */
const GENERATOR = 'scripts/build-catalogue.mjs';

const company = () => import('../scripts/company.mjs');

test('every hand-authored footer carries the registered-company line verbatim', async () => {
  const { REGISTERED_LINE } = await company();

  for (const page of HAND_AUTHORED) {
    const html = read(page);
    assert.ok(
      html.includes(`<p class="footer__company">${REGISTERED_LINE}</p>`),
      `${page} does not carry the current registered-company line`,
    );
  }
});

test('the catalogue generator takes the line from the source of truth', async () => {
  // Asserted as an interpolation rather than as text: if the generator ever
  // hardcodes the string, it stops tracking scripts/company.mjs and the drift
  // this file exists to catch becomes invisible again.
  const generator = read(GENERATOR);

  assert.match(generator, /import \{ REGISTERED_LINE \} from '\.\/company\.mjs';/);
  assert.match(generator, /<p class="footer__company">\$\{REGISTERED_LINE\}<\/p>/);
});

test('the privacy page names the controller in full', async () => {
  const { COMPANY, CONTROLLER_LINE } = await company();
  const privacy = read('impact/privacy/index.html');

  assert.ok(privacy.includes(CONTROLLER_LINE), 'the controller identity is missing or reworded');
  assert.ok(
    privacy.includes(`mailto:${COMPANY.email}`),
    'the controller entry lost its contact address',
  );

  // The page's central claim is that a Define-XML never reaches us. Naming a
  // controller next to that claim must not quietly widen what is controlled.
  const controllerEntry = privacy.slice(
    privacy.indexOf('<dt>Who is responsible</dt>'),
    privacy.indexOf('<dt>What is collected</dt>'),
  );
  assert.ok(controllerEntry.length > 100, 'could not locate the controller entry');
  assert.match(controllerEntry, /no copy of it reaches us/);
});

test('the homepage states the same identity in its contact section', async () => {
  const { COMPANY } = await company();
  const home = read('index.html');

  const block = home.slice(home.indexOf('class="contact__company"'), home.indexOf('</address>'));
  assert.ok(block.length > 100, 'the contact section has no company-details block');

  for (const value of [COMPANY.legalName, COMPANY.registrationCode, COMPANY.streetAddress]) {
    assert.ok(block.includes(value), `the contact block does not state "${value}"`);
  }
  assert.ok(block.includes(`mailto:${COMPANY.email}`), 'the contact block has no mailto link');

  // "Registered office" is the accurate label: it says where the company is
  // registered and nothing about anyone being there to receive visitors.
  assert.match(block, /Registered office:/);
  assert.ok(!/Visit us|Headquarters/i.test(block), 'the address is described as somewhere to visit');
});

test('the homepage carries one valid Organization record, and only the homepage', async () => {
  const { COMPANY } = await company();
  const home = read('index.html');

  const blocks = [...home.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.equal(blocks.length, 1, 'the homepage should carry exactly one JSON-LD block');

  const data = JSON.parse(blocks[0][1]);
  assert.equal(data['@type'], 'Organization');
  assert.equal(data.name, COMPANY.legalName);
  assert.equal(data.identifier, COMPANY.registrationCode);
  assert.equal(data.email, `mailto:${COMPANY.email}`);
  assert.equal(data.address['@type'], 'PostalAddress');
  assert.equal(data.address.streetAddress, COMPANY.streetAddress);
  assert.equal(data.address.postalCode, COMPANY.postalCode);
  assert.equal(data.address.addressLocality, COMPANY.locality);
  assert.equal(data.address.addressCountry, COMPANY.countryCode);

  // Structured data that says more than the page does is the kind of thing
  // that gets a site penalised, and none of it has been verified here.
  for (const unverified of ['vatID', 'telephone', 'founder', 'aggregateRating', 'review']) {
    assert.ok(!(unverified in data), `the Organization record claims an unverified ${unverified}`);
  }

  // One record, on one page. The privacy page in particular is served with
  // script-src 'none' and must carry no <script> element of any kind.
  for (const page of ['impact/index.html', 'impact/privacy/index.html']) {
    assert.ok(!read(page).includes('application/ld+json'), `${page} grew a second Organization record`);
  }
});

test('no VAT number is published anywhere in the site source', async () => {
  // Deliberate: none has been verified. If one is ever added it should arrive
  // with a VIES check and a change to this test, not by accident.
  //
  // Comments are stripped first, so the files stay free to explain WHY there
  // is no VAT number without that explanation reading as one.
  const stripped = (body) =>
    body
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');

  for (const page of [...HAND_AUTHORED, GENERATOR, 'scripts/company.mjs']) {
    const body = stripped(read(page));
    // A Lithuanian VAT identifier is LT followed by 9 or 12 digits. The postal
    // code LT-05263 carries a hyphen and so does not match.
    assert.ok(!/\bLT\d{9,12}\b/.test(body), `${page} publishes a VAT identifier`);
    assert.ok(!/vatID/.test(body), `${page} publishes a vatID`);
  }
});
