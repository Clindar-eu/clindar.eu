// Tests for netlify/functions/subscribe.js.
//
// Run with `node --test tests/`. Dependency-free, like everything else here.
//
// WHY THIS DIRECTORY AND NOT BESIDE THE FUNCTION. Netlify turns every top-level
// file in `netlify/functions/` into a deployed function. A test file there
// would ship as `/.netlify/functions/subscribe.test`.
//
// Nothing here reaches the network: `fetch` is replaced for the whole file, and
// a test that forgets to say what the provider does gets a failure rather than
// a real request. No address is ever submitted to a real provider.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { handler } = require('../netlify/functions/subscribe.js');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

/** The host this deploy answers on, as Netlify would route it. */
const SITE_HOST = 'clindar.eu';

// ---------------------------------------------------------------------------
// Harness.
// ---------------------------------------------------------------------------

// The rate limiter is module-level and survives between tests, so every call
// gets its own caller identity. Five submissions per hour is the limit; giving
// each test a fresh IP keeps that behaviour intact rather than working around
// it.
let ipCounter = 0;
function freshIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter % 254}:${ipCounter}`;
}

function invoke(options = {}) {
  const {
    method = 'POST',
    body = { email: 'reader@sponsor.example' },
    headers = {},
    ip = freshIp(),
  } = options;

  return handler({
    httpMethod: method,
    headers: {
      'content-type': 'application/json',
      'x-nf-client-connection-ip': ip,
      // A browser posting from a page this site served, which is the only
      // caller this endpoint has. Origin is required now, so a test that is not
      // about origins still has to look like one.
      host: SITE_HOST,
      origin: `https://${SITE_HOST}`,
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** A body of exactly `bytes` bytes, valid apart from its size. */
function bodyOfExactly(bytes) {
  const empty = JSON.stringify({ email: 'reader@sponsor.example', pad: '' });
  const body = JSON.stringify({
    email: 'reader@sponsor.example',
    pad: 'x'.repeat(bytes - Buffer.byteLength(empty, 'utf8')),
  });
  assert.equal(Buffer.byteLength(body, 'utf8'), bytes, 'the fixture is not the size it claims');
  return body;
}

/** The provider call that a test expects, plus whatever fetch was handed. */
function stubFetch(respond) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    return respond(url, init);
  };
  return calls;
}

function response(status, text = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  };
}

/** Capture console output so the "detailed server-side" half can be asserted. */
function captureLogs() {
  const lines = { log: [], warn: [], error: [] };
  const original = { log: console.log, warn: console.warn, error: console.error };
  for (const level of ['log', 'warn', 'error']) {
    console[level] = (...args) => lines[level].push(args.join(' '));
  }
  return {
    lines,
    restore() {
      Object.assign(console, original);
    },
  };
}

const realFetch = globalThis.fetch;
const realEnv = { ...process.env };

test.beforeEach(() => {
  process.env.ESP_PROVIDER = 'mailerlite';
  process.env.ESP_API_KEY = 'test-key-not-a-real-one';
  delete process.env.ESP_GROUP_ID;
  // Off unless a test turns it on: the pseudonym is opt-in in production too.
  delete process.env.SUBSCRIBE_LOG_HMAC_KEY;
  // Netlify sets these on a real deploy and they widen the accepted origins, so
  // a test that has not asked for them must not inherit them from a shell.
  delete process.env.URL;
  delete process.env.DEPLOY_PRIME_URL;
  delete process.env.DEPLOY_URL;
  // Any test that does not stub fetch should fail loudly rather than dial out.
  globalThis.fetch = async () => {
    throw new Error('the provider was contacted by a test that did not stub fetch');
  };
});

test.afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...realEnv };
});

// ---------------------------------------------------------------------------
// Valid submission.
// ---------------------------------------------------------------------------

test('a valid submission subscribes and says only that', async () => {
  const calls = stubFetch(() => response(200, '{"data":{}}'));

  const result = await invoke({ body: { email: 'reader@sponsor.example' } });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), { ok: true, subscribed: true });
  assert.equal(calls.length, 1);
});

test('MailerLite receives the address and nothing else', async () => {
  const calls = stubFetch(() => response(200, '{"data":{}}'));

  await invoke({ body: { email: 'reader@sponsor.example' } });

  const [call] = calls;
  assert.equal(call.url, 'https://connect.mailerlite.com/api/subscribers');
  assert.equal(call.init.headers.Authorization, 'Bearer test-key-not-a-real-one');
  assert.deepEqual(call.body, { email: 'reader@sponsor.example' });
});

test('MailerLite receives the group when one is configured, and still nothing else', async () => {
  process.env.ESP_GROUP_ID = '12345';
  const calls = stubFetch(() => response(200, '{"data":{}}'));

  await invoke({ body: { email: 'reader@sponsor.example' } });

  assert.deepEqual(calls[0].body, { email: 'reader@sponsor.example', groups: ['12345'] });
});

