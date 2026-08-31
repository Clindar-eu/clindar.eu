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

const { handler } = require('../netlify/functions/subscribe.js');

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
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
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
