(() => {
  'use strict';

  const STORAGE_KEY = 'ouronex.language';
  const LANGUAGES = new Set(['en', 'zh-CN', 'zh-TW']);
  const ATTRIBUTES = ['content', 'alt', 'aria-label', 'placeholder', 'title', 'value'];
  const dictionary = window.OuroNexI18n || {};
  let current = 'en';

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (LANGUAGES.has(saved)) current = saved;
  } catch (_) {}

  function translated(key) {
    const entry = dictionary[key];
    if (!entry) return null;
    return entry[current] || entry.en || null;
  }

  const sourceIndex = new Map();
  Object.entries(dictionary).forEach(([key, entry]) => {
    if (entry.en && !sourceIndex.has(entry.en)) sourceIndex.set(entry.en, key);
  });

  function translateDynamic(element) {
    let key = element.dataset.i18nDynamicKey;
    if (!key) {
      const source = element.textContent.replace(/\s+/g, ' ').trim();
      key = sourceIndex.get(source);
      if (key) element.dataset.i18nDynamicKey = key;
    }
    if (!key) return;
    const value = translated(key);
    if (value !== null && element.textContent !== value) element.textContent = value;
  }

  function translateDate(element) {
    const value = element.getAttribute('datetime');
    if (!value) return;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return;
    const locale = current === 'en' ? 'en-US' : current;
    const style = element.dataset.i18nDate;
    const options = style === 'month-year'
      ? { year: 'numeric', month: 'long' }
      : style === 'datetime'
        ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { year: 'numeric', month: 'short', day: 'numeric' };
    element.textContent = new Intl.DateTimeFormat(locale, options).format(date);
  }

  function translateElement(element) {
    const userContent = element.matches('textarea, input:not([type="submit"]):not([type="button"]), [contenteditable], [data-user-input]')
      || element.closest('[contenteditable], [data-user-input]');
    if (!userContent && element.matches('[data-i18n]')) {
      const value = translated(element.dataset.i18n);
      if (value !== null && element.textContent !== value) element.textContent = value;
    }
    ATTRIBUTES.forEach(attribute => {
      if (userContent && attribute === 'value') return;
      const datasetName = `i18n${attribute.charAt(0).toUpperCase()}${attribute.slice(1)}`.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const key = element.dataset[datasetName];
      const effectiveKey = attribute === 'aria-label' && element.matches('.menu-toggle[aria-expanded="true"]') && dictionary['shared.close-navigation']
        ? 'shared.close-navigation'
        : key;
      if (!effectiveKey) return;
      const value = translated(effectiveKey);
      if (value !== null && element.getAttribute(attribute) !== value) element.setAttribute(attribute, value);
    });
    if (!userContent && element.matches('[data-i18n-dynamic]')) translateDynamic(element);
    if (!userContent && element.matches('[data-i18n-date]')) translateDate(element);
  }

  function apply(root = document) {
    if (root instanceof Element) translateElement(root);
    const scope = root instanceof Element || root instanceof Document ? root : document;
    scope.querySelectorAll('[data-i18n], [data-i18n-content], [data-i18n-alt], [data-i18n-aria-label], [data-i18n-placeholder], [data-i18n-title], [data-i18n-value], [data-i18n-dynamic], [data-i18n-date]').forEach(translateElement);
    document.documentElement.lang = current === 'zh-CN' ? 'zh-Hans' : current === 'zh-TW' ? 'zh-Hant' : 'en';
    document.documentElement.dataset.language = current;
    document.querySelectorAll('[data-lang]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.lang === current));
    });
  }

  function setLanguage(language) {
    if (!LANGUAGES.has(language)) return;
    current = language;
    try { localStorage.setItem(STORAGE_KEY, language); } catch (_) {}
    apply();
    document.dispatchEvent(new CustomEvent('ouronex:languagechange', { detail: { language } }));
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('button[data-lang]');
    if (!button) return;
    setLanguage(button.dataset.lang);
  });

  apply();
  window.OuroNexLanguage = Object.freeze({
    get current() { return current; },
    set: setLanguage,
    apply
  });

  const observer = new MutationObserver(records => {
    records.forEach(record => {
      if (record.type === 'attributes') {
        apply(record.target);
        return;
      }
      if (record.target instanceof Element && record.target.matches('[data-i18n-dynamic]')) {
        translateElement(record.target);
      }
      record.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) apply(node);
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] });
})();
