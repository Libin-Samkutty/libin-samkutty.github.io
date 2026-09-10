import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * The receipt for /lab/.
 *
 * The lab page tells a reader that its runner implements the same locator and
 * auto-waiting semantics Playwright uses. That is a claim about behaviour, and
 * on this site a claim about behaviour is supposed to be checkable rather than
 * asserted — the same reason every published number goes through metrics.json.
 *
 * So each challenge is run twice against the same demo app: once by the
 * in-browser runner, and once by real Playwright driving the same DOM through
 * the same steps. If the two ever disagree, this fails and the sentence on
 * /lab/ stops being true until someone fixes one of them.
 *
 * Two things this deliberately does not claim:
 *   - That the runner is a complete Playwright. It resolves eight roles and
 *     seven matchers. The page says so.
 *   - That agreeing on these scenarios proves agreement on all of them. It
 *     proves it for the behaviour the page teaches, which is what is on the
 *     page.
 */

const challenges = JSON.parse(
    readFileSync(new URL("../src/_data/labChallenges.json", import.meta.url), "utf8")
).items;

/** Mirrors the variant map in src/js/lab/ui.js. */
const VARIANTS = {
    default: {},
    flaky: { flaky: true },
    renamed: { renamed: true },
    unnamed: { unnamed: true }
};

/**
 * Playwright equivalents of each challenge's starting test, written against
 * the real API. These are hand-written on purpose: translating the source
 * automatically would test the translator, not the semantics.
 *
 * `expected` is what BOTH engines must report for the starting code.
 */
const SCENARIOS = {
    "first-test": {
        expected: "pass",
        real: async (frame) => {
            await frame.getByTestId("approve").click();
            await expect(frame.getByTestId("status")).toHaveText("approved 1");
        }
    },
    "auto-wait": {
        // The starting code sleeps 200ms against a load of up to 900ms, so it
        // is genuinely unreliable — which makes it useless as a parity check.
        // The *solved* version is checked instead, and the starting version's
        // unreliability is asserted separately below.
        expected: "pass",
        source: "await expect(page.getByTestId('answer')).toContainText('anomaly scan');",
        real: async (frame) => {
            await expect(frame.getByTestId("answer")).toContainText("anomaly scan");
        }
    },
    "resilient-locator": {
        expected: "fail",
        real: async (frame) => {
            await frame.getByRole("button", { name: "Approve" }).click({ timeout: 4000 });
            await expect(frame.getByTestId("status")).toContainText("approved");
        },
        // The starting locator finds the button in the default app and misses
        // it once renamed, so parity is checked against the renamed variant
        // where both engines must fail.
        variant: "renamed"
    },
    "missing-name": {
        expected: "fail",
        real: async (frame) => {
            await frame
                .getByRole("button", { name: "Flag for review" })
                .click({ timeout: 4000 });
        },
        variant: "unnamed"
    },
    "strict-mode": {
        expected: "fail",
        real: async (frame) => {
            await expect(frame.locator("dd")).toHaveText("0.82", { timeout: 4000 });
        },
        variant: "default"
    },
    "negative-assertion": {
        expected: "pass",
        source:
            "await expect(page.getByTestId('spinner')).toBeVisible();\n" +
            "await expect(page.getByTestId('spinner')).not.toBeVisible();",
        real: async (frame) => {
            await expect(frame.getByTestId("spinner")).toBeVisible();
            await expect(frame.getByTestId("spinner")).not.toBeVisible();
        }
    }
};

/**
 * Run one test through the in-browser runner, on the real /lab/ page, and
 * return its verdict. This exercises the shipped modules over HTTP rather than
 * a copy of them, so a broken import path fails here too.
 */
async function runInBrowser(page, source, variantName) {
    return page.evaluate(
        async ([src, variant]) => {
            const { runTest } = await import("/js/lab/runner.js");
            const frame = document.querySelector("[data-lab-frame]");
            const result = await runTest(src, frame, variant);
            return { status: result.status, error: result.error || null };
        },
        [source, VARIANTS[variantName] || {}]
    );
}

/** Drive the same demo app with real Playwright, in an isolated page. */
async function runInPlaywright(page, scenario, variantName) {
    await page.goto("/lab/");
    // Build the same document the runner builds, from the same module, so the
    // two engines are demonstrably looking at identical DOM.
    await page.evaluate(
        async ([variant]) => {
            const { loadApp } = await import("/js/lab/runner.js");
            await loadApp(document.querySelector("[data-lab-frame]"), variant);
        },
        [VARIANTS[variantName] || {}]
    );

    const frame = page.frameLocator("[data-lab-frame]");
    try {
        await scenario.real(frame);
        return { status: "pass", error: null };
    } catch (error) {
        return { status: "fail", error: error.message };
    }
}

