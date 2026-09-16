/**
 * Checks served pages for horizontal overflow at phone and tablet widths.
 *
 *   node scripts/audit-responsive.mjs <base-url> [paths] [screenshot-dir]
 *
 *   node scripts/audit-responsive.mjs https://clindar.eu
 *   node scripts/audit-responsive.mjs http://localhost:4173 /scanner/ ./shots
 *   node scripts/audit-responsive.mjs https://example.netlify.app /,/impact/
 *
 * `paths` is a comma-separated list. Given none, it audits one page of every
 * distinct template the site has, discovered from its sitemap.
 *
 * Exits non-zero if any page scrolls sideways at any tested width, so it can
 * gate a deploy rather than only inform one.
 *
 * WHY DEVICE EMULATION AND NOT A SMALL WINDOW. Both window-resizing routes lie
 * about this, in opposite directions:
 *
 *   - A maximized browser window silently refuses to be resized smaller, so the
 *     page is measured at full width and everything passes.
 *   - `chrome --window-size=390,1400` is clamped to the platform's minimum
 *     window width (~600px on Windows). The page lays out at 600+, the
 *     screenshot is cropped to 390, and the result looks exactly like a
 *     catastrophic overflow bug that is not there.
 *
 * The second one is the dangerous one: it manufactures a false positive that is
 * indistinguishable from a real finding. Emulation.setDeviceMetricsOverride
 * sets the layout viewport itself, which is what a media query actually keys
 * off, so what is measured here is what a phone would do.
 *
 * THE PAGE MUST HAVE CONTENT ON IT. An empty scanner is not a responsive test:
 * the widest elements on the page are the results tables, and they do not exist
 * until something has been scanned. So this drops a synthetic Define-XML in
 * before measuring. That file is metadata only, generated here, and never
 * leaves the browser - which is the same claim the scanner itself makes.
 *
 * No dependencies: Node 22+ ships `fetch` and `WebSocket`, so CDP needs no
 * client library, and the site still has no package.json.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [, , BASE_URL, PATHS_ARG, SHOT_DIR] = process.argv;

if (!BASE_URL) {
  console.error('usage: node scripts/audit-responsive.mjs <base-url> [paths] [screenshot-dir]');
  process.exit(2);
}

/**
 * Which pages to audit when the caller does not say.
 *
 * Taken from the sitemap rather than hardcoded, so the catalogue page audited
 * is always a rule that currently exists. A pinned id like `/catalogue/ns-001/`
 * rots the first time the catalogue is renumbered, and a 404 page measures as
 * one that fits its viewport beautifully - a check that silently stops checking.
 *
 * One rule page and not fifty. They are one template with different prose in
 * it, so the fiftieth says nothing the first did not, and the run would take
 * several minutes to say it.
 */
