# Website translation dictionaries

The public site, news articles and Django account pages support English (`en`), Simplified Chinese (`zh-CN`) and Traditional Chinese (`zh-TW`). English remains the default. The selected language is stored locally in the browser under `ouronex.language`; switching does not reload the page or change URLs.

## Proofread existing content

Canonical dictionaries are the JSON files in `assets/i18n/`:

- `shared.json`: shared header, navigation and footer text.
- `home.json`, `business.json`, `platform.json`, and the other page-named files: static page content and SEO/accessibility strings.
- `sample-*.json`: individual news articles.
- `account-*.json`: Django account templates.
- `dynamic.json`: server-rendered account messages, plan names, plan features and subscription states.

Each entry has this shape:

```json
"home.download-sida.18f049": {
  "en": "Download SIDA",
  "zh-CN": "下载 SIDA",
  "zh-TW": "下載 SIDA"
}
```

Edit only the language values; keep keys and the English source stable. After any JSON edit, regenerate the JavaScript dictionaries:

```bash
python scripts/i18n_compile.py
python scripts/i18n_audit.py
```

The generated sibling `.js` files are loaded by the pages in a fixed order, so language changes do not depend on asynchronous dictionary fetches. Do not edit generated JS directly.

After dictionary changes, run JavaScript syntax checks, Django checks, and a real-browser pass over English, Simplified Chinese and Traditional Chinese. Check desktop navigation, the open mobile menu, long Chinese headings, form messages and persistence after reload. Confirm filled inputs, textareas, generated briefs and other user content remain byte-for-byte unchanged after every switch.

## Add new content

Add a unique key to the relevant page dictionary, then annotate the text node:

```html
<span data-i18n="home.new-key">English source</span>
```

Attributes use `data-i18n-alt`, `data-i18n-aria-label`, `data-i18n-placeholder`, `data-i18n-title`, `data-i18n-content`, or `data-i18n-value`, with the dictionary key as the value. `<title>` and `<option>` can carry `data-i18n` directly.

User-entered content is not dictionary content. Never put `data-i18n`, `data-i18n-dynamic`, or `data-i18n-value` on text inputs, textareas, editable regions, or values generated from user input. Their labels and placeholders may be translated; their values must remain unchanged. The runtime explicitly protects these controls even if they are annotated accidentally. Option labels may be translated because their submitted `value` attributes remain unchanged.

Put new shared navigation/footer entries in `shared.json`. Keep server-rendered values such as usernames outside translation spans. Known dynamic messages use `data-i18n-dynamic`; their exact English source must exist in `dynamic.json`. Dates use `data-i18n-date` and an ISO `datetime` value.

A page loads `shared.js`, its page dictionary, then `assets/i18n.js`. Account pages also load `dynamic.js`. Keep these scripts before `site.js` and `motion.js` so translated headings are the text used by entrance animations.

## Verification

After dictionary changes, run the compiler, JavaScript syntax checks, Django checks, and a real-browser pass over English, Simplified Chinese and Traditional Chinese. Check desktop navigation, the open mobile menu, long Chinese headings, form messages and persistence after reload.
