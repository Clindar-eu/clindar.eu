/*
 * Clindar email capture widget.
 *
 * Standalone: no framework, no build step, no dependencies. It is served from
 * the same origin as the page that mounts it, which is what lets it run under
 * the scanner's `script-src 'self'`.
 *
 * The contract it keeps, and the reason the privacy page can say what it says:
 * the only thing this widget ever sends is the address typed into its input.
 * It reads no scan result, no file name, no study identifier. The event that
 * reveals it may carry a score in `detail` — that is used to decide whether to
 * appear, and is never read into the request body.
 *
 * Integration: docs/scanner-integration.md in the site repo.
 */
(function () {
  'use strict';

  var ENDPOINT = '/.netlify/functions/subscribe';
  var SHOW_EVENT = 'clindar:scored';
  var RESET_EVENT = 'clindar:reset';
  var PRIVACY_URL = '/impact/privacy/';

  var COPY = {
    heading: 'Get the full written report',
    body:
      'The score is yours already. The written report — every finding, what changes, ' +
      'and what to do about it — goes to your inbox.',
    label: 'Work email',
    submit: 'Send me the report',
    sending: 'Sending…',
    done: 'Check your inbox.',
    doneBody: 'The report is on its way. Nothing else was sent.',
    note: 'Your Define-XML never left this browser. Only the address above does.',
    privacy: 'How to verify that',
    errors: {
      invalid_email: 'That address does not look right. Check it and try again.',
      too_many_requests: 'Too many attempts from here. Try again in an hour.',
      delivery_failed: 'We could not record that just now. Try again shortly.',
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
    return COPY.errors[code] || COPY.errors.delivery_failed;
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

  function succeed(instance) {
    var done = el('div', 'clindar-capture__done');
    done.appendChild(el('h2', 'clindar-capture__heading', COPY.done));
    done.appendChild(el('p', 'clindar-capture__body', COPY.doneBody));
    instance.root.textContent = '';
    instance.root.appendChild(done);
    instance.state = 'done';
    if (typeof instance.options.onSuccess === 'function') instance.options.onSuccess();
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
          succeed(instance);
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

  document.addEventListener(SHOW_EVENT, function () {
    scored = true;
    for (var i = 0; i < handles.length; i++) handles[i].show();
  });

  document.addEventListener(RESET_EVENT, function () {
    scored = false;
    for (var i = 0; i < handles.length; i++) handles[i].hide();
  });

  /**
   * Mount the widget into a container. It stays hidden until a `clindar:scored`
   * event has reached the document, so it cannot appear before a score is on
   * screen — which is the whole shape of the funnel and not a detail to invert.
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
    if (scored) handle.show();
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
    return mount(container, {}) !== null;
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
