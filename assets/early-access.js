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
  var idleKey = label && label.dataset.i18n ? label.dataset.i18n : 'early-access.form.submit';
  var pending = false;
  var confirmation = null;
  var statusState = { key: '', fallback: '', isError: false };

  var FALLBACKS = {
    'early-access.validation.name-required': 'Tell us your name.',
    'early-access.validation.organisation-required': 'Tell us which practice you are with.',
    'early-access.validation.email-required': 'We need an email to reply to.',
    'early-access.validation.min-two-characters': 'Please write at least two characters.',
    'early-access.validation.email-invalid': 'That email address looks incomplete.',
    'early-access.validation.phone-invalid': 'Use digits, spaces, brackets or a leading +.',
    'early-access.validation.check-fields': 'Please check the highlighted fields.',
    'early-access.form.sending': 'Sending…',
    'early-access.success.confirmation': 'Thanks, {name}. We have your details and will write to {email} within two working days.'
  };

  function t(key, fallback) {
    var api = window.OuroNexLanguage;
    var value = api && typeof api.t === 'function' ? api.t(key) : '';
    return value || fallback;
  }

  var RULES = {
    name: {
      required: 'early-access.validation.name-required',
      check: function (value) { return value.length >= 2; },
      message: 'early-access.validation.min-two-characters'
    },
    organisation: {
      required: 'early-access.validation.organisation-required',
      check: function (value) { return value.length >= 2; },
      message: 'early-access.validation.min-two-characters'
    },
    email: {
      required: 'early-access.validation.email-required',
      check: function (value) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value); },
      message: 'early-access.validation.email-invalid'
    },
    phone: {
      required: null,
      check: function (value) {
        if (!value) return true;
        var digits = value.replace(/\D/g, '');
        return /^[+()\d\s.-]+$/.test(value) && digits.length >= 6 && digits.length <= 20;
      },
      message: 'early-access.validation.phone-invalid'
    }
  };

  function fieldOf(input) {
    return input.closest('.field');
  }

  function messageKey(input) {
    var rule = RULES[input.name];
    if (!rule) return '';
    var value = input.value.trim();
    if (!value) return rule.required || '';
    return rule.check(value) ? '' : rule.message;
  }

  function showError(input, key) {
    var field = fieldOf(input);
    var slot = document.getElementById(input.id + '-error');
    var text = key ? t(key, FALLBACKS[key] || '') : '';
    input.dataset.errorKey = key || '';
    if (field) field.classList.toggle('has-error', Boolean(text));
    if (slot) {
      slot.textContent = text;
      slot.hidden = !text;
    }
    input.setAttribute('aria-invalid', text ? 'true' : 'false');
  }

  function validate(input, focus) {
    var key = messageKey(input);
    showError(input, key);
    if (key && focus) input.focus();
    return !key;
  }

  function inputs() {
    return Array.prototype.slice.call(form.querySelectorAll('input, select, textarea'));
  }

  function renderStatus() {
    if (!status) return;
    status.textContent = statusState.key ? t(statusState.key, statusState.fallback) : '';
    status.classList.toggle('is-error', Boolean(statusState.isError));
  }

  function setStatus(key, fallback, isError) {
    statusState = { key: key || '', fallback: fallback || '', isError: Boolean(isError) };
    renderStatus();
  }

  function clearResolvedStatus() {
    if (statusState.isError && !form.querySelector('.field.has-error')) setStatus('', '', false);
  }

  function renderButton() {
    if (!label) return;
    var key = pending ? 'early-access.form.sending' : idleKey;
    var fallback = pending ? FALLBACKS['early-access.form.sending'] : idleLabel;
    label.textContent = t(key, fallback);
  }

  function renderConfirmation() {
    if (!doneCopy || !confirmation) return;
    var template = t('early-access.success.confirmation', FALLBACKS['early-access.success.confirmation']);
    doneCopy.textContent = template.replace(/\{(name|email)\}/g, function (_, key) {
      return confirmation[key];
    });
  }

  function refreshTranslations() {
    inputs().forEach(function (input) {
      if (input.dataset.errorKey) showError(input, input.dataset.errorKey);
    });
    renderStatus();
    renderButton();
    renderConfirmation();
  }

  inputs().forEach(function (input) {
    if (!RULES[input.name]) return;
    input.addEventListener('blur', function () {
      if (input.value.trim()) {
        validate(input, false);
        clearResolvedStatus();
      }
    });
    input.addEventListener('input', function () {
      if (fieldOf(input).classList.contains('has-error')) {
        validate(input, false);
        clearResolvedStatus();
      }
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
      setStatus('early-access.validation.check-fields', FALLBACKS['early-access.validation.check-fields'], true);
      invalid.focus();
      return;
    }

    setStatus('', '', false);
    pending = true;
    if (button) button.disabled = true;
    renderButton();

    var name = (form.querySelector('[name="name"]') || {}).value || '';
    var email = (form.querySelector('[name="email"]') || {}).value || '';

    window.setTimeout(function () {
      var fullName = name.trim();
      confirmation = { name: fullName, email: email.trim() };
      pending = false;
      renderConfirmation();
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
      renderButton();
      if (panel) panel.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 900);
  });

  document.addEventListener('ouronex:languagechange', refreshTranslations);

  if (again) {
    again.addEventListener('click', function () {
      pending = false;
      confirmation = null;
      form.reset();
      inputs().forEach(function (input) {
        if (RULES[input.name]) showError(input, '');
      });
      setStatus('', '', false);
      renderButton();
      if (done) done.hidden = true;
      form.hidden = false;
      var first = form.querySelector('[name="name"]');
      if (first) first.focus();
    });
  }
})();