test('Buttondown receives the address and nothing else', async () => {
  process.env.ESP_PROVIDER = 'buttondown';
  const calls = stubFetch(() => response(201, '{}'));

  await invoke({ body: { email: 'reader@sponsor.example' } });

  const [call] = calls;
  assert.equal(call.url, 'https://api.buttondown.com/v1/subscribers');
  assert.equal(call.init.headers.Authorization, 'Token test-key-not-a-real-one');
  assert.deepEqual(call.body, { email_address: 'reader@sponsor.example', type: 'regular' });
});

// The claim /impact/privacy/ makes, asserted rather than trusted: whatever a
// caller puts in the body, no scan context reaches a provider. The widget never
// sends these; this is the second line, in case a future one does.
test('scan context in the request body never reaches the provider', async () => {
  const calls = stubFetch(() => response(200, '{"data":{}}'));

  await invoke({
    body: {
      email: 'reader@sponsor.example',
      score: 71,
      band: 'high',
      fileName: 'define-ABC-301.xml',
      studyId: 'ABC-301',
      ruleIds: ['VAR-010', 'NS-004'],
      report: '<html>the whole thing</html>',
    },
  });

  assert.deepEqual(calls[0].body, { email: 'reader@sponsor.example' });
  const forwarded = JSON.stringify(calls[0].body);
  for (const leak of ['ABC-301', 'VAR-010', '71', 'high', 'define-']) {
    assert.equal(forwarded.includes(leak), false, `forwarded body leaked ${leak}`);
  }
});

// ---------------------------------------------------------------------------
// Invalid email.
// ---------------------------------------------------------------------------

test('an invalid email is rejected before any provider is contacted', async () => {
  let contacted = false;
  globalThis.fetch = async () => {
    contacted = true;
    return response(200);
  };

  for (const email of ['', '   ', 'reader', 'reader@', '@sponsor.example', 'a b@c.example', 42, null]) {
    const result = await invoke({ body: { email } });
    assert.equal(result.statusCode, 400, `accepted ${JSON.stringify(email)}`);
    assert.deepEqual(JSON.parse(result.body), { ok: false, error: 'invalid_email' });
  }

  assert.equal(contacted, false);
});

test('an over-long local part is rejected', async () => {
  const result = await invoke({ body: { email: `${'a'.repeat(65)}@sponsor.example` } });
  assert.equal(result.statusCode, 400);
  assert.deepEqual(JSON.parse(result.body), { ok: false, error: 'invalid_email' });
});

// ---------------------------------------------------------------------------
// Honeypot.
// ---------------------------------------------------------------------------

test('a filled honeypot is absorbed, forwards nothing, and looks like success', async () => {
  let contacted = false;
  globalThis.fetch = async () => {
    contacted = true;
    return response(200);
  };

  const trapped = await invoke({
    body: { email: 'bot@sponsor.example', company: 'Acme Ltd' },
  });

  assert.equal(contacted, false, 'a honeypot hit must not reach the provider');
  assert.equal(trapped.statusCode, 200);

  // Byte-identical to a real subscription, or the bot learns it was caught.
  const calls = stubFetch(() => response(200, '{"data":{}}'));
  const real = await invoke({ body: { email: 'reader@sponsor.example' } });
  assert.equal(calls.length, 1);
  assert.equal(trapped.statusCode, real.statusCode);
  assert.equal(trapped.body, real.body);
});

test('an empty honeypot is a normal submission', async () => {
  const calls = stubFetch(() => response(200, '{"data":{}}'));

  const result = await invoke({ body: { email: 'reader@sponsor.example', company: '   ' } });

  assert.equal(result.statusCode, 200);
  assert.equal(calls.length, 1);
});

// ---------------------------------------------------------------------------
// Duplicate provider response — the account-enumeration case.
// ---------------------------------------------------------------------------

test('an address already on the list is indistinguishable from a new one', async () => {
  const duplicates = [
    ['buttondown', 409, '{"code":"email_already_exists"}'],
    ['buttondown', 400, '{"error":"That email address is already subscribed."}'],
    ['mailerlite', 422, '{"message":"The email has already been taken."}'],
  ];

  const fresh = await (async () => {
    stubFetch(() => response(200, '{"data":{}}'));
    return invoke({ body: { email: 'new@sponsor.example' } });
  })();

  for (const [provider, status, text] of duplicates) {
    process.env.ESP_PROVIDER = provider;
    stubFetch(() => response(status, text));

    const result = await invoke({ body: { email: 'known@sponsor.example' } });

    assert.equal(result.statusCode, fresh.statusCode, `${provider} ${status} differed in status`);
    assert.equal(result.body, fresh.body, `${provider} ${status} differed in body`);
  }
});

