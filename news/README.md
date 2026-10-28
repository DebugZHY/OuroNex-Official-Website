# News articles

This folder holds the source and generated pages for the OuroNex News section.
`news.html` (the index listing) is maintained separately; do not edit it here.

## Layout

| Path | Role |
| --- | --- |
| `news/_template.html` | Static article shell (header/footer copied from `platform.html`, `aria-current="page"` on News). Contains the `<!-- BUILD: content injected from md here -->` slot. |
| `news/<slug>.md` | An article source: frontmatter + Markdown body. |
| `news/<slug>.html` | Generated page. **Never edit by hand** — it is overwritten on every build. |
| `tools/build-news.py` | The builder (Python standard library only). |

## Adding an article

1. Create `news/<slug>.md`, where `<slug>` matches `[a-z0-9][a-z0-9-]*`
   (it becomes the file name and therefore the URL).
2. Add the frontmatter and body (see below).
3. Build all articles:

   ```sh
   python tools/build-news.py
   ```

   The script can run from any working directory; it resolves the repository
   root from its own location. It prints one line per article, e.g.
   `sample-feature.md -> sample-feature.html: 331 words, ~2 min read`.
4. Commit **both** the `.md` source and the generated `.html`.

`README.md` and files beginning with `_` are skipped by the builder.

## Frontmatter

Exactly these four keys, between `---` markers on the first lines of the file:

```markdown
---
title: Why we treat review as the product, not the checkpoint
date: 21 October 2026
tag: Practice
excerpt: The checkpoint model assumes engineering judgement happens at the end.
---
```

- `date` must look like `21 October 2026` (the builder rejects other shapes).
- `excerpt` is used verbatim as the page's `<meta name="description">`.
- Unknown or missing keys abort the run.
- Reading time is computed from the body word count (~200 words per minute);
  do not type it into the Markdown.

## Supported Markdown (deliberately minimal)

- `#`, `##` → an in-article `<h2>`; `###` → `<h3>` (the article `<h1>` comes
  from the frontmatter `title`).
- Paragraphs separated by blank lines; consecutive lines join into one paragraph.
- `*` or `-` lists (a single level).
- `**bold**`, `*italic*`, `` `code` ``.
- `> ` blockquotes.

Anything else is rejected with a non-zero exit status and **no files are
written**: images, tables, fenced code blocks, ordered lists, Markdown links,
stray `*`/`` ` `` characters, headings deeper than `###`, and headings without
a space after `#`. This keeps the sources portable and the generated HTML
predictable.

## Placeholders in the template

`tools/build-news.py` fills `news/_template.html` and fails if a placeholder is
missing or left over:

- `ARTICLE_TITLE` — frontmatter `title` (used in `<title>`, the breadcrumb and the `<h1>`).
- `ARTICLE_EXCERPT` — frontmatter `excerpt` (meta description).
- `<span data-news-tag>TAG</span>` — frontmatter `tag`.
- `<span data-news-date>DATE</span>` — frontmatter `date`.
- `READING_TIME` — computed reading time, in minutes.
- `<!-- BUILD: content injected from md here -->` — the rendered body.

If the build reports an error, fix the Markdown and run it again; nothing is
partially written.