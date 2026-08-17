import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { contentPages, sampleRoutes } from "./helpers/routes.mjs";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

/**
 * axe over every route, in both themes, at both viewports.
 *
 * axe catches roughly a third of what matters. The interaction tests below cover
 * the parts it structurally cannot see — whether focus actually moves, whether a
 * hidden thing is really out of the tab order, whether a focus ring is visible.
 * Those are where the legacy site's real bugs were.
 */
for (const { url } of contentPages) {
    for (const theme of ["light", "dark"]) {
        test(`${url} has no axe violations (${theme})`, async ({ page }) => {
            await page.emulateMedia({ colorScheme: theme });
            await page.goto(url);
            await page.evaluate((value) => {
                document.documentElement.dataset.theme = value;
            }, theme);

            const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

            expect(
                results.violations.map((violation) => ({
                    id: violation.id,
                    impact: violation.impact,
                    help: violation.help,
                    nodes: violation.nodes.map((node) => node.target.join(" "))
                }))
            ).toEqual([]);
        });
    }
}

test.describe("interaction behaviour axe cannot see", () => {
    test("the first Tab press reaches the skip link, and it moves focus to main", async ({ page }) => {
        await page.goto("/");
        await page.keyboard.press("Tab");

        const focused = page.locator(":focus");
        await expect(focused).toHaveClass(/skip-link/);

        await page.keyboard.press("Enter");
        await expect(page.locator("main")).toBeFocused();
    });

    // aria-pressed is server-rendered "false" on every page, because the server
    // cannot know the answer. site.js fixes it, but site.js is a module and so is
    // deferred; the inline script after the button is what makes the control
    // honest on the first frame. These two tests fail if that script is removed.
    for (const scheme of ["light", "dark"]) {
        test(`the theme toggle reports its state under a ${scheme} OS preference`, async ({ page }) => {
            await page.emulateMedia({ colorScheme: scheme });
            await page.goto("/");
            await expect(page.locator("[data-theme-toggle]")).toHaveAttribute(
                "aria-pressed",
                String(scheme === "dark")
            );
        });
    }

    test("an explicit theme choice moves the browser chrome colour with it", async ({ page }) => {
        // Both theme-color tags are media-scoped, which is correct with JS off and
        // wrong the moment someone overrides the OS: without the media re-point,
        // the chrome stays on the OS colour and disagrees with the page.
        await page.emulateMedia({ colorScheme: "light" });
        await page.goto("/");
        await page.locator("[data-theme-toggle]").click();

        const applied = await page
            .locator("meta[data-theme-color]")
            .evaluateAll((tags) =>
                tags.filter((tag) => tag.media === "all").map((tag) => tag.dataset.themeColor)
            );
        expect(applied, "exactly one theme-color tag should apply after an override").toEqual(["dark"]);
    });

    test("collapsed mobile navigation is not focusable", async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== "mobile", "viewport-specific");

        await page.goto("/");

        const toggle = page.locator("[data-nav-toggle]");
        await expect(toggle).toHaveAttribute("aria-expanded", "false");

        // The real assertion. `height: 0` with `overflow: hidden` looks collapsed
        // and still hands every link to a keyboard user. Only visibility or
        // display removes them from the tab order.
        const focusableCount = await page.locator("[data-nav] a").evaluateAll(
            (links) => links.filter((link) => link.checkVisibility({ visibilityProperty: true })).length
        );
        expect(focusableCount, "collapsed nav links are still focusable").toBe(0);
    });

    test("opening the mobile navigation moves focus into it and Escape closes it", async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== "mobile", "viewport-specific");

        await page.goto("/");
        const toggle = page.locator("[data-nav-toggle]");

        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        await expect(page.locator("[data-nav] a").first()).toBeFocused();

        await page.keyboard.press("Escape");
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await expect(toggle).toBeFocused();
    });

    // The four tests below assert properties of a rendered page, not of the site
    // chrome, so they run over a sample of real routes rather than the homepage
    // alone. A case study is where they earn it: `table-scroll` regions and
    // `<pre>` blocks exist nowhere else, and the scrollableRegions transform gives
    // both of them a tabindex.
    for (const { url } of sampleRoutes) {
        test(`${url} gives every focusable element a visible focus indicator`, async ({ page }) => {
            await page.goto(url);

            const offenders = await page.evaluate(() => {
                const selector =
                    "a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])";
                const bad = [];

                for (const element of document.querySelectorAll(selector)) {
                    // Elements that are not rendered at this viewport cannot paint a
                    // focus ring and cannot be focused by a user either. The mobile
                    // project covers them at the width where they exist.
                    if (!element.checkVisibility({ visibilityProperty: true })) continue;

                    element.focus();
                    const style = getComputedStyle(element);
                    const hasOutline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
                    const hasShadow = style.boxShadow !== "none";
                    if (!hasOutline && !hasShadow) {
                        bad.push(element.outerHTML.slice(0, 120));
                    }
                }
                return bad;
            });

            expect(offenders, "focusable elements with no visible focus indicator").toEqual([]);
        });

        test(`${url} has no positive tabindex`, async ({ page }) => {
            await page.goto(url);
            const positive = await page.locator("[tabindex]").evaluateAll((elements) =>
                elements.map((element) => element.getAttribute("tabindex")).filter((value) => Number(value) > 0)
            );
            expect(positive).toEqual([]);
        });

        test(`${url} honours reduced motion`, async ({ page }) => {
            await page.emulateMedia({ reducedMotion: "reduce" });
            await page.goto(url);

            // Nothing may be left hidden waiting for an animation that will not run.
            const hidden = await page.locator("[data-reveal]").evaluateAll((elements) =>
                elements.filter((element) => parseFloat(getComputedStyle(element).opacity) < 0.99).length
            );
            expect(hidden, "reveal targets are invisible under reduced motion").toBe(0);
        });

        test(`${url} is fully visible with JavaScript disabled`, async ({ browser }) => {
            const context = await browser.newContext({ javaScriptEnabled: false });
            const page = await context.newPage();
            await page.goto(url);

            const hidden = await page.locator("[data-reveal]").evaluateAll((elements) =>
                elements.filter((element) => parseFloat(getComputedStyle(element).opacity) < 0.99).length
            );
            expect(hidden, "reveal targets are hidden with JS off — the .js gate is missing").toBe(0);

            // The toggle cannot work without JavaScript and its server-rendered
            // aria-pressed cannot be corrected, so it must not be offered at all.
            await expect(page.locator("[data-theme-toggle]")).toBeHidden();

            await context.close();
        });
    }
});