test.describe("the lab runner agrees with Playwright", () => {
    /**
     * A broken lab must fail loudly.
     *
     * This exists because of a specific near-miss: a stray backtick in a
     * template literal in app.js threw a SyntaxError, the module never loaded,
     * the interactive panel stayed `hidden`, and the accessibility suite went
     * green — because a hidden panel has no violations and axe was left looking
     * at the static fallback, which is genuinely fine. Every gate passed on a
     * page whose entire feature was dead. Lighthouse's console-error audit
     * caught it by luck.
     *
     * So: assert the panel is actually revealed and the app actually rendered.
     * Cheap, and it converts a silent failure into a named one.
     */
    test("the lab initialises and the demo app renders", async ({ page }) => {
        const consoleErrors = [];
        page.on("pageerror", (error) => consoleErrors.push(error.message));

        await page.goto("/lab/");

        await expect(
            page.locator("[data-lab]"),
            "The interactive panel is still hidden, so ui.js did not run. The page has silently degraded to its static fallback."
        ).toBeVisible();

        await expect(
            page.frameLocator("[data-lab-frame]").getByTestId("question"),
            "The demo app did not render into the iframe."
        ).toBeVisible();

        await expect(page.locator("[data-lab-editor]")).not.toBeEmpty();

        expect(consoleErrors, "Uncaught errors on /lab/").toEqual([]);
    });

    for (const challenge of challenges) {
        const scenario = SCENARIOS[challenge.id];

        test(`${challenge.id}: both engines report the same outcome`, async ({ page }) => {
            expect(
                scenario,
                `No parity scenario for challenge "${challenge.id}". Every challenge on /lab/ needs one, or the page's claim is unbacked for it.`
            ).toBeDefined();

            const variantName = scenario.variant || challenge.runs[0];
            const source = scenario.source ?? challenge.start;

            await page.goto("/lab/");
            const mine = await runInBrowser(page, source, variantName);
            const theirs = await runInPlaywright(page, scenario, variantName);

            expect(
                mine.status,
                `The lab runner said "${mine.status}" for ${challenge.id}.\n  Its error: ${mine.error}`
            ).toBe(scenario.expected);

            expect(
                theirs.status,
                `Playwright said "${theirs.status}" for ${challenge.id}.\n  Its error: ${theirs.error}`
            ).toBe(scenario.expected);

            expect(
                mine.status,
                `Divergence on ${challenge.id}: the lab runner said "${mine.status}", Playwright said "${theirs.status}". The claim on /lab/ that they share semantics is now false.`
            ).toBe(theirs.status);
        });
    }

    /**
     * The auto-wait challenge only teaches anything if its starting code is
     * genuinely unreliable. If the flaky variant's delay ever got short enough
     * that a 200ms sleep always worked, the lesson would quietly become a lie
     * and every visitor would "solve" it by pressing Run.
     */
    test("the auto-wait challenge starts from genuinely flaky code", async ({ page }) => {
        await page.goto("/lab/");
        const start = challenges.find((c) => c.id === "auto-wait").start;

        const results = [];
        for (let i = 0; i < 8; i += 1) {
            results.push((await runInBrowser(page, start, "flaky")).status);
        }

        expect(
            results.filter((r) => r === "fail").length,
            `The starting code for auto-wait passed all 8 runs (${results.join(", ")}). It is supposed to be unreliable — the challenge asks the reader to remove a sleep that does not work, so if the sleep works the challenge teaches nothing.`
        ).toBeGreaterThan(0);
    });

    /**
     * Every challenge has to be solvable by the answer its own hint gives.
     *
     * This is the check I most wanted, because the failure it prevents is
     * silent and humiliating: a visitor follows the hint, the challenge does
     * not go green, and the page has taught them that the author never tried
     * it. The solutions below are what the hints describe, in the reader's
     * words rather than a special-cased string.
     *
     * `missing-name` is absent on purpose — it is solved by failing, which the
     * parity scenario above already asserts.
     */
    const SOLUTIONS = {
        "first-test":
            "await page.getByTestId('approve').click();\n" +
            "await expect(page.getByTestId('status')).toHaveText('approved 1');",

        "auto-wait": "await expect(page.getByTestId('answer')).toContainText('anomaly scan');",

        "resilient-locator":
            "await page.getByTestId('approve').click();\n" +
            "await expect(page.getByTestId('status')).toContainText('approved');",

        "strict-mode": "await expect(page.getByTestId('faithfulness')).toHaveText('0.82');",

        "negative-assertion":
            "await expect(page.getByTestId('spinner')).toBeVisible();\n" +
            "await expect(page.getByTestId('spinner')).not.toBeVisible();"
    };

    for (const [id, solution] of Object.entries(SOLUTIONS)) {
        const challenge = challenges.find((c) => c.id === id);

        test(`${id}: the answer in the hint actually solves it`, async ({ page }) => {
            await page.goto("/lab/");

            // Every variant the challenge runs against, exactly as the UI does
            // it — a solution that passes one flaky run and fails the next has
            // not solved anything.
            for (const variant of challenge.runs) {
                const result = await runInBrowser(page, solution, variant);
                expect(
                    result.status,
                    `The documented answer to "${id}" failed against the ${variant} app.\n  ${result.error}`
                ).toBe("pass");
            }
        });
    }

    /**
     * Auto-waiting is the single behaviour the whole page rests on. Asserted
     * directly rather than only through the challenges, so a regression that
     * turned every locator into a one-shot query cannot hide behind a
     * scenario that happens to be fast enough.
     */
    test("locators retry rather than resolving once", async ({ page }) => {
        await page.goto("/lab/");

        const result = await page.evaluate(async () => {
            const { runTest } = await import("/js/lab/runner.js");
            const frame = document.querySelector("[data-lab-frame]");

            // The approve button is disabled and the answer is a placeholder
            // for the first 120ms. A one-shot locator sees the placeholder.
            const run = await runTest(
                "await expect(page.getByTestId('answer')).toContainText('anomaly scan');",
                frame,
                { flaky: true }
            );
            return { status: run.status, ms: run.steps[0] ? run.steps[0].ms : 0 };
        });

        expect(result.status).toBe("pass");
        expect(
            result.ms,
            "The assertion returned instantly, which means it read the loaded state rather than waiting for it. Auto-waiting is not being exercised and the parity claim is untested."
        ).toBeGreaterThan(50);
    });
});