test('a 4xx that is not a duplicate is still a failure', async () => {
  stubFetch(() => response(422, '{"message":"The email must be a valid email address."}'));

  const result = await invoke({ body: { email: 'reader@sponsor.example' } });

  assert.equal(result.statusCode, 502);
  assert.deepEqual(JSON.parse(result.body), { ok: false, error: 'subscribe_failed' });
});

// ---------------------------------------------------------------------------
// Provider timeout.
// ---------------------------------------------------------------------------

// The real deadline is ESP_TIMEOUT_MS and an AbortController. Waiting eight
// seconds to watch it fire would test the clock; what matters is what the
// handler does with the AbortError, so the stub raises one directly.
test('a provider timeout fails generically and names itself in the log', async () => {
  globalThis.fetch = async () => {
    throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
  };
  const logs = captureLogs();

  let result;
  try {
    result = await invoke({ body: { email: 'reader@sponsor.example' } });
  } finally {
    logs.restore();
  }

  assert.equal(result.statusCode, 502);
  assert.deepEqual(JSON.parse(result.body), { ok: false, error: 'subscribe_failed' });

  const logged = logs.lines.error.join('\n');
  assert.match(logged, /mailerlite/);
  assert.match(logged, /AbortError/);
  // The operational detail is for us. The caller is told nothing about it.
  assert.equal(result.body.includes('AbortError'), false);
  assert.equal(result.body.includes('mailerlite'), false);
});

// ---------------------------------------------------------------------------
// Provider failure.
// ---------------------------------------------------------------------------

test('a provider 500 fails generically and logs the status', async () => {
  stubFetch(() => response(500, 'upstream exploded'));
  const logs = captureLogs();

  let result;
  try {
    result = await invoke({ body: { email: 'reader@sponsor.example' } });
  } finally {
    logs.restore();
  }

  assert.equal(result.statusCode, 502);
  assert.deepEqual(JSON.parse(result.body), { ok: false, error: 'subscribe_failed' });
  assert.match(logs.lines.error.join('\n'), /mailerlite responded 500/);
  assert.equal(result.body.includes('500'), false);
});

test('a rejected provider request never logs the address or the key', async () => {
  globalThis.fetch = async () => {
    throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { name: 'TypeError' });
  };
  const logs = captureLogs();

  try {
    await invoke({ body: { email: 'reader@sponsor.example' } });
  } finally {
    logs.restore();
  }

  const everything = [...logs.lines.log, ...logs.lines.warn, ...logs.lines.error].join('\n');
  assert.equal(everything.includes('test-key-not-a-real-one'), false, 'the API key was logged');
  assert.equal(everything.includes('reader@sponsor.example'), false, 'a failed address was logged');
});

// ---------------------------------------------------------------------------
// Missing provider configuration.
// ---------------------------------------------------------------------------

test('a missing provider fails, and the caller is not told why', async () => {
  delete process.env.ESP_PROVIDER;
  delete process.env.ESP_API_KEY;
  const logs = captureLogs();

  let result;
  try {
    result = await invoke({ body: { email: 'reader@sponsor.example' } });
  } finally {
    logs.restore();
  }

  assert.equal(result.statusCode, 502);
  assert.deepEqual(JSON.parse(result.body), { ok: false, error: 'subscribe_failed' });
  assert.match(logs.lines.error.join('\n'), /ESP_PROVIDER or ESP_API_KEY is not set/);
  assert.equal(result.body.includes('ESP_'), false);
});

test('a provider name nobody implemented fails rather than guessing', async () => {
  process.env.ESP_PROVIDER = 'mailchimp';
  const logs = captureLogs();

  let result;
  try {
    result = await invoke({ body: { email: 'reader@sponsor.example' } });
  } finally {
    logs.restore();
  }

  assert.equal(result.statusCode, 502);
  assert.match(logs.lines.error.join('\n'), /unknown ESP_PROVIDER: mailchimp/);
});

test('a provider set without a key fails rather than posting unauthenticated', async () => {
  delete process.env.ESP_API_KEY;
  let contacted = false;
  globalThis.fetch = async () => {
    contacted = true;
    return response(200);
  };
  const logs = captureLogs();

  let result;
  try {
    result = await invoke({ body: { email: 'reader@sponsor.example' } });
  } finally {
    logs.restore();
  }

  assert.equal(contacted, false);
  assert.equal(result.statusCode, 502);
});

// ---------------------------------------------------------------------------
// Development mode.
// ---------------------------------------------------------------------------

