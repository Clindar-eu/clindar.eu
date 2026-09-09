/*
 * Clindar email capture widget.
 *
 * Standalone: no framework, no build step, no dependencies. It is served from
 * the same origin as the page that mounts it, which is what lets it run under
 * `script-src 'self'`.
 *
 * WHERE THIS RUNS, AND WHY IT MOVED. It mounts on /impact/subscribe/ and
 * nowhere else. It used to be injected onto the scanner page, and that one form
 * was the whole reason the scanner's policy had to read `connect-src 'self'`
 * instead of `'none'`. Moving it here let the scanner page become a page with
 * no reachable destination at all — a claim a reader settles from the response
 * headers rather than from a code review. The scanner now shows a plain link to
 * this page instead; see widget/scanner-signup-link.js.
 *
 * The consequence for this file is that it has no scan to be near. It never
 * did have one in the request body, but it used to sit under a result on the
 * same page, and the copy said so. Now the reader arrived by following a link
 * that carried nothing, so there is nothing here to be careful with: no score,
 * no file name, no study identifier, no query string to read. The only thing
 * this page has is what the visitor types.
 *
 * WHAT IT OFFERS, AND WHY. Because it sends no scan context, nobody downstream
 * could write a personalised report even in principle — so it does not offer
 * one. The report is generated in the scanner tab and downloaded from it, free
 * and ungated. What the form buys is a mailing list: the SDTMIG v4.0 change
 * checklist and catalogue updates, which are the same for every subscriber and
 * need nothing about your study to produce.
 *
 * Consequently the confirmation says the address was added, not that an email
 * is coming. The endpoint knows a provider accepted an address; it does not
 * know that anything was ever delivered, and neither does this widget. See
 * docs/email-capture.md.
 *
 * Integration: docs/scanner-integration.md in the site repo.
 */
