/**
 * Runs a test.
 *
 * The visitor's code is compiled with `new Function` and handed exactly two
 * globals: `page` and `expect`. There is no CSP on this site, so this works;
 * the question is whether it should, and the answer is that the only code it
 * can run is code the visitor typed into their own browser, on a page with no
 * login, no cookies and nothing to steal. That is self-XSS, which is not a
 * vulnerability.
 *
 * The thing that *would* be one is a shareable URL that carries code and runs
 * it on arrival, so the lab never reads test source from the URL or the hash.
 * If that ever changes, it must still require a click.
 *
 * A test that loops forever without awaiting will hang the tab. `new Function`
 * cannot be interrupted from the outside and a Worker cannot touch the DOM, so
 * the realistic case — a bad `await` loop — is caught by the deadline inside
 * every poll, and the unrealistic one is left alone rather than solved with
 * machinery nobody needs.
 */

import { LabError, createPage } from "./locator.js";
import { expect as labExpect } from "./expect.js";
import { demoApp } from "./app.js";

/** Wall-clock cap for one run, independent of any single assertion's timeout. */
const RUN_TIMEOUT = 15000;

/**
 * Load the demo app into the frame and wait for it to parse. Every run starts
 * from a fresh document, so a test cannot pass because a previous run already
 * clicked the button.
 */
export function loadApp(frame, variant) {
    return new Promise((resolve) => {
        frame.addEventListener("load", () => resolve(frame.contentDocument), { once: true });
        frame.srcdoc = demoApp(variant);
    });
}

/**
 * Wrap `page` and `expect` so every call appends to a timeline. The step list
 * is what turns a pass into something a reader learns from: it shows that the
 * click took 4ms and the assertion took 380ms, which is auto-waiting made
 * visible.
 */
function instrument(page, steps) {
    const record = async (title, run) => {
        const started = performance.now();
        const step = { title, status: "running", ms: 0 };
        steps.push(step);
        try {
            const value = await run();
            step.status = "pass";
            return value;
        } catch (error) {
            step.status = "fail";
            step.error = error.message;
            throw error;
        } finally {
            step.ms = Math.round(performance.now() - started);
        }
    };

    const wrapLocator = (locator) =>
        new Proxy(locator, {
            get(target, prop) {
                const value = target[prop];
                if (typeof value !== "function") return value;
                if (prop === "click" || prop === "fill") {
                    return (...args) =>
                        record(`${String(prop)} ${target.description}`, () => value.apply(target, args));
                }
                return value.bind(target);
            }
        });

    const wrappedPage = {};
    for (const key of Object.keys(page)) {
        wrappedPage[key] =
            key === "waitForTimeout"
                ? (ms) => record(`waitForTimeout(${ms})`, () => page.waitForTimeout(ms))
                : (...args) => wrapLocator(page[key](...args));
    }

    // `target` is the wrapping Proxy, not the raw Locator, and that is fine:
    // the Proxy forwards `all()` and `description`, which is all the assertions
    // read. Unwrapping it would only mean the step titles lost their names.
    const wrappedExpect = (target) => {
        const build = (assertion, negated) =>
            new Proxy(assertion, {
                get(a, prop) {
                    if (prop === "not") return build(a.not, true);
                    const value = a[prop];
                    if (typeof value !== "function") return value;
                    return (...args) =>
                        record(
                            `expect(${target.description})${negated ? ".not" : ""}.${String(prop)}(${
                                args[0] === undefined ? "" : JSON.stringify(String(args[0]))
                            })`,
                            () => value.apply(a, args)
                        );
                }
            });
        return build(labExpect(target), false);
    };

    return { page: wrappedPage, expect: wrappedExpect };
}

/**
 * @returns {{status: "pass"|"fail", steps: Array, error?: string, ms: number}}
 */
export async function runTest(source, frame, variant) {
    const steps = [];
    const started = performance.now();

    let doc;
    try {
        doc = await loadApp(frame, variant);
    } catch (error) {
        return { status: "fail", steps, error: `The demo app failed to load: ${error.message}`, ms: 0 };
    }

    const page = createPage(() => frame.contentDocument || doc);
    const instrumented = instrument(page, steps);

    let body;
    try {
        // Async so the visitor can use await, which every example does.
        body = new Function(
            "page",
            "expect",
            `"use strict"; return (async () => {\n${source}\n})();`
        );
    } catch (error) {
        return {
            status: "fail",
            steps,
            error: `Syntax error: ${error.message}`,
            ms: Math.round(performance.now() - started)
        };
    }

    try {
        await Promise.race([
            body(instrumented.page, instrumented.expect),
            new Promise((_, reject) =>
                setTimeout(
                    () => reject(new LabError(`The test did not finish within ${RUN_TIMEOUT}ms.`)),
                    RUN_TIMEOUT
                )
            )
        ]);
        return { status: "pass", steps, ms: Math.round(performance.now() - started) };
    } catch (error) {
        return {
            status: "fail",
            steps,
            error: error.message,
            ms: Math.round(performance.now() - started)
        };
    }
}