test('development mode contacts nobody and cannot pass for a subscription', async () => {
  process.env.ESP_PROVIDER = 'log';
  let contacted = false;
  globalThis.fetch = async () => {
    contacted = true;
    return response(200);
  };
  const logs = captureLogs();

  let result;
  try {
    result = await invoke({ body: { email: 'reader@sponsor.example' } });
  } finally {
    logs.restore();
  }

  assert.equal(contacted, false);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), {
    ok: true,
    subscribed: false,
    mode: 'development',
  });

  // Distinguishable from a real subscription, which is the entire point.
  const calls = stubFetch(() => response(200, '{"data":{}}'));
  process.env.ESP_PROVIDER = 'mailerlite';
  const real = await invoke({ body: { email: 'reader@sponsor.example' } });
  assert.equal(calls.length, 1);
  assert.notEqual(result.body, real.body);

  assert.match(logs.lines.warn.join('\n'), /nothing sent/i);
});

// ---------------------------------------------------------------------------
// Success response semantics.
// ---------------------------------------------------------------------------

test('no success response claims an email was sent or delivered', async () => {
  const bodies = [];

  stubFetch(() => response(200, '{"data":{}}'));
  bodies.push((await invoke({ body: { email: 'reader@sponsor.example' } })).body);

  bodies.push((await invoke({ body: { email: 'bot@sponsor.example', company: 'Acme' } })).body);

  process.env.ESP_PROVIDER = 'log';
  const logs = captureLogs();
  try {
    bodies.push((await invoke({ body: { email: 'reader@sponsor.example' } })).body);
  } finally {
    logs.restore();
  }

  for (const body of bodies) {
    const payload = JSON.parse(body);
    assert.equal(payload.ok, true);
    // `subscribed` is the strongest word this endpoint has earned. Anything
    // that sounds like delivery would be a claim it cannot support.
    for (const forbidden of ['delivered', 'sent', 'email_sent', 'report']) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(payload, forbidden),
        false,
        `success response claims "${forbidden}"`,
      );
    }
    assert.deepEqual(
      Object.keys(payload).sort(),
      payload.subscribed ? ['ok', 'subscribed'] : ['mode', 'ok', 'subscribed'],
    );
  }
});

test('a subscribed response says subscribed, never delivered', async () => {
  stubFetch(() => response(200, '{"data":{}}'));

  const payload = JSON.parse((await invoke({ body: { email: 'reader@sponsor.example' } })).body);

  assert.equal(payload.subscribed, true);
  assert.equal('delivered' in payload, false);
});

// ---------------------------------------------------------------------------
// The guards around all of the above, unchanged but worth pinning.
// ---------------------------------------------------------------------------

test('the request guards reject what they always rejected', async () => {
  const cases = [
    [{ method: 'GET' }, 405, 'method_not_allowed'],
    [{ headers: { origin: 'https://evil.example', host: 'clindar.eu' } }, 403, 'forbidden'],
    [{ headers: { 'content-type': 'text/plain' } }, 415, 'unsupported_media_type'],
    [{ body: 'not json at all' }, 400, 'invalid_json'],
    [{ body: '"a string"' }, 400, 'invalid_json'],
    [{ body: { email: `${'a'.repeat(3000)}@sponsor.example` } }, 413, 'payload_too_large'],
  ];

  for (const [options, status, error] of cases) {
    const result = await invoke(options);
    assert.equal(result.statusCode, status, `${JSON.stringify(options)} gave ${result.statusCode}`);
    assert.deepEqual(JSON.parse(result.body), { ok: false, error });
  }
});

test('a sixth submission from one caller within the hour is refused', async () => {
  stubFetch(() => response(200, '{"data":{}}'));
  const ip = '203.0.113.77';

  for (let i = 0; i < 5; i += 1) {
    const ok = await invoke({ ip, body: { email: `reader${i}@sponsor.example` } });
    assert.equal(ok.statusCode, 200, `submission ${i + 1} was refused`);
  }

  const refused = await invoke({ ip, body: { email: 'reader5@sponsor.example' } });
  assert.equal(refused.statusCode, 429);
  assert.deepEqual(JSON.parse(refused.body), { ok: false, error: 'too_many_requests' });
});

// ---------------------------------------------------------------------------
// The trust boundary: which headers decide anything, and which are just text a
// caller sent us.
//
// Every test here is a request that used to be accepted, or a budget that used
// to be free. They are written as attacks rather than as unit tests because
// that is the only way to tell the difference between a header being read and a
// header being trusted.
// ---------------------------------------------------------------------------

