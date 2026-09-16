/*
 * Clindar scanner signup link.
 *
 * The scanner page runs under `connect-src 'none'` (see netlify.toml). Nothing
 * on it can open a connection, so nothing on it can carry a form. What it can
 * carry is a link, and this file is that link and nothing else.
 *
 * It replaces the email capture widget that used to be injected here. That
 * widget now lives on its own page at /impact/subscribe/, where a form is an
 * ordinary thing for a page to have. The split is the point: the scanner page
 * became a page with no reachable destination at all, which is a claim a reader
 * can check in the response headers in one look, instead of a claim about the
 * header plus a claim about the source that only a code review settles.
 *
 * WHAT THIS FILE MAY NEVER DO. It may not call fetch, XMLHttpRequest or
 * sendBeacon; the policy would refuse it, and the refusal would be a console
 * error on the one page that promises none. It may not read `event.detail` —
 * the scanner sends none, deliberately (see App.tsx: "the event carries no
 * detail because nothing about the scan is any listener's business") — and it
 * may not put a study identifier, a file name, a category, a count or any other
 * scan-derived value into the href, a query string, a fragment or storage. The
 * link is the same href for every visitor and every scan. That is what makes it
 * a navigation the reader chooses rather than a report we took.
 *
 * Integration: docs/scanner-integration.md.
 */
(function () {
  'use strict';

  var SIGNUP_URL = '/impact/subscribe/';
  var PRIVACY_URL = '/impact/privacy/';

  // `clindar:scanned` is what the scanner dispatches today. `clindar:scored` is
  // what it dispatched before the v4.1 report redesign renamed it, and it is
  // still listened for so that a submodule pinned to an older scanner does not
  // silently lose the link — a widget that quietly never appears is the failure
  // mode this integration has already had once.
  var SHOW_EVENTS = ['clindar:scanned', 'clindar:scored'];
  var RESET_EVENT = 'clindar:reset';

  var COPY = {
    heading: 'Follow the v4.0 rules catalogue',
    body:
      'Your report is already yours — download it from the study detail above. ' +
      'Separately, and only if you want it: the SDTMIG v4.0 change checklist, ' +
      'and a note when a rule in the catalogue changes.',
    action: 'Join the list',
    // The reader is about to leave a page that can reach nothing for one that
    // can reach one endpoint. Saying so here, before the click, is the honest
    // place for it — the destination page says it again beside the field.
    note:
      'That opens a separate page. Nothing from this scan goes with you: no ' +
      'file name, no study, no result. The signup page takes an email address ' +
      'and nothing else.',
    privacy: 'How to verify that',
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function build() {
    var root = el('section', 'clindar-signup');
    root.hidden = true;

    root.appendChild(el('h2', 'clindar-signup__heading', COPY.heading));
    root.appendChild(el('p', 'clindar-signup__body', COPY.body));

    // A plain anchor with a fixed href. No click handler, no beacon, nothing
    // assembled at runtime: what the status bar shows on hover is the whole of
    // what happens.
    var action = el('a', 'clindar-signup__action', COPY.action);
    action.href = SIGNUP_URL;
    root.appendChild(action);

    var note = el('p', 'clindar-signup__note', COPY.note + ' ');
    var privacy = el('a', 'clindar-signup__link', COPY.privacy);
    privacy.href = PRIVACY_URL;
    note.appendChild(privacy);
    root.appendChild(note);

    return root;
  }

  function resolve(target) {
    if (!target) return null;
    if (typeof target === 'string') return document.querySelector(target);
    return target.nodeType === 1 ? target : null;
  }

  // Whether a scan has been announced, tracked at module level rather than per
  // mount. The scanner can announce one before its container is painted, and a
  // link mounted after the fact still has to know.
  var scanned = false;
  var handles = [];

  for (var i = 0; i < SHOW_EVENTS.length; i++) {
    document.addEventListener(SHOW_EVENTS[i], function () {
      scanned = true;
      for (var j = 0; j < handles.length; j++) handles[j].show();
    });
  }

  document.addEventListener(RESET_EVENT, function () {
    scanned = false;
    for (var j = 0; j < handles.length; j++) handles[j].hide();
  });

  /**
   * Mount the link into a container. It stays hidden until a scan has been
   * announced, so it cannot appear before a result is on screen.
   */
  function mount(target) {
    var container = resolve(target);
    if (!container) return null;

    container.textContent = '';
    var root = build();
    container.appendChild(root);

    var handle = {
      show: function () {
        root.hidden = false;
        return handle;
      },
      hide: function () {
        root.hidden = true;
        return handle;
      },
      element: root,
    };

    handles.push(handle);
    if (scanned) handle.show();
    return handle;
  }

  /*
   * Auto-mounting into [data-clindar-capture].
   *
   * The attribute keeps its name because it is the scanner's, not ours: the
   * container is rendered by App.tsx and renaming it would mean a scanner
   * release for a cosmetic change. The scanner has no idea what goes in it —
   * once a form, now a link — which is exactly the property that let this
   * change happen in one repo.
   *
   * The container may not exist when this script runs, so watch for it rather
   * than looking once.
   */
  function autoMount() {
    var container = document.querySelector('[data-clindar-capture]');
    if (!container) return false;
    return mount(container) !== null;
  }

  function watchForContainer() {
    if (autoMount()) return;
    if (!window.MutationObserver) return;

    var observer = new MutationObserver(function () {
      if (autoMount()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.ClindarSignupLink = { mount: mount };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchForContainer);
  } else {
    watchForContainer();
  }
})();