async function discoverPaths() {
  const fallback = [
    '/',
    '/impact/',
    '/impact/privacy/',
    '/impact/subscribe/',
    '/scanner/',
    '/catalogue/',
  ];
  const isRulePage = (path) => /^\/catalogue\/.+\//.test(path);
  try {
    const res = await fetch(new URL('/sitemap.xml', BASE_URL));
    if (!res.ok) throw new Error(`sitemap returned ${res.status}`);
    const listed = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map((m) => {
        try {
          return new URL(m[1].trim()).pathname;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    if (!listed.length) throw new Error('sitemap listed no usable URLs');

    const oneRulePage = listed.find(isRulePage);
    const everythingElse = listed.filter((path) => !isRulePage(path));
    return oneRulePage ? [...everythingElse, oneRulePage] : everythingElse;
  } catch (err) {
    // A missing sitemap is not a reason to audit nothing; it is a reason to
    // audit the pages we know the site has and say why.
    console.log(`could not read the sitemap (${err.message}); auditing the usual pages`);
    return fallback;
  }
}

/**
 * The widths worth testing, and why these three.
 *
 * 320 is the narrowest viewport still in real use and the one that breaks
 * first. 390 is a current iPhone, which is what a client actually opens the
 * link on. 768 is portrait tablet, and it is here to catch the opposite
 * mistake: a fix for the phone that leaves a scrollbar on a screen wide enough
 * not to need one.
 */
const VIEWPORTS = [
  { name: 'small-320', width: 320, height: 720, scale: 2 },
  { name: 'iphone-390', width: 390, height: 844, scale: 3 },
  { name: 'tablet-768', width: 768, height: 1024, scale: 2 },
];

/** Where Chrome lives, or CHROME_PATH if it lives somewhere else. */
function chromeBinary() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error('no Chrome found; set CHROME_PATH to the browser binary');
  }
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A Define-XML with one dataset carrying --BLFL and no --LOBXFL beside it,
 * which is enough to score and therefore enough to render every table. Written
 * here rather than read from the corpus so this script never needs a real
 * study to run.
 */
const SYNTHETIC_DEFINE = (study) => `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3" xmlns:def="http://www.cdisc.org/ns/def/v2.0"
     ODMVersion="1.3.2" FileOID="AUDIT" FileType="Snapshot" def:DefineVersion="2.1.0">
  <Study OID="S"><GlobalVariables><StudyName>${study}</StudyName>
    <StudyDescription>synthetic, for the responsive audit</StudyDescription>
    <ProtocolName>${study}</ProtocolName></GlobalVariables>
    <MetaDataVersion OID="M" Name="d" def:DefineVersion="2.1.0"
                     def:StandardName="SDTMIG" def:StandardVersion="3.2">
      <ItemGroupDef OID="IG.LB" Name="LB" Repeating="Yes" IsReferenceData="No" Purpose="Tabulation"
                    def:Structure="one record per test" SASDatasetName="LB">
        <Description><TranslatedText xml:lang="en">Laboratory</TranslatedText></Description>
        <def:Class Name="FINDINGS"/>
        <ItemRef ItemOID="IT.LB.STUDYID" OrderNumber="1" Mandatory="Yes" KeySequence="1"/>
        <ItemRef ItemOID="IT.LB.LBBLFL" OrderNumber="2" Mandatory="No"/>
      </ItemGroupDef>
      <ItemDef OID="IT.LB.STUDYID" Name="STUDYID" DataType="text" Length="20"/>
      <ItemDef OID="IT.LB.LBBLFL" Name="LBBLFL" DataType="text" Length="1"/>
    </MetaDataVersion></Study></ODM>`;

/**
 * What is measured, in the page.
 *
 * `pageScrollsHorizontally` is the verdict; the rest is there so a failure says
 * which element did it rather than only that something did. A table that
 * scrolls inside its own box is fine and expected - a table that widens the
 * document is not, because it offsets every other element on the page.
 */
const MEASURE = `(() => {
  const de = document.documentElement;
  const wide = [...document.querySelectorAll('body *')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.right > de.clientWidth + 1;
    })
    .map((el) => el.tagName.toLowerCase() +
      (typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\\s+/)[0] : ''));
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return {
      overflowX: getComputedStyle(el).overflowX,
      scrollsInsideItself: el.scrollWidth > el.clientWidth,
      fitsViewport: el.getBoundingClientRect().right <= de.clientWidth + 1,
    };
  };
  return {
    layoutViewport: de.clientWidth,
    documentWidth: de.scrollWidth,
    pageScrollsHorizontally: de.scrollWidth > de.clientWidth + 1,
    widerThanViewport: [...new Set(wide)].slice(0, 12),
    studiesTable: box('table.studies'),
    rulesTable: box('table.rules'),
    studyRows: document.querySelectorAll('table.studies tbody tr').length,
  };
})()`;

// ---------------------------------------------------------------------------

const profile = mkdtempSync(join(tmpdir(), 'clindar-audit-'));

// Port 0, not a fixed one. A fixed port is how this script silently attaches to
// somebody else's browser - an orphaned headless Chrome from an earlier run
// answers /json/list, the measurements come back from a page that was never
// navigated, and the result is a confident, wrong "ok". Chrome writes the port
// it actually chose into DevToolsActivePort inside the profile directory, which
// is private to this run and therefore cannot be anyone else's.
const chrome = spawn(chromeBinary(), [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  // Only under CI, where the runner is often a container without the kernel
  // namespaces Chrome's sandbox needs and the browser otherwise dies on
  // startup. Not on a developer machine, where the sandbox works and there is
  // no reason to give it up. The page being loaded is our own either way.
  ...(process.env.CI ? ['--no-sandbox'] : []),
  `--user-data-dir=${profile}`,
  '--remote-debugging-port=0',
  'about:blank',
], { stdio: 'ignore' });

let ws;
function shutdown() {
  try { ws?.close(); } catch { /* already closed */ }
  try { chrome.kill(); } catch { /* already gone */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* windows lock */ }
}
process.on('exit', shutdown);

/** The port Chrome chose, read from the profile this run owns. */
async function devtoolsPort() {
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 80; i++) {
    try {
      // First line is the port; the second is the browser's own WS path.
      const line = readFileSync(portFile, 'utf8').split('\n')[0].trim();
      if (line) return Number(line);
    } catch { /* not written yet */ }
    await sleep(250);
  }
  throw new Error('Chrome never reported a DevTools port');
}

async function debuggerUrl() {
  const port = await devtoolsPort();
  for (let i = 0; i < 80; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not listening yet */ }
    await sleep(250);
  }
  throw new Error(`Chrome opened port ${port} but never exposed a page target`);
}

ws = new WebSocket(await debuggerUrl());
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error('could not attach to Chrome'));
});

