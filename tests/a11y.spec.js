import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { contentPages } from "./helpers/routes.mjs";

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

    test("every focusable element has a visible focus indicator", async ({ page }) => {
        await page.goto("/");

        const offenders = await page.evaluate(() => {
            const selector = "a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])";
            const bad = [];

            for (const element of document.querySelectorAll(selector)) {
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

    test("no positive tabindex anywhere", async ({ page }) => {
        await page.goto("/");
        const positive = await page.locator("[tabindex]").evaluateAll((elements) =>
            elements.map((element) => element.getAttribute("tabindex")).filter((value) => Number(value) > 0)
        );
        expect(positive).toEqual([]);
    });

    test("reduced motion is honoured", async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto("/");

        // Nothing may be left hidden waiting for an animation that will not run.
        const hidden = await page.locator("[data-reveal]").evaluateAll((elements) =>
            elements.filter((element) => parseFloat(getComputedStyle(element).opacity) < 0.99).length
        );
        expect(hidden, "reveal targets are invisible under reduced motion").toBe(0);
    });

    test("content is fully visible with JavaScript disabled", async ({ browser }) => {
        const context = await browser.newContext({ javaScriptEnabled: false });
        const page = await context.newPage();
        await page.goto("/");

        const hidden = await page.locator("[data-reveal]").evaluateAll((elements) =>
            elements.filter((element) => parseFloat(getComputedStyle(element).opacity) < 0.99).length
        );
        expect(hidden, "reveal targets are hidden with JS off — the .js gate is missing").toBe(0);

        await context.close();
    });
});
