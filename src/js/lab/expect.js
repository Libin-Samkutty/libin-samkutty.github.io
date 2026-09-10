/**
 * Web-first assertions.
 *
 * Every assertion here retries until it passes or the deadline expires, which
 * is the half of Playwright people notice least and rely on most: `expect(x)
 * .toHaveText("done")` is not a comparison, it is a wait with a comparison
 * attached. An assertion that compared once and threw would make the flake
 * challenge unpassable by the correct answer and passable by a sleep, which is
 * precisely backwards.
 *
 * Error text is shaped like Playwright's, because reading a real failure is a
 * skill and a toy failure teaches nothing.
 */

import { LabError, TIMEOUT, isVisible, sleep } from "./locator.js";

const POLL = 50;

function normalise(text) {
    return (text || "").replace(/\s+/g, " ").trim();
}

function describe(value) {
    return value instanceof RegExp ? String(value) : JSON.stringify(String(value));
}

/**
 * Poll `check` until it reports a pass, then return. On timeout, throw with
 * the last actual value seen rather than the first — the last one is the state
 * the reader will find when they go and look.
 */
async function until(check, { matcher, locator, expected, timeout, negated }) {
    const deadline = Date.now() + timeout;
    let actual;

    for (;;) {
        let passed;
        try {
            const result = check();
            passed = result.passed;
            actual = result.actual;
        } catch (error) {
            if (error instanceof LabError) {
                passed = false;
                actual = error.message.split("\n")[0];
            } else {
                throw error;
            }
        }

        if (passed !== negated) return;

        if (Date.now() >= deadline) {
            throw new LabError(
                `Timed out ${timeout}ms waiting for expect(${locator.description})${negated ? ".not" : ""}.${matcher}(${expected === undefined ? "" : describe(expected)})\n` +
                    `  Expected: ${negated ? "not " : ""}${expected === undefined ? matcher : describe(expected)}\n` +
                    `  Received: ${actual === undefined ? "<element not found>" : describe(actual)}`
            );
        }

        await sleep(POLL);
    }
}

function build(locator, negated) {
    const one = () => {
        const found = locator.all();
        if (found.length > 1) {
            throw new LabError(
                `strict mode violation: ${locator.description} resolved to ${found.length} elements`
            );
        }
        return found[0];
    };

    return {
        get not() {
            return build(locator, !negated);
        },

        toBeVisible: ({ timeout = TIMEOUT } = {}) =>
            until(
                () => {
                    const el = one();
                    return { passed: Boolean(el) && isVisible(el), actual: el ? "hidden" : undefined };
                },
                { matcher: "toBeVisible", locator, timeout, negated }
            ),

        toHaveText: (expected, { timeout = TIMEOUT } = {}) =>
            until(
                () => {
                    const el = one();
                    const actual = el ? normalise(el.textContent) : undefined;
                    const passed =
                        el !== undefined &&
                        (expected instanceof RegExp
                            ? expected.test(actual)
                            : actual === normalise(String(expected)));
                    return { passed, actual };
                },
                { matcher: "toHaveText", locator, expected, timeout, negated }
            ),

        /** Substring, where toHaveText is whole-string. Both exist upstream. */
        toContainText: (expected, { timeout = TIMEOUT } = {}) =>
            until(
                () => {
                    const el = one();
                    const actual = el ? normalise(el.textContent) : undefined;
                    const passed =
                        el !== undefined &&
                        (expected instanceof RegExp
                            ? expected.test(actual)
                            : actual.toLowerCase().includes(normalise(String(expected)).toLowerCase()));
                    return { passed, actual };
                },
                { matcher: "toContainText", locator, expected, timeout, negated }
            ),

        toHaveCount: (expected, { timeout = TIMEOUT } = {}) =>
            until(
                () => {
                    const actual = locator.all().length;
                    return { passed: actual === expected, actual };
                },
                { matcher: "toHaveCount", locator, expected, timeout, negated }
            ),

        toHaveValue: (expected, { timeout = TIMEOUT } = {}) =>
            until(
                () => {
                    const el = one();
                    const actual = el ? el.value : undefined;
                    const passed =
                        el !== undefined &&
                        (expected instanceof RegExp ? expected.test(actual) : actual === String(expected));
                    return { passed, actual };
                },
                { matcher: "toHaveValue", locator, expected, timeout, negated }
            ),

        toBeEnabled: ({ timeout = TIMEOUT } = {}) =>
            until(
                () => {
                    const el = one();
                    return { passed: Boolean(el) && !el.disabled, actual: el ? "disabled" : undefined };
                },
                { matcher: "toBeEnabled", locator, timeout, negated }
            ),

        toBeDisabled: ({ timeout = TIMEOUT } = {}) =>
            until(
                () => {
                    const el = one();
                    return { passed: Boolean(el) && Boolean(el.disabled), actual: el ? "enabled" : undefined };
                },
                { matcher: "toBeDisabled", locator, timeout, negated }
            )
    };
}

export function expect(locator) {
    return build(locator, false);
}