test('a foreign origin is refused, and x-forwarded-host cannot vouch for it', async () => {
  const cases = [
    // The plain case, and the one that always worked.
    { origin: 'https://evil.example' },
    // The spoof: the caller supplies both halves of the comparison the function
    // used to make, so the origin agrees with the "host" and walks through.
    { origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' },
    // The same trick with the site's own name in the header, in case the check
    // were ever reversed.
    { origin: 'https://evil.example', 'x-forwarded-host': SITE_HOST },
    // A subdomain is a different host. This one is worth pinning because it is
    // the shape a takeover of a stale DNS record would take.
    { origin: `https://staging.${SITE_HOST}` },
    // Port matters: a different port is a different origin.
    { origin: `https://${SITE_HOST}:8443` },
  ];

  for (const headers of cases) {
    const result = await invoke({ headers });
    assert.equal(result.statusCode, 403, `${JSON.stringify(headers)} was allowed`);
    assert.deepEqual(JSON.parse(result.body), { ok: false, error: 'forbidden' });
  }
});

test('an origin that is not a URL is refused rather than parsed generously', async () => {
  const malformed = [
    'not a url',
    // The opaque origin a sandboxed frame or a cross-origin redirect sends.
    'null',
    'https://',
    '://clindar.eu',
    'javascript:alert(1)',
    `https://${SITE_HOST} https://evil.example`,
    '',
  ];

  for (const origin of malformed) {
    const result = await invoke({ headers: { origin } });
    assert.equal(result.statusCode, 403, `origin ${JSON.stringify(origin)} was allowed`);
  }
});

test('a request with no Origin at all is refused, which is the decision on record', async () => {
  // Documented in the function and in docs/subscribe-abuse-controls.md: the
  // only intended caller is a browser, browsers send Origin on every POST, and
  // there is no non-browser client to keep working. Reverting this is a
  // deliberate act, so it is pinned here rather than left to drift.
  const result = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', host: SITE_HOST },
    body: JSON.stringify({ email: 'reader@sponsor.example' }),
  });
  assert.equal(result.statusCode, 403);
  assert.deepEqual(JSON.parse(result.body), { ok: false, error: 'forbidden' });
});

test('the deploy previews Netlify names are accepted, and only those', async () => {
  stubFetch(() => response(200, '{"data":{}}'));
  process.env.URL = 'https://clindar.eu';
  process.env.DEPLOY_PRIME_URL = 'https://deploy-preview-42--clindar.netlify.app';

  // A preview page posting to itself, where `host` is the preview host.
  const preview = await invoke({
    headers: {
      host: 'deploy-preview-42--clindar.netlify.app',
      origin: 'https://deploy-preview-42--clindar.netlify.app',
    },
  });
  assert.equal(preview.statusCode, 200);

  // The production name, from a request that arrived on the preview host: the
  // allowlist is configuration, so this is allowed on purpose.
  const production = await invoke({
    headers: { host: 'deploy-preview-42--clindar.netlify.app', origin: 'https://clindar.eu' },
  });
  assert.equal(production.statusCode, 200);

  // A different preview is still a different site.
  const other = await invoke({
    headers: {
      host: 'deploy-preview-42--clindar.netlify.app',
      origin: 'https://deploy-preview-43--clindar.netlify.app',
    },
  });
  assert.equal(other.statusCode, 403);
});

test('a malformed deploy URL in the environment widens nothing', async () => {
  process.env.URL = 'not a url at all';
  const result = await invoke({ headers: { origin: 'https://evil.example' } });
  assert.equal(result.statusCode, 403);
});

test('varying x-forwarded-for does not buy a fresh rate-limit budget', async () => {
  stubFetch(() => response(200, '{"data":{}}'));
  const ip = '203.0.113.90';

  for (let i = 0; i < 5; i += 1) {
    const ok = await invoke({
      ip,
      headers: { 'x-forwarded-for': `192.0.2.${i}` },
      body: { email: `reader${i}@sponsor.example` },
    });
    assert.equal(ok.statusCode, 200, `submission ${i + 1} was refused`);
  }

  // A sixth, wearing a forwarding header nobody upstream vouches for. The
  // function used to read the leftmost entry whenever it could, which made this
  // request a new caller with a clean budget.
  const refused = await invoke({
    ip,
    headers: { 'x-forwarded-for': '198.51.100.200, 203.0.113.90' },
    body: { email: 'reader5@sponsor.example' },
  });
  assert.equal(refused.statusCode, 429);
});

test('with no platform header every caller shares one budget rather than none', async () => {
  stubFetch(() => response(200, '{"data":{}}'));
  // No x-nf-client-connection-ip, which is what a host other than Netlify would
  // give us. Each request forges a different x-forwarded-for; under the old
  // fallback each of them was a separate caller with five submissions to spend.
  const unidentified = (i) =>
    handler({
      httpMethod: 'POST',
      headers: {
        'content-type': 'application/json',
        host: SITE_HOST,
        origin: `https://${SITE_HOST}`,
        'x-forwarded-for': `192.0.2.${100 + i}`,
      },
      body: JSON.stringify({ email: `anon${i}@sponsor.example` }),
    });

  for (let i = 0; i < 5; i += 1) {
    assert.equal((await unidentified(i)).statusCode, 200, `submission ${i + 1} was refused`);
  }
  assert.equal((await unidentified(5)).statusCode, 429);
});

