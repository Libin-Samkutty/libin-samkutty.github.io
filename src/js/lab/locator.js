/**
 * Locators, with the auto-waiting semantics Playwright's have.
 *
 * A locator here is a description of how to find an element, not the element
 * itself. Nothing is queried until an action or an assertion asks for it, and
 * when one does it re-queries and keeps re-querying until the element turns up
 * or the deadline passes. That is the whole reason Playwright tests do not need
 * sleeps, and reproducing it faithfully is the point of this file — a resolver
 * that queried once at construction would make every lesson in /lab/ a lie.
 *
 * `tests/lab-parity.spec.js` runs the same scenarios through real Playwright
 * and asserts the same outcomes, so a divergence here fails CI.
 */

export const TIMEOUT = 5000;
const POLL = 50;

/** Roles this resolves. Deliberately a short list — see the note in ui.js. */
const ROLE_SELECTORS = {
    button: 'button, [role="button"], input[type="button"], input[type="submit"]',
    link: "a[href], [role=\"link\"]",
    heading: 'h1, h2, h3, h4, h5, h6, [role="heading"]',
    textbox: 'input:not([type]), input[type="text"], input[type="search"], input[type="email"], textarea, [role="textbox"]',
    checkbox: 'input[type="checkbox"], [role="checkbox"]',
    status: '[role="status"], output',
    listitem: 'li, [role="listitem"]',
    list: 'ul, ol, [role="list"]'
};

/**
 * The accessible name, computed the shallow way: aria-label, then
 * aria-labelledby, then the element's own text, then a form control's
 * associated <label>, then alt or title.
 *
 * This is not the full accname algorithm and does not pretend to be. It covers
 * what the demo app and the challenges use, and — importantly for the a11y
 * challenge — it returns an empty string for a control that has no name at all,
 * which is exactly when `getByRole` should fail to find it.
 */
function accessibleName(el) {
    const label = el.getAttribute("aria-label");
    if (label) return label.trim();

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
        const names = labelledBy
            .split(/\s+/)
            .map((id) => el.ownerDocument.getElementById(id))
            .filter(Boolean)
            .map((node) => node.textContent.trim());
        if (names.length) return names.join(" ");
    }

    if (el.labels && el.labels.length) {
        const text = [...el.labels].map((l) => l.textContent.trim()).join(" ").trim();
        if (text) return text;
    }

    const text = (el.textContent || "").trim();
    if (text) return text;

    return (el.getAttribute("alt") || el.getAttribute("title") || "").trim();
}

/**
 * Playwright's default text matching: case-insensitive, whitespace-normalised,
 * and substring rather than equality unless `exact` is set. Getting this wrong
 * in either direction is the most common way a hand-rolled locator diverges
 * from the real one.
 */
function matchesText(actual, expected, exact) {
    const a = (actual || "").replace(/\s+/g, " ").trim();

    if (expected instanceof RegExp) return expected.test(a);

    const b = String(expected).replace(/\s+/g, " ").trim();
    return exact ? a === b : a.toLowerCase().includes(b.toLowerCase());
}

/**
 * Visibility, matching Playwright's definition rather than the intuitive one:
 * an element is visible when it has a non-empty bounding box and is not
 * `visibility: hidden`. An element can be fully transparent and still be
 * visible by this rule, which is deliberate on their side and copied here.
 */
/**
 * Enabled, in the sense actionability means it: neither natively disabled nor
 * marked `aria-disabled`. Both count, because a div styled as a button and
 * marked aria-disabled is unusable to a screen reader user in exactly the way
 * the attribute claims, and a test that clicked it anyway would be lying.
 */
export function isEnabled(el) {
    if (el.disabled) return false;
    if (el.getAttribute("aria-disabled") === "true") return false;
    return true;
}

