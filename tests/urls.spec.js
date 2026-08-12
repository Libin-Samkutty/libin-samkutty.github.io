import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const legacy = JSON.parse(
    readFileSync(new URL("../src/_data/legacyUrls.json", import.meta.url), "utf8")
);

/**
 * The hard gate.
 *
 * Every URL that existed on the live site before the migration must keep
 * resolving. Some of these are on a LinkedIn profile and in other people's
 * bookmarks; a rebuild that silently 404s them has cost something real for a
 * cosmetic gain.
 *
 * GitHub Pages cannot issue a 301, so a legacy path resolves either as a real
 * page or as a redirect stub carrying a canonical. This asserts the former; the
 * stub's correctness is asserted below.
 */
test.describe("legacy URLs", () => {
    for (const path of legacy.mustExist) {
        test(`${path} still resolves`, async ({ page }) => {
            const response = await page.goto(path, { waitUntil: "domcontentloaded" });
            expect(response, `no response for ${path}`).not.toBeNull();
            expect(response.status(), `${path} returned ${response?.status()}`).toBeLessThan(400);
        });
    }

    for (const [path, fragments] of Object.entries(legacy.mustExistFragments ?? {})) {
        for (const fragment of fragments) {
            test(`${path}#${fragment} target exists after redirect`, async ({ page }) => {
                await page.goto(path);
                // Follow the meta refresh to the destination, then assert the anchor
                // the old page linked to is still a real element there.
                await page.waitForURL((url) => !url.pathname.endsWith(path), { timeout: 10_000 });
                await expect(page.locator(`#${fragment}`)).toHaveCount(1);
            });
        }
    }
});

test.describe("redirect stubs", () => {
    const redirects = JSON.parse(
        readFileSync(new URL("../src/_data/redirects.json", import.meta.url), "utf8")
    );

    for (const { from, to } of redirects) {
        test(`${from} points at ${to}`, async ({ request }) => {
            // Fetched rather than navigated to. The refresh delay is 0, so a
            // page.goto lands on the destination and every assertion would
            // silently be made against the wrong document.
            const response = await request.get(from);
            expect(response.status(), `${from} returned ${response.status()}`).toBe(200);

            const html = await response.text();

            expect(html, `${from} has no canonical pointing at ${to}`).toMatch(
                new RegExp(`<link rel="canonical" href="[^"]*${to}"`)
            );
            expect(html, `${from} must be noindex`).toMatch(/<meta name="robots" content="[^"]*noindex/);
            expect(html, `${from} has no meta refresh`).toContain(`url=${to}`);

            // A stub that works only via meta refresh strands anyone whose browser
            // blocks it. There must be a real link in the markup.
            expect(html, `${from} has no visible link to ${to}`).toContain(`href="${to}"`);
        });
    }

    test("no redirect points at itself", () => {
        for (const { from, to } of redirects) {
            expect(to, `${from} redirects to itself`).not.toBe(from);
        }
    });

    test("every redirect destination is a URL the site actually publishes", async ({ page }) => {
        for (const { to } of redirects) {
            const response = await page.goto(to, { waitUntil: "domcontentloaded" });
            expect(response?.status(), `redirect destination ${to} is missing`).toBeLessThan(400);
        }
    });
});