// ---------------------------------------------------------------------------
// What the budget covers.
// ---------------------------------------------------------------------------

test('malformed submissions spend the budget too', async () => {
  const ip = '203.0.113.120';
  // Five rejected addresses. Under the old order these never reached the
  // counter, so a caller could send them for ever and still have five valid
  // submissions in hand.
  for (let i = 0; i < 5; i += 1) {
    const rejected = await invoke({ ip, body: { email: 'not-an-address' } });
    assert.equal(rejected.statusCode, 400, `submission ${i + 1} was not rejected`);
  }

  const refused = await invoke({ ip, body: { email: 'reader@sponsor.example' } });
  assert.equal(refused.statusCode, 429);
  assert.deepEqual(JSON.parse(refused.body), { ok: false, error: 'too_many_requests' });
});

test('a honeypot hit is counted, and the honeypot never answers 429', async () => {
  const logs = captureLogs();
  const ip = '203.0.113.130';
  try {
    // Well past the limit, and every one of them gets the answer a successful
    // subscription gets. A 429 here would tell a bot that something upstream is
    // counting, which is the one thing this response exists not to say.
    for (let i = 0; i < 8; i += 1) {
      const result = await invoke({
        ip,
        body: { email: 'reader@sponsor.example', company: 'Acme Corp' },
      });
      assert.equal(result.statusCode, 200, `honeypot hit ${i + 1} was answered differently`);
      assert.deepEqual(JSON.parse(result.body), { ok: true, subscribed: true });
    }
  } finally {
    logs.restore();
  }

  // The hits were counted all the same: a real submission from the same caller
  // is now out of budget. Nothing was forwarded, so fetch was never needed.
  const refused = await invoke({ ip, body: { email: 'reader@sponsor.example' } });
  assert.equal(refused.statusCode, 429);
});

// ---------------------------------------------------------------------------
// The body and its content type, at the boundary rather than near it.
// ---------------------------------------------------------------------------

test('the body limit is exact', async () => {
  stubFetch(() => response(200, '{"data":{}}'));

  const atTheLimit = await invoke({ body: bodyOfExactly(2048) });
  assert.equal(atTheLimit.statusCode, 200);

  const overIt = await invoke({ body: bodyOfExactly(2049) });
  assert.equal(overIt.statusCode, 413);
  assert.deepEqual(JSON.parse(overIt.body), { ok: false, error: 'payload_too_large' });
});

test('an oversized base64 body is measured after decoding, not before', async () => {
  const raw = bodyOfExactly(4096);
  const result = await handler({
    httpMethod: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-nf-client-connection-ip': freshIp(),
      host: SITE_HOST,
      origin: `https://${SITE_HOST}`,
    },
    body: Buffer.from(raw, 'utf8').toString('base64'),
    isBase64Encoded: true,
  });
  assert.equal(result.statusCode, 413);
});

test('anything but JSON is refused, including no content type at all', async () => {
  const types = [
    'text/plain',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    'text/html',
    undefined,
    '',
  ];

  for (const type of types) {
    const result = await invoke({ headers: { 'content-type': type } });
    assert.equal(result.statusCode, 415, `content-type ${JSON.stringify(type)} was accepted`);
    assert.deepEqual(JSON.parse(result.body), { ok: false, error: 'unsupported_media_type' });
  }
});

// ---------------------------------------------------------------------------
// What the limiter is allowed to claim about itself.
//
// Prose, asserted, because the risk here is not a broken counter - it is a
// counter that reads as a control it is not, and a reader who plans around it.
// ---------------------------------------------------------------------------

