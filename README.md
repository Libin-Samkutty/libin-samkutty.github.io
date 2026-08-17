# libin-samkutty.github.io

Portfolio site for Libin Samkutty — Senior QA Automation Engineer, working on
evaluation systems for AI products.

Built with [Eleventy](https://www.11ty.dev/). The published output is plain
static HTML with one stylesheet, one small script, self-hosted fonts and **no
third-party requests at all** — a Lighthouse budget asserts that, so a CDN cannot
creep back in without failing the build.

## Quick start

```bash
npm ci
npx playwright install --with-deps chromium   # the build renders social cards in a browser
npm run serve                                  # http://localhost:8080
```

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | Eleventy, then one Open Graph card per page |
| `npm run serve` | Local dev server with live reload |
| `npm run test:html` | html-validate over the built output (~2s, no browser) |
| `npm run test:e2e` | Playwright: URLs, accessibility, HTML quality, links, content consistency |
| `npm run test:perf` | Lighthouse CI against the budgets in `lighthouserc.cjs` |
| `npm run test` | build → html-validate → Playwright |
| `npm run verify` | everything, from a clean tree |

`node scripts/parity.mjs` additionally checks the built site against the legacy
tree, for as long as that tree exists.

## How it is put together

**Facts live in `src/_data/`, not in prose.** Every number published anywhere
comes from `metrics.json` through a `{% metric %}` shortcode that throws at build
time on an unknown key, on a number marked unpublishable, on a projection with no
footnote, and on a figure attributed to a team with nobody credited. This is the
central idea of the rebuild: the previous version of this site disagreed with
itself about how many countries the platform ran in and how many users it had,
because those facts were hand-copied into thirteen files.

**Chrome lives in `src/_includes/`.** Nav, footer and `<head>` appear once.

**Everything is a gate, not a guideline.** Accessibility, performance, HTML
quality, internal links, URL preservation and the disclosure policy are all
asserted in CI on every pull request and again on the deploy. Routes are
discovered from the build output rather than listed, so a new page is covered by
every suite without anyone remembering to add it.

## Accessibility

axe (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, plus best-practice) runs over
every route, in both themes, at two viewports. Because axe can only see about a
third of what matters, the suite also asserts the things it structurally cannot:
that the first Tab press reaches the skip link and that activating it moves
focus, that collapsed mobile navigation is genuinely out of the tab order rather
than merely invisible, that every focusable element paints a focus indicator,
that reduced motion leaves nothing hidden waiting for an animation that will not
run, and that with JavaScript disabled the whole page is still readable.

## Performance

Budgets, not aspirations — the build fails on a regression:

| | Budget | Current |
|---|---|---|
| Performance / A11y / Best practices / SEO | ≥0.95 / 1.00 / 1.00 / 1.00 | 1.00 across all four |
| LCP | ≤2000 ms | ~380 ms |
| CLS | ≤0.05 | 0.000 |
| Total transfer | ≤600 KB | ~125 KB |
| Third-party requests | 0 | 0 |

## Writing

See [CONTENT.md](CONTENT.md) for how to add a case study or a post, the metric
rules, and the disclosure policy. See [CLAUDE.md](CLAUDE.md) for the engineering
conventions.

## Licence

Code is MIT. The writing and the images are not — please do not republish them.