export function isVisible(el) {
    if (!el.isConnected) return false;
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

export class Locator {
    /**
     * @param {() => Document} getDoc  Re-read each time, because the demo app
     *   can replace its own document and a captured reference would go stale.
     * @param {object} query           How to find it.
     * @param {string} description     What to call it in an error message.
     */
    constructor(getDoc, query, description) {
        this.getDoc = getDoc;
        this.query = query;
        this.description = description;
    }

    /** Every candidate right now, without waiting. */
    all() {
        const doc = this.getDoc();
        if (!doc) return [];

        const { kind, role, text, exact, testId, selector } = this.query;

        if (kind === "testId") {
            return [...doc.querySelectorAll(`[data-testid="${CSS.escape(testId)}"]`)];
        }

        if (kind === "selector") {
            return [...doc.querySelectorAll(selector)];
        }

        if (kind === "role") {
            const candidates = [...doc.querySelectorAll(ROLE_SELECTORS[role] || role)];
            if (text === undefined) return candidates;
            return candidates.filter((el) => matchesText(accessibleName(el), text, exact));
        }

        if (kind === "label") {
            return [...doc.querySelectorAll("input, textarea, select")].filter((el) =>
                matchesText(accessibleName(el), text, exact)
            );
        }

        if (kind === "text") {
            // Leaf-most match only. Without this every ancestor up to <body>
            // "contains" the text and the count is meaningless.
            return [...doc.querySelectorAll("*")].filter(
                (el) =>
                    matchesText(el.textContent, text, exact) &&
                    ![...el.children].some((child) => matchesText(child.textContent, text, exact))
            );
        }

        return [];
    }

    count() {
        return this.all().length;
    }

    /**
     * Wait until exactly one element matches and, when asked, until it is
     * visible and enabled. Resolving to the first of several is how a locator
     * quietly starts testing the wrong element, so a strict-mode violation is
     * an error here just as it is in Playwright.
     *
     * `enabled` is the actionability check, and it is not optional decoration.
     * Without it `click()` resolved the demo app's approve button the instant
     * it appeared — visible, but still disabled while the review loaded — and
     * clicked it to no effect, so the test failed on an assertion two lines
     * later with no hint as to why. `tests/lab-parity.spec.js` caught exactly
     * that: real Playwright waited for the button to become enabled and passed,
     * this runner did not and failed. That divergence is the whole reason the
     * parity suite exists.
     */
    async resolve({ visible = true, enabled = false, timeout = TIMEOUT } = {}) {
        const deadline = Date.now() + timeout;
        let last = "not found";

        for (;;) {
            const found = this.all();

            if (found.length > 1) {
                throw new LabError(
                    `strict mode violation: ${this.description} resolved to ${found.length} elements`
                );
            }

            if (found.length === 1) {
                const el = found[0];
                if (visible && !isVisible(el)) {
                    last = "found, but not visible";
                } else if (enabled && !isEnabled(el)) {
                    last = "found and visible, but not enabled";
                } else {
                    return el;
                }
            }

            if (Date.now() >= deadline) {
                throw new LabError(
                    `Timeout ${timeout}ms exceeded waiting for ${this.description}\n  ${last}`
                );
            }

            await sleep(POLL);
        }
    }

    async click(options) {
        const el = await this.resolve({ enabled: true, ...options });
        el.click();
        // One frame, so a handler that re-renders has finished before the next
        // step queries the DOM. Without it a test can read the state it was
        // about to change.
        await frame(el.ownerDocument.defaultView);
    }

    async fill(value, options) {
        const el = await this.resolve({ enabled: true, ...options });
        el.focus();
        el.value = value;
        el.dispatchEvent(new el.ownerDocument.defaultView.Event("input", { bubbles: true }));
        el.dispatchEvent(new el.ownerDocument.defaultView.Event("change", { bubbles: true }));
        await frame(el.ownerDocument.defaultView);
    }

    async textContent(options) {
        return (await this.resolve(options)).textContent;
    }

    async isVisible() {
        const found = this.all();
        return found.length === 1 && isVisible(found[0]);
    }
}

/** Thrown for every expected failure, so the runner can tell one from a bug. */
export class LabError extends Error {
    constructor(message) {
        super(message);
        this.name = "LabError";
    }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const frame = (win) =>
    new Promise((resolve) => (win.requestAnimationFrame || setTimeout)(() => resolve()));

/** The `page` object handed to a test. */
export function createPage(getDoc) {
    const make = (query, description) => new Locator(getDoc, query, description);

    return {
        getByRole: (role, { name, exact = false } = {}) =>
            make(
                { kind: "role", role, text: name, exact },
                `getByRole(${JSON.stringify(role)}${name === undefined ? "" : `, { name: ${JSON.stringify(String(name))} }`})`
            ),

        getByLabel: (text, { exact = false } = {}) =>
            make({ kind: "label", text, exact }, `getByLabel(${JSON.stringify(String(text))})`),

        getByText: (text, { exact = false } = {}) =>
            make({ kind: "text", text, exact }, `getByText(${JSON.stringify(String(text))})`),

        getByTestId: (testId) =>
            make({ kind: "testId", testId }, `getByTestId(${JSON.stringify(testId)})`),

        locator: (selector) => make({ kind: "selector", selector }, `locator(${JSON.stringify(selector)})`),

        /**
         * Present, and deliberately awkward to reach for. It is what the
         * flake challenge asks you to delete.
         */
        waitForTimeout: (ms) => sleep(ms)
    };
}
