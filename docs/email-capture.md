# The email capture: what it promises, and what has to be true for that

The scanner's report is a **local download**. The email form beside it is a
**mailing-list signup**. Those are two separate things, they are not traded
against each other, and every piece of copy on the site now says so.

This document exists because they were once described as one thing. The widget
said "Get the full written report" and "The report is on its way"; the endpoint
forwarded an address to an email service provider and nothing else. Nothing in
the code had ever seen the scan, so no report could have been sent, and none
was. This is the correction and the configuration it needs.

---

## The workflow, end to end

1. **The scan.** `vendor/scanner/apps/web/src/App.tsx` parses the Define-XML in
   a worker, in the tab. After a scan with at least one parsed study it
   dispatches `clindar:scanned` on `document`, carrying no detail. (It was
   `clindar:scored` until the v4.1 report redesign; both names are still
   listened for — see `docs/scanner-integration.md`.)
2. **The report.** Also in the tab: `renderHtml`, `renderMarkdown` and
   `JSON.stringify` build the report from what is already in memory, and the
   "Download HTML report" / "Markdown" / "JSON" buttons hand it to the browser
   through a `Blob` URL. No network request is involved, and no copy of it
   exists anywhere but the reader's disk.
3. **The link.** `widget/scanner-signup-link.js` unhides on that event and
   renders one anchor to `/impact/subscribe/`. It reads nothing from the event,
   and the href is a bare path — no query string, no fragment, nothing about the
   scan. The scanner page is served with `connect-src 'none'` and could not make
   a request if it tried, which is why the form is not here; see
   `docs/scanner-integration.md` for the whole argument.
4. **The form.** `widget/scanner-capture.js` mounts on `/impact/subscribe/`,
   visible immediately, under the ordinary site baseline where a same-origin
   POST is permitted. That page has never seen a scan and has no way to.
5. **The POST.** On submit it sends exactly this to
   `/.netlify/functions/subscribe`, same-origin, no cookies:

   ```json
   { "email": "you@sponsor.com" }
   ```

   The honeypot field `company` is added only if something filled it, which no
   human can.
6. **The endpoint.** `netlify/functions/subscribe.js` rejects non-POST,
   cross-origin, origin-less, non-JSON, oversized and malformed bodies; absorbs
   honeypot hits; rate-limits per caller; validates and normalises the address;
   and forwards it to one provider. Then it stops. It composes no email,
   renders no template, and holds nothing to personalise one with.
   `docs/subscribe-abuse-controls.md` has the threat model behind those guards,
   the Netlify configuration they depend on, and the bypasses that remain.
7. **The log.** One aggregate line — event, provider, outcome, hour — and no
   address. `docs/data-handling.md` has the full field list, the optional
   `SUBSCRIBE_LOG_HMAC_KEY` pseudonym, and the retention checklist.

**Step 2 never meets step 6.** That is the whole design, it is what
`/impact/privacy/` promises a DPO, and requirement one of any future change here
is that it stays true.

---

## What each provider actually receives

| `ESP_PROVIDER` | Request | Body | What it sends the subscriber by itself |
| --- | --- | --- | --- |
| `mailerlite` | `POST https://connect.mailerlite.com/api/subscribers`, `Authorization: Bearer $ESP_API_KEY` | `{"email":"…"}`, plus `"groups":["$ESP_GROUP_ID"]` when that variable is set | **Nothing.** Creates or updates a subscriber. Any email depends on the account settings below. |
| `buttondown` | `POST https://api.buttondown.com/v1/subscribers`, `Authorization: Token $ESP_API_KEY` | `{"email_address":"…","type":"regular"}` | **Nothing.** Adds a subscriber. Any email depends on the account settings below. |
| `log` | none | none | **Nothing, and nothing is stored.** The address is discarded in-process. |

No provider receives a score, a band, a rule id, a file name, a study
identifier, an IP address or a user agent, because the endpoint is never given
any of them.

### Development mode is not a dress rehearsal for delivery

`ESP_PROVIDER=log` contacts nobody. It used to answer `{"ok":true}` — the same
body a real subscription returns — which made a deploy with no provider
configured indistinguishable from a working one, in a UI that then said the
report was on its way. It now answers:

```json
{ "ok": true, "subscribed": false, "mode": "development" }
```

and the widget renders that in red as *"Development mode — nothing was sent."*
It is deliberately impossible to mistake for a confirmation, and impossible to
demo with.

---

## Deployment checklist

Nothing below involves a secret in the repository. All three variables are set
in **Netlify → Site configuration → Environment variables**, and Netlify scopes
them per deploy context.