let nextId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  const waiter = msg.id != null && pending.get(msg.id);
  if (!waiter) return;
  pending.delete(msg.id);
  if (msg.error) waiter.reject(new Error(JSON.stringify(msg.error)));
  else waiter.resolve(msg.result);
};

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed');
  }
  return result.result.value;
}

await send('Page.enable');
await send('Runtime.enable');

if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });

const paths = PATHS_ARG
  ? PATHS_ARG.split(',').map((x) => x.trim()).filter(Boolean)
  : await discoverPaths();

console.log(`auditing ${paths.length} page(s) at ${VIEWPORTS.length} widths each
`);

const failures = [];

for (const path of paths) {
  const url = new URL(path, BASE_URL).href;
  console.log(path);

  for (const vp of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: vp.scale,
      mobile: true,
    });
    // A navigation that fails is the one result this script must never report as
    // a pass: an unreachable host leaves a blank document, a blank document has
    // nothing wider than the viewport, and "ok" is exactly the wrong answer. CDP
    // reports the failure in the navigate result rather than by throwing.
    const nav = await send('Page.navigate', { url });
    if (nav.errorText) {
      console.error(`could not load ${url}: ${nav.errorText}`);
      process.exitCode = 2;
      shutdown();
      process.exit(2);
    }
    await sleep(3500);

    // And a host that answers but serves nothing useful is the same problem one
    // step later, so the page has to show it rendered something before any of the
    // measurements below are worth reading.
    const loaded = await evaluate(
      '({ url: location.href, elements: document.body ? document.body.querySelectorAll("*").length : 0 })',
    );

    // The page that answered must be the page that was asked for. Without this,
    // anything that quietly substitutes a different document - a shell mangling
    // the path argument into a local file, a redirect to a login or error page, a
    // captive portal - gets measured instead, and whatever it happens to be will
    // usually fit its viewport and report a serene, meaningless "ok".
    if (new URL(loaded.url).origin !== new URL(url).origin) {
      console.error(`asked for ${url} but the browser is showing ${loaded.url}`);
      process.exitCode = 2;
      shutdown();
      process.exit(2);
    }
    // Zero, not some larger floor: a legitimate page can be a single element, and
    // the origin check above is what catches a substituted document. This is only
    // here for the case where the right origin answers with nothing at all.
    if (loaded.elements === 0) {
      console.error(`loaded ${loaded.url} but it rendered an empty body; refusing to call that a pass`);
      process.exitCode = 2;
      shutdown();
      process.exit(2);
    }

    // Two studies, so the portfolio table has something to be too wide with.
    const dropped = await evaluate(`(() => {
      const zone = document.querySelector('.drop');
      if (!zone) return false;
      const xml = ${JSON.stringify(SYNTHETIC_DEFINE('AUDIT-A'))};
      const dt = new DataTransfer();
      dt.items.add(new File([xml], 'audit-a.xml', { type: 'text/xml' }));
      dt.items.add(new File([xml.replace('AUDIT-A', 'AUDIT-B')], 'audit-b.xml', { type: 'text/xml' }));
      zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return true;
    })()`);
    if (dropped) await sleep(2500);

    const m = await evaluate(MEASURE);

    if (SHOT_DIR) {
      const slug = path.replace(/^\/|\/$/g, '').replace(/\W+/g, '-') || 'home';
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      writeFileSync(join(SHOT_DIR, `${slug}-${vp.name}.png`), Buffer.from(shot.data, 'base64'));
    }

    const ok = !m.pageScrollsHorizontally;
    if (!ok) failures.push({ page: path, viewport: vp.name, ...m });

    console.log(
      `  ${ok ? 'ok  ' : 'FAIL'} ${vp.name.padEnd(11)} ` +
        `viewport ${String(m.layoutViewport).padStart(4)}  document ${String(m.documentWidth).padStart(4)}` +
        (dropped ? `  studies ${m.studyRows}` : '') +
        (ok ? '' : `  <- widened by: ${m.widerThanViewport.join(', ') || 'unknown'}`),
    );
  }
}

if (failures.length) {
  const pages = [...new Set(failures.map((f) => f.page))];
  console.error(
    `\n${failures.length} of ${paths.length * VIEWPORTS.length} measurements scroll ` +
      `sideways, across ${pages.length} page(s): ${pages.join(', ')}. A document that ` +
      'scrolls horizontally has every element offset from the viewport, so this is a ' +
      'page-level defect, not a cosmetic one.\n',
  );
  console.error(JSON.stringify(failures, null, 2));
  process.exitCode = 1;
} else {
  console.log(
    `\nNo horizontal overflow: ${paths.length} page(s) x ${VIEWPORTS.length} widths, all clear.`,
  );
}

// Explicitly, not only from the exit handler: an open WebSocket and a live
// child process both keep the event loop alive, so a script that merely runs
// off the end of its last statement never exits and never fires 'exit'.
shutdown();