(function () {
  'use strict';

  var ENDPOINT = '/.netlify/functions/subscribe';
  // Kept for a host that embeds this beside a result of its own. On
  // /impact/subscribe/ no scan happens and none of these ever fire — that page
  // marks its container `open` instead. Both names are listened for because the
  // scanner renamed the event in the v4.1 redesign and a listener that silently
  // never fires is the failure this integration has already had once.
  var SHOW_EVENTS = ['clindar:scanned', 'clindar:scored'];
  var RESET_EVENT = 'clindar:reset';
  var PRIVACY_URL = '/impact/privacy/';

  var COPY = {
    heading: 'Follow the v4.0 rules catalogue',
    body:
      'The report is already yours, in the scanner — download it there as HTML, ' +
      'Markdown, PDF, JSON or an Excel checklist, free and behind no form. This ' +
      'is the mailing list beside it: the SDTMIG v4.0 change checklist, and a ' +
      'note when a rule in the catalogue changes.',
    label: 'Work email',
    submit: 'Join the list',
    sending: 'Adding…',
    done: 'Added to the list.',
    doneBody:
      'Your address is with our email provider now, and everything it sends ' +
      'carries an unsubscribe link. Nothing about any scan went with it, because ' +
      'this page never had it: the scanner runs in its own tab, under a policy ' +
      'that lets it reach nothing at all.',
    // Shown when the endpoint reports that no provider was contacted. It is a
    // misconfiguration notice, not a confirmation, and it is deliberately the
    // opposite of reassuring: nothing was stored and nothing will arrive.
    dev: 'Development mode — nothing was sent.',
    devBody:
      'This deploy has no email provider configured, so the address was ' +
      'discarded and no email will arrive. Set ESP_PROVIDER before anyone sees ' +
      'this. A configured deploy never shows this message.',
    note:
      'Your Define-XML never left your browser — the scanner page can open no ' +
      'connection at all. This page sends the address above, and nothing else.',
    privacy: 'How to verify that',
    errors: {
      invalid_email: 'That address does not look right. Check it and try again.',
      too_many_requests: 'Too many attempts from here. Try again in an hour.',
      subscribe_failed: 'We could not add that address just now. Try again shortly.',
      network: 'No response. Check your connection and try again.',
    },
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function message(code) {
    return COPY.errors[code] || COPY.errors.subscribe_failed;
  }

  function build(instance) {
    var root = el('section', 'clindar-capture');
    root.hidden = true;
    root.setAttribute('aria-live', 'polite');

    var heading = el('h2', 'clindar-capture__heading', COPY.heading);
    var body = el('p', 'clindar-capture__body', COPY.body);

    var form = el('form', 'clindar-capture__form');
    form.noValidate = true;

    var id = 'clindar-capture-email';
    var label = el('label', 'clindar-capture__label', COPY.label);
    label.htmlFor = id;

    var input = el('input', 'clindar-capture__input');
    input.type = 'email';
    input.id = id;
    input.name = 'email';
    input.required = true;
    input.autocomplete = 'email';
    input.spellcheck = false;
    input.placeholder = 'you@sponsor.com';

    // Honeypot. Hidden from sight and from screen readers, skipped by tabbing,
    // and named after something an autofiller might plausibly reach for.
    var trap = el('input', 'clindar-capture__trap');
    trap.type = 'text';
    trap.name = 'company';
    trap.tabIndex = -1;
    trap.autocomplete = 'off';
    trap.setAttribute('aria-hidden', 'true');

    var submit = el('button', 'clindar-capture__submit', COPY.submit);
    submit.type = 'submit';

    var error = el('p', 'clindar-capture__error');
    error.hidden = true;
    error.setAttribute('role', 'alert');

    var note = el('p', 'clindar-capture__note', COPY.note + ' ');
    var privacy = el('a', 'clindar-capture__link', COPY.privacy);
    privacy.href = PRIVACY_URL;
    note.appendChild(privacy);

    var row = el('div', 'clindar-capture__row');
    row.appendChild(input);
    row.appendChild(submit);

    form.appendChild(label);
    form.appendChild(row);
    form.appendChild(trap);
    form.appendChild(error);

    root.appendChild(heading);
    root.appendChild(body);
    root.appendChild(form);
    root.appendChild(note);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      submitForm(instance);
    });

    instance.root = root;
    instance.form = form;
    instance.input = input;
    instance.trap = trap;
    instance.submit = submit;
    instance.error = error;
    return root;
  }

  function showError(instance, text) {
    instance.error.textContent = text;
    instance.error.hidden = false;
    instance.input.setAttribute('aria-invalid', 'true');
  }

  function clearError(instance) {
    instance.error.hidden = true;
    instance.error.textContent = '';
    instance.input.removeAttribute('aria-invalid');
  }

  /**
   * `data.subscribed === false` is the endpoint saying it contacted no
   * provider — development mode. That is not a success to a visitor and must
   * never be dressed as one, so it gets the warning panel instead.
   *
   * Nothing here claims an email was delivered. The endpoint cannot know that,
   * so the widget cannot say it.
   */
  function succeed(instance, data) {
    var subscribed = !(data && data.subscribed === false);
    var done = el('div', 'clindar-capture__done');
    if (!subscribed) done.className += ' clindar-capture__done--unsent';
    done.appendChild(el('h2', 'clindar-capture__heading', subscribed ? COPY.done : COPY.dev));
    done.appendChild(el('p', 'clindar-capture__body', subscribed ? COPY.doneBody : COPY.devBody));
    instance.root.textContent = '';
    instance.root.appendChild(done);
    instance.state = 'done';
    if (typeof instance.options.onSuccess === 'function') {
      instance.options.onSuccess({ subscribed: subscribed });
    }
  }

  function submitForm(instance) {
    if (instance.state === 'sending' || instance.state === 'done') return;
    clearError(instance);

    var email = instance.input.value.trim();
    // The same shape the function enforces. Checking here saves a round trip;
    // it is not the check that matters.
    if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(email)) {
      showError(instance, COPY.errors.invalid_email);
      instance.input.focus();
      return;
    }

    instance.state = 'sending';
    instance.submit.disabled = true;
    instance.submit.textContent = COPY.sending;

    var payload = { email: email };
    if (instance.trap.value !== '') payload.company = instance.trap.value;

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // No cookies, in either direction. There are none to send.
      credentials: 'omit',
    })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            return { status: response.status, data: data };
          });
      })
      .then(function (result) {
        if (result.data && result.data.ok) {
          succeed(instance, result.data);
          return;
        }
        showError(instance, message(result.data && result.data.error));
      })
      .catch(function () {
        showError(instance, COPY.errors.network);
      })
      .then(function () {
        if (instance.state === 'done') return;
        instance.state = 'idle';
        instance.submit.disabled = false;
        instance.submit.textContent = COPY.submit;
      });
  }

  function resolve(target) {
    if (!target) return null;
    if (typeof target === 'string') return document.querySelector(target);
    return target.nodeType === 1 ? target : null;
  }

  // Whether a score has been announced, tracked at module level rather than per
  // widget. A page can announce one before the container exists — a scan of a
  // small file finishes long before a framework has painted anything — and a
  // widget mounted after the fact still has to know.
  var scored = false;
  var handles = [];

  for (var e = 0; e < SHOW_EVENTS.length; e++) {
    document.addEventListener(SHOW_EVENTS[e], function () {
      scored = true;
      for (var i = 0; i < handles.length; i++) handles[i].show();
    });
  }

  document.addEventListener(RESET_EVENT, function () {
    scored = false;
    for (var i = 0; i < handles.length; i++) handles[i].hide();
  });

  /**
   * Mount the widget into a container.
   *
   * By default it stays hidden until a scan has been announced to the document,
   * so that a host embedding it beside a result cannot show it before the
   * result — which is the shape of the funnel and not a detail to invert.
   *
   * `options.open` mounts it visible. That is for a page which IS the signup —
   * /impact/subscribe/, where the visitor arrived by clicking "Join the list"
   * and a form they have to wait for would be a page that does nothing. It is
   * not a way to put an ungated form in front of a result.
   */
  function mount(target, options) {
    var container = resolve(target);
    if (!container) return null;

    var instance = { state: 'idle', options: options || {} };
    container.textContent = '';
    container.appendChild(build(instance));

    var handle = {
      show: function () {
        if (instance.root.hidden) {
          instance.root.hidden = false;
          if (instance.options.focus) instance.input.focus();
        }
        return handle;
      },
      hide: function () {
        if (instance.state !== 'done') instance.root.hidden = true;
        return handle;
      },
      element: instance.root,
    };

    handles.push(handle);
    if (scored || instance.options.open) handle.show();
    return handle;
  }

  /*
   * Auto-mounting into [data-clindar-capture].
   *
   * The container may not exist when this script runs: a framework renders it
   * whenever it gets round to it, which for React is after DOMContentLoaded.
   * So watch for it rather than looking once. That keeps the host page's side
   * of the integration down to one empty element and one event — no import, no
   * lifecycle hook, nothing to get wrong.
   *
   * One widget per page, and the observer stops as soon as it finds it.
   */
  function autoMount() {
    var container = document.querySelector('[data-clindar-capture]');
    if (!container) return false;
    // `data-clindar-capture="open"` is the signup page saying it is the
    // destination rather than a panel beside a result.
    var open = container.getAttribute('data-clindar-capture') === 'open';
    return mount(container, { open: open }) !== null;
  }

  function watchForContainer() {
    if (autoMount()) return;
    if (!window.MutationObserver) return;

    var observer = new MutationObserver(function () {
      if (autoMount()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.ClindarCapture = { mount: mount };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchForContainer);
  } else {
    watchForContainer();
  }
})();