- [ ] **Choose the provider.** `ESP_PROVIDER` = `mailerlite` or `buttondown` for
      production and for any deploy a stranger can reach. `log` for local
      development and nothing else.
- [ ] **Set `ESP_API_KEY`** to a key with permission to create subscribers and
      no more. Scope it as narrowly as the provider allows.
- [ ] **MailerLite only — set `ESP_GROUP_ID`** to the group the scanner's
      signups land in. Keep it separate from any other list you run: it is the
      trigger for the automation below, and the audience for it.
- [ ] **Turn on double opt-in** (MailerLite: *Subscribe settings → double
      opt-in*; Buttondown: *Settings → Subscribing → confirmation email*).
      `/impact/privacy/` records the legal basis as consent under Article
      6(1)(a); a confirmed opt-in is what makes that claim easy to defend.
- [ ] **Build the automation that sends the checklist.** This is the step that
      makes the widget's offer true, and it lives entirely in the provider's
      dashboard — no code here triggers it.
      - MailerLite: an automation with the trigger *"when a subscriber joins a
        group"*, set to `ESP_GROUP_ID`, whose first step emails the SDTMIG v4.0
        change checklist.
      - Buttondown: the welcome email, under *Settings → Subscribing*, with the
        same content.
- [ ] **Check the unsubscribe link** appears in that email and in every
      broadcast. `/impact/privacy/` promises one in each.
- [ ] **Subscribe a real address you own and confirm the checklist arrives.**
      Until someone has done this on the production configuration, the offer is
      not proven. Nothing in this repository can prove it: a `200` from the
      endpoint means a provider accepted an address, and that is all it has ever
      meant.
- [ ] **Set the retention rule.** The privacy page promises deletion after two
      years without an opened email. Configure it, or diary it.
- [ ] **Work through `docs/data-handling.md`.** Netlify log retention, provider
      retention, staff access, data-subject requests, exports and secret
      rotation. None of it is enforced by code here, and `/impact/privacy/`
      describes all of it as configured rather than proven.
- [ ] **Leave `SUBSCRIBE_LOG_HMAC_KEY` unset** unless an investigation needs to
      correlate repeat attempts. Aggregate counts are the default for a reason.

### If the checklist is not ready

Then do not deploy with the copy that offers one. Change `COPY.heading` and
`COPY.body` in `widget/scanner-capture.js` to offer only what the provider will
actually send — catalogue updates, or a consultation follow-up — and change
`/impact/privacy/`'s "Why" row to match. The rule is not "keep the copy vague";
it is that the copy names what a configured provider demonstrably sends.

---

## What the response means

| Response | Meaning |
| --- | --- |
| `200 {"ok":true,"subscribed":true}` | A provider accepted the address. **Not** proof that any email was sent, queued or delivered. Also the response to a honeypot hit and to an address already on the list — deliberately identical, so the endpoint cannot be used to test who is subscribed. |
| `200 {"ok":true,"subscribed":false,"mode":"development"}` | No provider was contacted. Nothing was stored. Nothing will arrive. |
| `400 {"error":"invalid_email"}` | The address failed validation here. |
| `429 {"error":"too_many_requests"}` | More than five submissions from this caller in an hour. |
| `502 {"error":"subscribe_failed"}` | The provider refused, timed out, or is not configured. Which of those it was goes to the function log — as a status code, never a response body — and never to the caller. |

The field is `subscribed`, not `delivered` or `sent`, because subscription is
the only fact this process is in a position to know.

---

## Rules for changing any of this

1. **The report is not emailed.** Sending it would mean transmitting scan
   results, which `/impact/privacy/` promises never happens and which the
   scanner page's `connect-src 'none'` makes impossible from where the result
   is.
2. **The form does not move back to the scanner page.** One form there is what
   forced that directive to `'self'` before, and the build fails if the built
   scanner names an endpoint at all.
3. **Copy may only promise what a configured provider sends.** If you add an
   offer, do the automation first and the words second.
4. **A successful subscription is never described as a delivered email.** Not in
   the widget, not in the privacy page, not in a response field name.
5. **The privacy page changes in the same commit.** It invites a DPO to open
   devtools and check the payload. It has to keep surviving that.

## Running the tests

```
node --test "tests/*.test.js"
```

No dependencies and no package.json — the same reason `scripts/build.mjs` has
none. `tests/subscribe.test.js` stubs `fetch` and asserts what each provider
would receive; `tests/capture-copy.test.js` fails if the delivery promise ever
comes back into the copy. Neither sends a request anywhere.
