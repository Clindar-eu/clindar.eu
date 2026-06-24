/**
 * Mobile navigation toggle — opens/closes the nav menu on small screens.
 */
function initNavToggle() {
  const toggle = document.getElementById('navToggle');
  const menu = document.getElementById('navMenu');
  if (!toggle || !menu) return;

  toggle.addEventListener('click', () => {
    const isOpen = menu.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(isOpen));
  });

  // Close menu when a nav link is clicked (single-page scroll)
  menu.querySelectorAll('.navbar__link').forEach(link => {
    link.addEventListener('click', () => {
      menu.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
}

/**
 * Contact form validation and submission.
 * Validates required fields client-side and shows a success message on submit.
 */
function initContactForm() {
  const form = document.getElementById('contactForm');
  if (!form) return;

  const fields = [
    { id: 'name',    errorId: 'nameError',    message: 'Please enter your name.' },
    { id: 'email',   errorId: 'emailError',   message: 'Please enter a valid email address.' },
    { id: 'message', errorId: 'messageError', message: 'Please enter a message.' },
    { id: 'consent', errorId: 'consentError', message: 'Please confirm your consent to proceed.', type: 'checkbox' },
  ];

  /** Validate a single field, returns true if valid. */
  function validateField({ id, errorId, message, type }) {
    const input = document.getElementById(id);
    const error = document.getElementById(errorId);
    let invalid;

    if (type === 'checkbox') {
      invalid = !input.checked;
    } else {
      const isEmpty = !input.value.trim();
      const isInvalidEmail = id === 'email' && !isEmpty && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim());
      invalid = isEmpty || isInvalidEmail;
      input.classList.toggle('form-group__input--invalid', invalid);
    }

    error.textContent = invalid ? message : '';
    return !invalid;
  }

  // Show inline errors as user corrects each field
  fields.forEach(field => {
    const input = document.getElementById(field.id);
    const event = field.type === 'checkbox' ? 'change' : 'input';
    input.addEventListener(event, () => validateField(field));
    if (field.type !== 'checkbox') input.addEventListener('blur', () => validateField(field));
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const allValid = fields.map(validateField).every(Boolean);
    if (!allValid) return;

    const data = new FormData(form);

    fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data).toString(),
    })
      .then(() => {
        form.querySelectorAll('input, textarea, button').forEach(el => el.setAttribute('disabled', ''));
        const success = document.getElementById('formSuccess');
        success.hidden = false;
        success.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      })
      .catch(() => {
        alert('Something went wrong. Please try again or email us directly.');
      });
  });
}

function initIllustrationAnimations() {
  const items = document.querySelectorAll('.illustration-wrap');
  if (!items.length) return;

  if (!('IntersectionObserver' in window)) {
    items.forEach(el => el.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  items.forEach(el => observer.observe(el));
}

document.addEventListener('DOMContentLoaded', () => {
  initNavToggle();
  initContactForm();
  initIllustrationAnimations();
});
