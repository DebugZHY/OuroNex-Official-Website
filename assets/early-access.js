/* Early access form: client-side validation and a local confirmation state.
   Nothing is submitted anywhere yet — the request is held in the page so the
   form can be wired to a mailbox or endpoint later without touching markup. */
(function () {
  'use strict';

  var form = document.querySelector('[data-access-form]');
  if (!form) return;

  var panel = document.querySelector('.access-panel');
  var done = document.querySelector('[data-access-done]');
  var doneCopy = document.querySelector('[data-access-done-copy]');
  var again = document.querySelector('[data-access-again]');
  var button = form.querySelector('.access-button');
  var label = form.querySelector('[data-access-label]');
  var status = form.querySelector('[data-access-status]');
  var idleLabel = label ? label.textContent : 'Request early access';

  var RULES = {
    name: {
      required: 'Tell us your name.',
      check: function (value) { return value.length >= 2; },
      message: 'Please write at least two characters.'
    },
    organisation: {
      required: 'Tell us which practice you are with.',
      check: function (value) { return value.length >= 2; },
      message: 'Please write at least two characters.'
    },
    email: {
      required: 'We need an email to reply to.',
      check: function (value) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value); },
      message: 'That email address looks incomplete.'
    },
    phone: {
      required: null,
      check: function (value) {
        if (!value) return true;
        var digits = value.replace(/\D/g, '');
        return /^[+()\d\s.-]+$/.test(value) && digits.length >= 6 && digits.length <= 20;
      },
      message: 'Use digits, spaces, brackets or a leading +.'
    }
  };

  function fieldOf(input) {
    return input.closest('.field');
  }

  function message(input) {
    var rule = RULES[input.name];
    if (!rule) return '';
    var value = input.value.trim();
    if (!value) return rule.required || '';
    return rule.check(value) ? '' : rule.message;
  }

  function showError(input, text) {
    var field = fieldOf(input);
    var slot = document.getElementById(input.id + '-error');
    if (field) field.classList.toggle('has-error', Boolean(text));
    if (slot) {
      slot.textContent = text;
      slot.hidden = !text;
    }
    input.setAttribute('aria-invalid', text ? 'true' : 'false');
  }

  function validate(input, focus) {
    var text = message(input);
    showError(input, text);
    if (text && focus) input.focus();
    return !text;
  }

  function inputs() {
    return Array.prototype.slice.call(form.querySelectorAll('input, select, textarea'));
  }

  function setStatus(text, isError) {
    if (!status) return;
    status.textContent = text;
    status.classList.toggle('is-error', Boolean(isError));
  }

  inputs().forEach(function (input) {
    if (!RULES[input.name]) return;
    input.addEventListener('blur', function () {
      if (input.value.trim()) validate(input, false);
    });
    input.addEventListener('input', function () {
      if (fieldOf(input).classList.contains('has-error')) validate(input, false);
    });
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var invalid = null;
    inputs().forEach(function (input) {
      if (!RULES[input.name]) return;
      var ok = validate(input, false);
      if (!ok && !invalid) invalid = input;
    });

    if (invalid) {
      setStatus('Please check the highlighted fields.', true);
      invalid.focus();
      return;
    }

    setStatus('', false);
    if (button) button.disabled = true;
    if (label) label.textContent = 'Sending…';

    var name = (form.querySelector('[name="name"]') || {}).value || '';
    var email = (form.querySelector('[name="email"]') || {}).value || '';

    window.setTimeout(function () {
      if (doneCopy) {
        doneCopy.textContent = 'Thanks' + (name ? ', ' + name.trim().split(/\s+/)[0] : '') +
          '. We have your details and will write to ' + email.trim() +
          ' within two working days.';
      }
      form.hidden = true;
      if (done) {
        done.hidden = false;
        var heading = done.querySelector('h2');
        if (heading) {
          heading.setAttribute('tabindex', '-1');
          heading.focus();
        }
      }
      if (button) button.disabled = false;
      if (label) label.textContent = idleLabel;
      if (panel) panel.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 900);
  });

  if (again) {
    again.addEventListener('click', function () {
      form.reset();
      inputs().forEach(function (input) {
        if (RULES[input.name]) showError(input, '');
      });
      setStatus('', false);
      if (done) done.hidden = true;
      form.hidden = false;
      var first = form.querySelector('[name="name"]');
      if (first) first.focus();
    });
  }
})();
