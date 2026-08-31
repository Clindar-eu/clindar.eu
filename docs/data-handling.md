# Personal data in the subscribe path: what the code does, and what you must configure

The endpoint holds one piece of personal data — an email address — for the
length of one request. This document says what happens to it in the code, and
then what has to be arranged outside the code for `/impact/privacy/` to stay
true. The second list is longer, and no test can check any of it.

Companion documents: `docs/email-capture.md` for the product decision and the
provider setup, `docs/subscribe-abuse-controls.md` for the abuse controls around
the same endpoint, `/impact/privacy/` for what a reader is told.

---

## What the endpoint logs

One structured line per request, from `logEvent` in
`netlify/functions/subscribe.js`:

```json
{ "event": "subscribe", "provider": "mailerlite", "outcome": "subscribed", "at": "2026-08-31T09" }
```

| Field | Values | Why it is safe |
| --- | --- | --- |
| `event` | `subscribe` | a constant |
| `provider` | `mailerlite`, `buttondown`, `log`, `unset` | configuration, not a person |
| `outcome` | `subscribed`, `failed`, `not_sent`, `honeypot`, `invalid_email`, `rate_limited` | a category |
| `at` | the hour, `YYYY-MM-DDTHH` | an hour is not a behavioural record |
| `sid` | 16 base64url chars, **only when configured** | see below |

Failures additionally write one `console.error` naming our own
misconfiguration or the provider's status code — `mailerlite responded 502`,
`ESP_PROVIDER or ESP_API_KEY is not set`. A provider's *response body* is read
only to classify a duplicate and never reaches a log line, because providers
routinely quote the submitted address back in a validation error.

### What is never logged

The Define-XML or any of its contents; a file name; a study identifier; a scan
result, score, band or rule id; the request body; the API key; the
`Authorization` header; a raw IP address; a `User-Agent`; a `Referer`. And,
since this change, the subscriber's email address.

The rule is not "redact before logging". It is that the address is never passed
to a logging call, so there is no redaction step to get wrong later.
`tests/subscribe.test.js` asserts this across every outcome — success,
duplicate, provider failure, timeout, missing configuration, unknown provider,
development mode, honeypot, invalid address and rate limit.

### The optional pseudonym

`SUBSCRIBE_LOG_HMAC_KEY` is **unset by default and should stay that way.**
Aggregate counts answer every ordinary question: how many subscribed, how many
failed, how many were rate-limited. Set it only when you need to tell one
address retrying from many addresses arriving, and unset it when that
investigation is over.

- It is an **HMAC**, not a hash. Email addresses are enumerable, so a bare
  `sha256` digest is invertible by anyone with a candidate list; it is not
  anonymous and must not be used.
- The key is a **dedicated secret**, not the ESP API key, and is never printed.
- The address is lowercased first, so the pseudonym agrees with the provider
  about what counts as one subscriber.
- **Rotation:** the identifier is stable only for the life of the key. Rotate
  and the same address yields a different pseudonym, so correlation does not
  cross the rotation. That is the intended behaviour on a leak, and it is also
  how you sever every pseudonym already written into a log you cannot edit.
- **If unset, nothing breaks:** `pseudonym()` returns `null` and the field is
  omitted from the line entirely rather than logged empty.

---

## Operational checklist

None of this is enforced by code in this repository. Each item is a deployment
requirement, and each needs a named owner and a date.

### Netlify log retention
- [ ] Record the platform's current function-log and access-log retention on
      your plan, in writing, with the date checked.
- [ ] Set retention to the shortest the plan allows.
- [ ] If logs are drained to a third party, that destination is a processor:
      it needs the same retention, the same access limits, and a DPA.
- [ ] Note that `/impact/privacy/` promises a figure on request. Someone has to
      be able to produce it.

### Email-provider retention
- [ ] Configure the "two years without an opened email" deletion rule that
      `/impact/privacy/` promises, or diary a recurring manual purge.
- [ ] Confirm unsubscribes are honoured and that unsubscribed records are
      deleted rather than kept as suppressed rows — or, if the provider keeps a
      suppression list, that the privacy page says so.
- [ ] Confirm the provider's own retention for bounce and engagement history.
- [ ] Hold a signed DPA with the provider, and check where it processes data.

### Staff access
- [ ] List who can read the subscriber list and who can read function logs.
      Keep it to people with a reason.
- [ ] Individual accounts with MFA. No shared logins.
- [ ] Remove access the day someone stops needing it, and diary a review.

### Data-subject requests
- [ ] One route in: `info@clindar.eu`, monitored, with a target inside the
      one-month GDPR deadline.
- [ ] Erasure runs against: the provider's subscriber record; any export or
      backup taken from it; and any operational log still inside its retention
      window that carries a pseudonym for that address.
- [ ] To act on a pseudonym you must recompute it with the current
      `SUBSCRIBE_LOG_HMAC_KEY`. If the key has been rotated since the line was
      written, that line can no longer be linked to the person — which is the
      point of rotating, and worth writing down in the response.
- [ ] Access requests: the provider's export is the record. Our logs hold no
      address to return.

### Backups and exports
- [ ] Any CSV export of the list is personal data: encrypt it, keep it out of
      shared drives and chat, and delete it when the task is finished.
- [ ] Keep a note of every export taken, so erasure can reach them.
- [ ] Never commit an export to this repository or paste one into an issue.

### Secret rotation
- [ ] `ESP_API_KEY` — rotate on any suspicion and on staff change. Scope it to
      creating subscribers and nothing more.
- [ ] `SUBSCRIBE_LOG_HMAC_KEY` — rotate on suspicion, and after any
      investigation that needed it. Rotating deliberately breaks correlation
      with older log lines; that is a feature, not a regression.
- [ ] Both live only in Netlify environment variables, per deploy context.
      Neither belongs in this repository, a `.env` committed by accident, or a
      build log.
- [ ] After rotating, confirm the next real subscription still succeeds.

---

## Claims this repository cannot make for you

`/impact/privacy/` is careful to describe platform behaviour as something we
configure rather than something we can prove from source, and it must stay that
way. Specifically, do not write, on any page:

- what Netlify records by default, or for how long, as though it were our
  behaviour;
- that infrastructure logs contain no personal data — request logs generally
  contain IP addresses, and that is the host's design, not ours;
- that the email provider deletes anything on a schedule, unless someone has
  actually configured it and can show the setting.

What we can say, and do: our own function log line contains no address; the
address's necessary home is the provider; retention and access are configured;
and a reader can ask for the current figures.

## Running the tests

```
node --test "tests/*.test.js"
```