test('the in-memory limiter is documented as per-instance and never as global', () => {
  const fn = read('netlify/functions/subscribe.js');

  assert.match(fn, /not shared/i, 'the limiter no longer says it is unshared');
  assert.match(fn, /cold start/i, 'the cold-start reset is no longer named');
  assert.ok(
    fn.includes('docs/subscribe-abuse-controls.md'),
    'the function no longer points at the checklist that carries the real limit',
  );

  const doc = read('docs/subscribe-abuse-controls.md');
  assert.match(doc, /cold start/i, 'the checklist no longer names the cold-start reset');
  assert.match(doc, /## Remaining bypasses/i, 'the checklist no longer lists what gets through');
  assert.match(
    doc,
    /\/\.netlify\/functions\/subscribe/,
    'the checklist no longer names the path that stays reachable',
  );
});

// ---------------------------------------------------------------------------
// Logging.
//
// The function used to write the whole address into the function log on every
// success. Nothing needed it there — the address's necessary home is the email
// provider, and a second copy in an infrastructure log is a second place to
// have to defend, expire and search on a deletion request. These tests are what
// stop it coming back.
// ---------------------------------------------------------------------------

const ADDRESS = 'grace.hopper@sponsor.example';

/** Run one scenario with the console captured, and return everything it wrote. */
async function linesFrom(run) {
  const logs = captureLogs();
  let result;
  try {
    result = await run();
  } finally {
    logs.restore();
  }
  return {
    result,
    all: [...logs.lines.log, ...logs.lines.warn, ...logs.lines.error].join('\n'),
    structured: logs.lines.log.map((line) => JSON.parse(line)),
  };
}

test('no outcome writes the submitted address to a log', async () => {
  const scenarios = {
    subscribed: () => stubFetch(() => response(200, '{"data":{}}')),
    duplicate: () => stubFetch(() => response(409, '{}')),
    provider_500: () => stubFetch(() => response(500, 'upstream exploded')),
    timeout: () => {
      globalThis.fetch = async () => {
        throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
      };
    },
    unconfigured: () => {
      delete process.env.ESP_PROVIDER;
      delete process.env.ESP_API_KEY;
    },
    unknown_provider: () => {
      process.env.ESP_PROVIDER = 'mailchimp';
    },
    development: () => {
      process.env.ESP_PROVIDER = 'log';
    },
  };

  for (const [name, setup] of Object.entries(scenarios)) {
    process.env.ESP_PROVIDER = 'mailerlite';
    process.env.ESP_API_KEY = 'test-key-not-a-real-one';
    setup();

    const { all } = await linesFrom(() => invoke({ body: { email: ADDRESS } }));

    assert.equal(all.includes(ADDRESS), false, `${name} logged the address`);
    assert.equal(all.includes('grace.hopper'), false, `${name} logged the local part`);
    assert.equal(all.includes('sponsor.example'), false, `${name} logged the domain`);
  }
});

test('the rejected paths log a category and nothing about the caller', async () => {
  const cases = [
    [{ email: 'bot@sponsor.example', company: 'Acme Ltd' }, 'honeypot'],
    [{ email: 'not-an-address' }, 'invalid_email'],
  ];

  for (const [body, outcome] of cases) {
    const { all, structured } = await linesFrom(() => invoke({ body }));

    assert.equal(structured.length, 1, `${outcome} wrote ${structured.length} lines`);
    assert.deepEqual(Object.keys(structured[0]).sort(), ['at', 'event', 'outcome']);
    assert.equal(structured[0].outcome, outcome);
    // No provider was contacted on either path, so none is named.
    assert.equal('provider' in structured[0], false);
    assert.equal(all.includes('bot@sponsor.example'), false);
    assert.equal(all.includes('not-an-address'), false);
  }
});

test('a rate-limited request logs the category without identifying the caller', async () => {
  stubFetch(() => response(200, '{"data":{}}'));
  const ip = '203.0.113.180';

  for (let i = 0; i < 5; i += 1) {
    await invoke({ ip, body: { email: `reader${i}@sponsor.example` } });
  }

  const { all, structured } = await linesFrom(() =>
    invoke({ ip, body: { email: ADDRESS } }),
  );

  assert.equal(structured[0].outcome, 'rate_limited');
  assert.equal(all.includes(ip), false, 'the IP reached a log');
  assert.equal(all.includes(ADDRESS), false);
});

test('the structured line carries categories, not content', async () => {
  stubFetch(() => response(200, '{"data":{}}'));

  const { structured } = await linesFrom(() => invoke({ body: { email: ADDRESS } }));

  assert.equal(structured.length, 1);
  const line = structured[0];
  assert.deepEqual(Object.keys(line).sort(), ['at', 'event', 'outcome', 'provider']);
  assert.equal(line.event, 'subscribe');
  assert.equal(line.provider, 'mailerlite');
  assert.equal(line.outcome, 'subscribed');
  // The hour, and no finer. A minute would start to be a behavioural record.
  assert.match(line.at, /^\d{4}-\d{2}-\d{2}T\d{2}$/);
  assert.equal('email' in line, false);
});

test('each outcome is named in the line rather than inferred from its absence', async () => {
  stubFetch(() => response(500, 'upstream exploded'));
  const failed = await linesFrom(() => invoke({ body: { email: ADDRESS } }));
  assert.equal(failed.structured[0].outcome, 'failed');
  assert.equal(failed.structured[0].provider, 'mailerlite');

  process.env.ESP_PROVIDER = 'log';
  const dev = await linesFrom(() => invoke({ body: { email: ADDRESS } }));
  assert.equal(dev.structured[0].outcome, 'not_sent');
  assert.equal(dev.structured[0].provider, 'log');

  delete process.env.ESP_PROVIDER;
  delete process.env.ESP_API_KEY;
  const unset = await linesFrom(() => invoke({ body: { email: ADDRESS } }));
  assert.equal(unset.structured[0].provider, 'unset');
});

// Requirement seven, and the realistic leak: providers quote the submitted
// address back in their validation errors.
test('a provider error body containing the address never reaches a log', async () => {
  stubFetch(() =>
    // Deliberately not a duplicate message, or this would be classified as one
    // and never reach the failure path being tested.
    response(422, JSON.stringify({ message: `The email ${ADDRESS} was rejected.` })),
  );

  const { all } = await linesFrom(() => invoke({ body: { email: ADDRESS } }));

  assert.equal(all.includes(ADDRESS), false, 'the provider response body leaked into a log');
  assert.match(all, /mailerlite responded 422/);
});

test('no log line carries the IP, user agent, referrer, API key or request body', async () => {
  stubFetch(() => response(200, '{"data":{}}'));

  const { all } = await linesFrom(() =>
    invoke({
      ip: '203.0.113.9',
      headers: {
        'user-agent': 'Mozilla/5.0 (SecretBrowserBuild)',
        referer: 'https://intranet.sponsor.example/studies/ABC-301',
      },
      body: {
        email: ADDRESS,
        fileName: 'define-ABC-301.xml',
        studyId: 'ABC-301',
        ruleIds: ['VAR-010'],
      },
    }),
  );

  const forbidden = [
    '203.0.113.9',
    'SecretBrowserBuild',
    'intranet.sponsor.example',
    'test-key-not-a-real-one',
    'Bearer',
    'Authorization',
    'define-ABC-301.xml',
    'ABC-301',
    'VAR-010',
  ];
  for (const value of forbidden) {
    assert.equal(all.includes(value), false, `logged ${value}`);
  }
});

test('no subscriber identifier is logged unless one is configured', async () => {
  stubFetch(() => response(200, '{"data":{}}'));

  const { structured } = await linesFrom(() => invoke({ body: { email: ADDRESS } }));

  assert.equal('sid' in structured[0], false);
});

test('an absent or empty logging secret fails safely rather than throwing', async () => {
  for (const value of [undefined, '']) {
    stubFetch(() => response(200, '{"data":{}}'));
    if (value === undefined) delete process.env.SUBSCRIBE_LOG_HMAC_KEY;
    else process.env.SUBSCRIBE_LOG_HMAC_KEY = value;

    const { result, structured } = await linesFrom(() => invoke({ body: { email: ADDRESS } }));

    assert.equal(result.statusCode, 200);
    assert.equal('sid' in structured[0], false);
  }
});

test('a configured key gives a stable pseudonym that is not the address', async () => {
  process.env.SUBSCRIBE_LOG_HMAC_KEY = 'a-dedicated-logging-secret';

  stubFetch(() => response(200, '{"data":{}}'));
  const first = await linesFrom(() => invoke({ body: { email: ADDRESS } }));
  stubFetch(() => response(200, '{"data":{}}'));
  const cased = await linesFrom(() => invoke({ body: { email: ADDRESS.toUpperCase() } }));
  stubFetch(() => response(200, '{"data":{}}'));
  const other = await linesFrom(() => invoke({ body: { email: 'ada@sponsor.example' } }));

  const sid = first.structured[0].sid;
  assert.match(sid, /^[A-Za-z0-9_-]{16}$/);
  // A provider treats these as one subscriber, so the pseudonym must too.
  assert.equal(cased.structured[0].sid, sid);
  assert.notEqual(other.structured[0].sid, sid);

  assert.equal(first.all.includes(ADDRESS), false, 'the address was logged beside its pseudonym');
  assert.equal(
    first.all.includes('a-dedicated-logging-secret'),
    false,
    'the logging secret was printed',
  );
});

test('rotating the key severs correlation, which is what rotation is for', async () => {
  stubFetch(() => response(200, '{"data":{}}'));
  process.env.SUBSCRIBE_LOG_HMAC_KEY = 'key-one';
  const before = await linesFrom(() => invoke({ body: { email: ADDRESS } }));

  stubFetch(() => response(200, '{"data":{}}'));
  process.env.SUBSCRIBE_LOG_HMAC_KEY = 'key-two';
  const after = await linesFrom(() => invoke({ body: { email: ADDRESS } }));

  assert.notEqual(after.structured[0].sid, before.structured[0].sid);
});

test('a failed subscription carries the pseudonym so a retry loop is visible', async () => {
  process.env.SUBSCRIBE_LOG_HMAC_KEY = 'a-dedicated-logging-secret';
  stubFetch(() => response(500, 'upstream exploded'));

  const { all, structured } = await linesFrom(() => invoke({ body: { email: ADDRESS } }));

  assert.equal(structured[0].outcome, 'failed');
  assert.match(structured[0].sid, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(all.includes(ADDRESS), false);
});
