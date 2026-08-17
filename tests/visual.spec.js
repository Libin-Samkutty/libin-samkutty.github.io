import { test, expect } from "@playwright/test";
import { sampleRoutes } from "./helpers/routes.mjs";

/**
 * Visual regression.
 *
 * The gap this fills: every other suite here asserts something nameable — a
 * contrast ratio, a byte count, a missing alt. None of them notice a card that
 * has lost its border, a grid that has collapsed to one column, or a token change
 * that turned every heading two shades lighter. Those are the failures a reader
 * would see first.
 *
 * Two decisions worth knowing before adding to this file:
 *
 * 1. `/styleguide/` carries most of the weight. It renders every component once,
 *    so a token or spacing change surfaces as one diff on one page. The four
 *    sample routes exist to catch composition — the way real content fills a
 *    layout — not to re-cover the components.
 *
 * 2. Baselines are platform-specific and are generated on the CI runner, never
 *    locally. Font rasterization differs enough between Windows and Ubuntu that a
 *    Windows-authored baseline can never match. See
 *    `.github/workflows/visual-baselines.yml`.
 *
 * When a snapshot fails: read the diff, decide whether it is intentional, and if
 * it is, regenerate through that workflow. Never reach for `--update-snapshots`
 * to make the suite green — that turns the gate into a rubber stamp, which is the
 * single most common way visual testing dies.
 */

const ROUTES = [{ url: "/styleguide/", name: "styleguide" }, ...sampleRoutes.map(({ url }) => ({ url, name: slug(url) }))];

/** `/work/llm-judge-independence/` becomes `work-llm-judge-independence`. */
function slug(url) {
    return url === "/" ? "home" : url.replace(/^\/|\/$/g, "").replace(/\//g, "-");
}

for (const { url, name } of ROUTES) {
    for (const theme of ["light", "dark"]) {
        test(`${url} matches its baseline (${theme})`, async ({ page }) => {
            // Reduced motion is doing real work here, not just suppressing
            // transitions. `src/css/base.css` starts every [data-reveal] element
            // at opacity 0, and site.js reveals them on intersection — so a
            // full-page screenshot would otherwise capture whatever happened to be
            // below the fold as blank. Under reduced motion site.js reveals every
            // target immediately and tokens.css zeroes the durations, which is the
            // site's own machinery rather than something invented for the test.
            await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
            await page.goto(url);

            // The toggle sets data-theme, which overrides the media query. Setting
            // it explicitly means the screenshot cannot depend on emulateMedia and
            // the override agreeing.
            await page.evaluate((value) => {
                document.documentElement.dataset.theme = value;
            }, theme);

            // Webfonts settle after first paint and shift text by a pixel or two.
            await page.evaluate(() => document.fonts.ready);

            await expect(page).toHaveScreenshot(`${name}-${theme}.png`, {
                fullPage: true,
                // Reading time and "last updated" are recomputed from content and
                // from site.lastUpdated. Neither is a design change, and both would
                // otherwise fail every baseline on an unrelated edit.
                mask: [page.locator("[data-volatile]")]
            });
        });
    }
}
