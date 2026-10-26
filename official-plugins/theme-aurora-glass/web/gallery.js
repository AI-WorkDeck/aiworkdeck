// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
(function () {
  const dictionaries = window.AWD_THEME_L10N;
  // Hosts before the preview language channel use the package's explicit fallback.
  // Browser/OS language is not a substitute for the user's application preference.
  function render(language) {
    const locale = Object.hasOwn(dictionaries, language) ? language : 'en-US';
    const words = dictionaries[locale];
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar-SA' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach(function (element) {
      const key = element.dataset.i18n;
      element.textContent = words[key] || dictionaries['en-US'][key] || '';
    });
  }
  render('en-US');
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent || event.data?.awd !== 1) return;
    const message = event.data;
    const language = message.type === 'init' ? message.context?.language
      : message.type === 'theme' ? message.language : null;
    if (language) render(language);
  });
}());
