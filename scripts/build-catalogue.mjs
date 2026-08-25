/**
 * Renders the rules catalogue as browsable static pages: an index and one page
 * per rule, under /catalogue/.
 *
 * This is the SEO surface and the credibility artefact. Every number the
 * scanner puts on screen comes from one of these rules, so a sceptical reader
 * can go and read the rule rather than take the score on trust. The prose is
 * reproduced exactly as the catalogue writes it — `whatChanges` and
 * `remediation` are the asset, and a paraphrase would be a second, worse
 * catalogue that nobody maintains.
 *
 * Strictly read-only with respect to the submodule: it reads the YAML and
 * writes into dist/. Nothing here ever writes back into vendor/scanner.
 *
 * The YAML parser is the scanner's own, resolved out of the submodule's
 * node_modules, which the site build has already installed. The site itself
 * still has no package.json and no dependencies of its own.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const SITE_ORIGIN = 'https://clindar.eu';

// What gets published, and what does not.
//
// Published: everything a reader needs to check our work — the classification,
// the prose, the sources, and the effort model.
//
// The effort numbers are published WITH the three assumptions that decide what
// they mean, because base-plus-per-finding hours read cold are a price list
// rather than evidence: setup is charged once and not per finding, a rule in an
// effortGroup does not charge setup again for a workstream another rule in the
// group already paid for, and programme-scoped hours land once per organisation
// rather than once per study. Anyone reconstructing a total from these pages
// should be able to get the same number the scanner does.
//
// Not published: `evidence` and `select`, which are the engine's templates and
// predicates rather than statements about the standard; and `serviceHook`,
// which is a pitch. These pages are here to be checked, and a reader working
// through what a rule costs them should reach the sources without an offer in
// the way.

const CATEGORY_LABELS = {
  structural: 'Structural',
  'variable-added': 'Variables added',
  'variable-changed': 'Variables changed',
  'variable-demoted': 'Variables demoted',
  'variable-removed': 'Variables removed',
  'domain-new': 'New domains',
  'domain-changed': 'Domains changed',
  'define-xml': 'Define-XML',
  process: 'Process',
};

// Order the index by how much the change is likely to cost, not alphabetically.
const CATEGORY_ORDER = [
  'structural',
  'domain-new',
  'domain-changed',
  'variable-removed',
  'variable-demoted',
  'variable-changed',
  'variable-added',
  'define-xml',
  'process',
];

const SEVERITY_LABELS = {
  critical: 'Critical',
  major: 'Major',
  minor: 'Minor',
  info: 'Informational',
};

const CONFIDENCE_LABELS = {
  confirmed: 'Confirmed',
  draft: 'Draft',
  'needs-verification': 'Needs verification',
};

const CONFIDENCE_NOTES = {
  confirmed:
    'Traceable to the published specification text cited below.',
  draft:
    'Read from the public-review draft. The draft can still change before v4.0 is final, and this rule changes with it.',
  'needs-verification':
    'Believed correct and not yet confirmed against a citable line of the specification. Treated as provisional until it is.',
};

const DETECTABILITY_LABELS = {
  'define-conclusive': 'Define-XML conclusive',
  'define-heuristic': 'Define-XML heuristic',
  'data-required': 'Data required',
  'protocol-required': 'Protocol required',
  'external-context-required': 'External context required',
};

const DETECTABILITY_NOTES = {
  'define-conclusive':
    'The Define-XML settles this one way or the other. No further evidence is needed to know whether it applies.',
  'define-heuristic':
    'The Define-XML indicates this, but does not prove it. Treat the finding as a prompt to check, not as a verdict.',
  'data-required':
    'The Define-XML cannot settle this. Answering it needs the datasets themselves.',
  'protocol-required':
    'The Define-XML cannot settle this. Answering it needs the protocol or the study design.',
  'external-context-required':
    'The Define-XML cannot settle this. Answering it needs a decision or a fact held outside the submission metadata.',
};

const FINDING_TYPE_LABELS = {
  impact: 'Impact',
  opportunity: 'Opportunity',
  question: 'Question',
  'metadata-gap': 'Metadata gap',
  heuristic: 'Heuristic',
  process: 'Process',
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function label(table, key) {
  return table[key] || key;
}

function rulePath(id) {
  return `/catalogue/${id.toLowerCase()}/`;
}

/** Shared page chrome, so the catalogue reads as part of the site rather than as output. */
function page({ title, description, canonical, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/css/style.css" />
  <link rel="stylesheet" href="/css/impact.css" />
</head>
<body>

  <header class="navbar">
    <div class="navbar__container">
      <a href="/" class="navbar__logo">Clindar</a>
      <nav class="navbar__nav" aria-label="Main navigation">
        <a href="/impact/" class="navbar__link">Impact Scanner</a>
        <a href="/catalogue/" class="navbar__link">Rules catalogue</a>
        <a href="/impact/privacy/" class="navbar__link">Privacy</a>
      </nav>
      <a href="/scanner/" class="btn btn--primary navbar__cta">Open the scanner</a>
    </div>
  </header>

  <main>
${body}
  </main>

  <footer class="footer">
    <div class="footer__container">
      <div class="footer__col footer__col--brand">
        <span class="footer__logo">Clindar</span>
        <p class="footer__tagline">Clinical data, submission-ready.</p>
        <p class="footer__desc">CDISC validation tools and biometrics consulting for CROs and small biotech.</p>
      </div>
      <div class="footer__col">
        <h4 class="footer__col-heading">Product</h4>
        <nav class="footer__nav" aria-label="Product links">
          <a href="/scanner/" class="footer__link">SDTMIG v4.0 Impact Scanner</a>
          <a href="/catalogue/" class="footer__link">Rules catalogue</a>
          <a href="/#features" class="footer__link">CDISC Validator</a>
        </nav>
      </div>
      <div class="footer__col">
        <h4 class="footer__col-heading">Company</h4>
        <nav class="footer__nav" aria-label="Company links">
          <a href="/#services" class="footer__link">Services</a>
          <a href="/#about" class="footer__link">About</a>
          <a href="/#contact" class="footer__link">Contact</a>
        </nav>
      </div>
      <div class="footer__col">
        <h4 class="footer__col-heading">Legal &amp; Data</h4>
        <p class="footer__legal-note">EU-hosted. The scanner uploads nothing: Define-XML is read in your browser.</p>
        <a href="/impact/privacy/" class="footer__link">Scanner privacy</a>
        <a href="mailto:info@clindar.eu" class="footer__link">info@clindar.eu</a>
      </div>
    </div>
    <div class="footer__bottom">
      <p class="footer__copy">&copy; 2026 Clindar. All rights reserved.</p>
    </div>
  </footer>

</body>
</html>
`;
}

/** "2 hours", "1 hour", "0.25 hours" — never "2.00". */
function hours(value) {
  const n = Number(value);
  const text = Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
  return `${text} ${n === 1 ? 'hour' : 'hours'}`;
}

/**
 * The effort model, with the assumptions that decide what the numbers mean.
 *
 * Published because a reader who can see the rule and the sources should be
 * able to see what we think it costs and argue with it. Every line here says
 * how the number is applied, not just what it is: setup once rather than per
 * finding, waived where another rule in the same workstream already charged it,
 * and programme work landing once per organisation rather than once per study.
 */
function renderEffort(rule, catalogue) {
  const effort = rule.effort;
  if (!effort) return '';

  const programme = effort.scope === 'programme';
  const rows = [];

  const free = effort.baseHours === 0 && effort.perFindingHours === 0;

  if (free) {
    rows.push([
      'Estimated hours',
      'None. This rule reports something worth knowing rather than work to do, so it adds nothing to the estimate.',
    ]);
  } else {
    if (effort.baseHours > 0) {
      rows.push([
        effort.perFindingHours > 0 ? 'Setup' : 'Fixed',
        `${escapeHtml(hours(effort.baseHours))} <span class="fact-note">Charged once ${
          programme ? 'per organisation' : 'per study'
        } if the rule fires at all, however many times it fires.</span>`,
      ]);
    }
    if (effort.perFindingHours > 0) {
      rows.push([
        'Per finding',
        `${escapeHtml(hours(effort.perFindingHours))} <span class="fact-note">Added for every dataset or variable the rule fires on.</span>`,
      ]);
    }
    if (effort.maxHours !== undefined) {
      rows.push([
        'Capped at',
        `${escapeHtml(hours(effort.maxHours))} <span class="fact-note">A ceiling, so an unusually large study does not produce an unusable number.</span>`,
      ]);
    }
  }

  // Whose budget nothing lands in is not a useful row.
  if (!free) rows.push([
    'Budget',
    programme
      ? 'Programme <span class="fact-note">Work that comes with adopting v4.0 at all. It happens once however many studies convert, and is never multiplied across a portfolio.</span>'
      : 'Study <span class="fact-note">Work caused by this study’s own metadata, and incurred again for every study that carries it.</span>',
  ]);

  // Without this, two rules in one workstream read as two setups.
  const group = rule.effortGroup
    ? catalogue.rules
        .filter((r) => r.effortGroup === rule.effortGroup && r.id !== rule.id)
        .map((r) => r.id)
    : [];

  if (group.length) {
    rows.push([
      'Shared setup',
      `With ${group.map((id) => `<a href="${rulePath(id)}">${escapeHtml(id)}</a>`).join(', ')}
        <span class="fact-note">These describe one piece of work approached from different
        directions, so the setup above is charged once between them rather than by each. Per-finding
        hours still apply to each, because those scale with what is actually converted.</span>`,
    ]);
  }

  const body = rows
    .map(
      ([term, value]) => `          <div>
            <dt>${term}</dt>
            <dd>${value}</dd>
          </div>`,
    )
    .join('\n');

  // "What it costs to fix", not "What it costs": the severity row a few lines
  // above says severity is what it costs to MISS this, and two headings a
  // screen apart should not both read "what it costs".
  return `        <h2 class="impact-section__title">What it costs to fix</h2>
        <p class="impact-prose">
          Planning numbers, not a quotation. They are what this rule contributes
          to the range the scanner reports for a study, and they assume someone
          who knows the datasets is doing the work.
        </p>
        <dl class="impact-facts">
${body}
        </dl>`;
}

function chip(kind, value, text) {
  return `<span class="chip chip--${escapeHtml(kind)}-${escapeHtml(value)}">${escapeHtml(text)}</span>`;
}

function standardLine(catalogue) {
  const s = catalogue.targetStandard;
  return `${s.name} v${s.version} (${s.status})`;
}

function renderIndex(catalogue) {
  const rules = catalogue.rules;
  const byCategory = new Map();
  for (const rule of rules) {
    if (!byCategory.has(rule.category)) byCategory.set(rule.category, []);
    byCategory.get(rule.category).push(rule);
  }

  // Any category the catalogue grows that this generator has not been told
  // about still gets published, after the ones it knows the order of.
  const categories = [
    ...CATEGORY_ORDER.filter((c) => byCategory.has(c)),
    ...[...byCategory.keys()].filter((c) => !CATEGORY_ORDER.includes(c)).sort(),
  ];

  const confirmed = rules.filter((r) => r.confidence === 'confirmed').length;

  const sections = categories
    .map((category) => {
      const rows = byCategory
        .get(category)
        .map(
          (rule) => `            <tr>
              <td class="rule-table__id"><a href="${rulePath(rule.id)}">${escapeHtml(rule.id)}</a></td>
              <td><a href="${rulePath(rule.id)}">${escapeHtml(rule.title)}</a></td>
              <td>${chip('severity', rule.severity, label(SEVERITY_LABELS, rule.severity))}</td>
              <td>${chip('confidence', rule.confidence, label(CONFIDENCE_LABELS, rule.confidence))}</td>
              <td class="rule-table__detect">${escapeHtml(label(DETECTABILITY_LABELS, rule.detectability))}</td>
            </tr>`,
        )
        .join('\n');

      return `      <section class="impact-section${
        categories.indexOf(category) % 2 === 1 ? ' impact-section--slate' : ''
      }" id="${escapeHtml(category)}">
        <div class="impact-section__container">
          <h2 class="impact-section__title">${escapeHtml(label(CATEGORY_LABELS, category))}</h2>
          <div class="rule-table__scroll">
          <table class="rule-table">
            <thead>
              <tr>
                <th scope="col">Rule</th>
                <th scope="col">What it finds</th>
                <th scope="col">Severity</th>
                <th scope="col">Basis</th>
                <th scope="col">Detectability</th>
              </tr>
            </thead>
            <tbody>
${rows}
            </tbody>
          </table>
          </div>
        </div>
      </section>`;
    })
    .join('\n\n');

  const body = `    <section class="impact-pagehead">
      <div class="impact-pagehead__container">
        <h1 class="impact-pagehead__title">The SDTMIG v4.0 rules catalogue</h1>
        <p class="impact-pagehead__lede">
          Every finding the impact scanner reports comes from one of these
          ${rules.length} rules. Each one states what v4.0 changes, what to do
          about it, how conclusively Define-XML alone can detect it, and the
          specification text it rests on. Read the rule; do not take the score
          on trust.
        </p>
        <p class="impact-pagehead__meta">
          Catalogue ${escapeHtml(catalogue.catalogueVersion)} targeting ${escapeHtml(standardLine(catalogue))} ·
          ${rules.length} rules, ${confirmed} confirmed against published text ·
          reviewed ${escapeHtml(catalogue.reviewedOn)}
        </p>
      </div>
    </section>

${sections}

    <section class="impact-cta">
      <div class="impact-cta__container">
        <h2 class="impact-cta__title">See which of these apply to you</h2>
        <p class="impact-cta__body">
          Drop in a Define-XML. The scanner runs every rule above against it in
          your browser and tells you which ones fire, on which datasets and
          variables.
        </p>
        <a href="/scanner/" class="btn btn--primary">Open the scanner</a>
      </div>
    </section>`;

  return page({
    title: `SDTMIG v4.0 rules catalogue — ${rules.length} rules — Clindar`,
    description: `The full rules catalogue behind the Clindar SDTMIG v4.0 impact scanner: ${rules.length} rules covering what v4.0 changes, what to do about it, and the specification text each one rests on.`,
    canonical: `${SITE_ORIGIN}/catalogue/`,
    body,
  });
}

function renderRule(rule, catalogue, index) {
  const related = (rule.relatedRules || []).filter((id) => index.has(id));

  const facts = [
    ['Rule', escapeHtml(rule.id)],
    ['Category', escapeHtml(label(CATEGORY_LABELS, rule.category))],
    [
      'Severity',
      `${chip('severity', rule.severity, label(SEVERITY_LABELS, rule.severity))} <span class="fact-note">What it costs to miss this, not what it costs to fix it.</span>`,
    ],
    [
      'Basis',
      `${chip('confidence', rule.confidence, label(CONFIDENCE_LABELS, rule.confidence))} <span class="fact-note">${escapeHtml(
        CONFIDENCE_NOTES[rule.confidence] || '',
      )}</span>`,
    ],
    [
      'Detectability',
      `${escapeHtml(label(DETECTABILITY_LABELS, rule.detectability))} <span class="fact-note">${escapeHtml(
        DETECTABILITY_NOTES[rule.detectability] || '',
      )}</span>`,
    ],
    ['Finding type', escapeHtml(label(FINDING_TYPE_LABELS, rule.findingType))],
    [
      'Applies to',
      `SDTMIG ${(rule.appliesToVersions || []).map((v) => escapeHtml(v)).join(', ')}`,
    ],
  ];

  const factRows = facts
    .map(
      ([term, value]) => `          <div>
            <dt>${term}</dt>
            <dd>${value}</dd>
          </div>`,
    )
    .join('\n');

  const detectabilityNote = rule.detectabilityNote
    ? `        <h2 class="impact-section__title">What the scan can and cannot see</h2>
        <p class="impact-prose">${escapeHtml(rule.detectabilityNote)}</p>`
    : '';

  const references = (rule.references || [])
    .map((ref) => `            <li>${escapeHtml(ref)}</li>`)
    .join('\n');

  const relatedBlock = related.length
    ? `        <h2 class="impact-section__title">Related rules</h2>
        <ul class="rule-related">
${related
  .map(
    (id) =>
      `          <li><a href="${rulePath(id)}"><span class="rule-related__id">${escapeHtml(id)}</span> ${escapeHtml(
        index.get(id).title,
      )}</a></li>`,
  )
  .join('\n')}
        </ul>`
    : '';

  const body = `    <section class="impact-pagehead">
      <div class="impact-pagehead__container">
        <p class="rule-eyebrow">${escapeHtml(rule.id)} · ${escapeHtml(label(CATEGORY_LABELS, rule.category))}</p>
        <h1 class="impact-pagehead__title">${escapeHtml(rule.title)}</h1>
        <p class="impact-pagehead__meta">
          <a class="rule-back" href="/catalogue/">All ${catalogue.rules.length} rules</a> ·
          Catalogue ${escapeHtml(catalogue.catalogueVersion)} targeting ${escapeHtml(standardLine(catalogue))}
        </p>
      </div>
    </section>

    <section class="impact-section">
      <div class="impact-section__container impact-section__container--narrow">
        <dl class="impact-facts">
${factRows}
        </dl>

        <h2 class="impact-section__title">What changes in v4.0</h2>
        <p class="impact-prose">${escapeHtml(rule.whatChanges)}</p>

        <h2 class="impact-section__title">What to do about it</h2>
        <p class="impact-prose">${escapeHtml(rule.remediation)}</p>

${renderEffort(rule, catalogue)}

${detectabilityNote}
      </div>
    </section>

    <section class="impact-section impact-section--slate">
      <div class="impact-section__container impact-section__container--narrow">
        <h2 class="impact-section__title">Sources</h2>
        <p class="impact-prose">
          Every claim above rests on one of these. Where a line is from the
          public-review draft it says so, because a draft can still move.
        </p>
        <ol class="rule-refs">
${references}
        </ol>

${relatedBlock}
      </div>
    </section>

    <section class="impact-cta">
      <div class="impact-cta__container">
        <h2 class="impact-cta__title">Does this one apply to your studies?</h2>
        <p class="impact-cta__body">
          Drop in a Define-XML and find out, along with the other
          ${catalogue.rules.length - 1} rules. It runs in your browser; the file
          is never uploaded.
        </p>
        <a href="/scanner/" class="btn btn--primary">Open the scanner</a>
      </div>
    </section>`;

  return page({
    title: `${rule.id}: ${rule.title} — SDTMIG v4.0 rules catalogue — Clindar`,
    description: `${rule.id} — ${rule.title}. What SDTMIG v4.0 changes, what to do about it, and the specification text it rests on.`,
    canonical: `${SITE_ORIGIN}${rulePath(rule.id)}`,
    body,
  });
}

/**
 * Read the catalogue and write /catalogue/ into dist.
 *
 * @param {object} options
 * @param {string} options.scannerDir path to the vendor/scanner submodule
 * @param {string} options.distDir    the publish directory
 * @returns {{ version: string, ruleCount: number }}
 */
export function buildCatalogue({ scannerDir, distDir }) {
  const yamlPath = join(
    scannerDir,
    'packages',
    'rules',
    'catalogue',
    'sdtmig-4.0.yaml',
  );
  if (!existsSync(yamlPath)) {
    throw new Error(`no rules catalogue at ${yamlPath}`);
  }

  // The scanner's own parser, from the install the build has already done.
  const requireFromScanner = createRequire(join(scannerDir, 'package.json'));
  const { parse } = requireFromScanner('yaml');

  const catalogue = parse(readFileSync(yamlPath, 'utf8'));
  if (!Array.isArray(catalogue.rules) || catalogue.rules.length === 0) {
    throw new Error(`the catalogue at ${yamlPath} declares no rules`);
  }

  const index = new Map(catalogue.rules.map((rule) => [rule.id, rule]));

  const outDir = join(distDir, 'catalogue');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), renderIndex(catalogue));

  for (const rule of catalogue.rules) {
    for (const field of ['title', 'whatChanges', 'remediation']) {
      if (!rule[field]) throw new Error(`rule ${rule.id} has no ${field}`);
    }
    const ruleDir = join(outDir, rule.id.toLowerCase());
    mkdirSync(ruleDir, { recursive: true });
    writeFileSync(join(ruleDir, 'index.html'), renderRule(rule, catalogue, index));
  }

  return {
    version: catalogue.catalogueVersion,
    ruleCount: catalogue.rules.length,
    paths: ['/catalogue/', ...catalogue.rules.map((rule) => rulePath(rule.id))],
  };
}
