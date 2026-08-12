import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { contentPages, pages } from "./helpers/routes.mjs";

/**
 * Structural HTML assertions over the built output. These run against the file
 * bytes rather than a rendered page, so they are fast and they catch things a
 * browser silently repairs.
 */

test.describe.configure({ mode: "parallel" });

test("no file starts with a UTF-8 byte-order mark", () => {
    // Eleven of the thirteen legacy HTML files began with EF BB BF, almost
    // certainly from PowerShell's `>` and Out-File, which in 5.1 always write one.
    // A BOM before <!doctype puts some parsers into quirks mode.
    const offenders = pages
        .filter(({ file }) => {
            const buffer = readFileSync(file);
            return buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
        })
        .map(({ url }) => url);

    expect(offenders).toEqual([]);
});

for (const { url, html } of contentPages) {
    test.describe(url, () => {
        test("has exactly one h1 and one main", () => {
            expect((html.match(/<h1[\s>]/g) ?? []).length, "h1 count").toBe(1);
            expect((html.match(/<main[\s>]/g) ?? []).length, "main count").toBe(1);
        });

        test("declares a language", () => {
            expect(html).toMatch(/<html[^>]+lang="[a-z]{2}/);
        });

        test("has a title of at most 60 characters with the right suffix", () => {
            const title = html.match(/<title>([^<]+)<\/title>/)?.[1] ?? "";
            expect(title, "missing title").not.toBe("");
            expect(title.endsWith(" | Libin Samkutty"), `title suffix wrong: ${title}`).toBe(true);
            expect(title.length, `title too long (${title.length}): ${title}`).toBeLessThanOrEqual(60);
        });

        test("has a description between 70 and 160 characters", () => {
            const raw = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "";
            // Measured decoded. An apostrophe is one character to a reader and to a
            // search engine; `&#39;` is five, and counting the escape would reject
            // descriptions that are actually in range.
            const description = raw
                .replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">");
            expect(description, "missing description").not.toBe("");
            expect(description.length, `description length ${description.length}`).toBeGreaterThanOrEqual(70);
            expect(description.length, `description length ${description.length}`).toBeLessThanOrEqual(160);
        });

        test("has a canonical", () => {
            expect(html).toMatch(/<link rel="canonical" href="https:\/\//);
        });

        test("does not skip heading levels", () => {
            const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((match) => Number(match[1]));
            for (let index = 1; index < levels.length; index += 1) {
                const jump = levels[index] - levels[index - 1];
                expect(jump, `h${levels[index - 1]} followed by h${levels[index]}`).toBeLessThanOrEqual(1);
            }
        });

        test("every image has alt, width and height", () => {
            for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
                expect(tag, "img without alt").toMatch(/\balt=/);
                expect(tag, "img without width — this is a layout shift").toMatch(/\bwidth=/);
                expect(tag, "img without height — this is a layout shift").toMatch(/\bheight=/);
            }
        });

        test("has no inline event handler attributes", () => {
            // The legacy site navigated via onclick, which is invisible to a
            // keyboard user and to every crawler.
            expect(html).not.toMatch(/\son(click|load|error|mouseover|focus|change|submit)=/i);
        });

        test("external links that open a new tab set noopener", () => {
            for (const [tag] of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
                expect(tag, "target=_blank without noopener").toMatch(/rel="[^"]*noopener/);
            }
        });

        test("has no anchor inside a button", () => {
            // Bounded by the closing tag. An unbounded lookahead matched from a
            // button on the page to an unrelated link far below it, which made the
            // test fail on markup that was fine — a gate that cries wolf is worse
            // than no gate, because the fix is to delete it.
            const offenders = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)]
                .map(([, inner]) => inner)
                .filter((inner) => /<a\b/.test(inner));

            expect(offenders, "anchor nested inside a button").toEqual([]);
        });
    });
}

test("titles and descriptions are unique across the site", () => {
    const titles = new Map();
    const descriptions = new Map();

    for (const { url, html } of contentPages) {
        const title = html.match(/<title>([^<]+)<\/title>/)?.[1] ?? "";
        const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "";

        if (titles.has(title)) {
            throw new Error(`Duplicate title "${title}" on ${url} and ${titles.get(title)}`);
        }
        if (descriptions.has(description)) {
            throw new Error(`Duplicate description on ${url} and ${descriptions.get(description)}`);
        }
        titles.set(title, url);
        descriptions.set(description, url);
    }

    expect(titles.size).toBe(contentPages.length);
});
