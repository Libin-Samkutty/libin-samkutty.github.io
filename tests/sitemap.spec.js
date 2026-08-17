import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { contentPages, indexablePages, redirectStubs, siteDir } from "./helpers/routes.mjs";

/**
 * The sitemap has to name exactly the indexable pages — no more, no fewer.
 *
 * It was doing neither. Registering CSS as a template format so Lightning CSS
 * could bundle it also put all nine stylesheets into `collections.all`, and the
 * sitemap listed every one of them; eight are never written to disk, so the file
 * was advertising eight URLs that 404. Nothing caught it because a sitemap is
 * read by crawlers and never by a person, and because it was still well-formed
 * XML with plausible-looking URLs in it.
 */

const root = siteDir();
const sitemap = readFileSync(join(root, "sitemap.xml"), "utf8");
const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) =>
    url.replace(/^https?:\/\/[^/]+/, "")
);

test("every URL in the sitemap resolves to a file", () => {
    const missing = listed.filter((url) => {
        const path = url.replace(/^\//, "");
        return !existsSync(join(root, path)) && !existsSync(join(root, path, "index.html"));
    });

    expect(missing, `sitemap advertises URLs that do not exist: ${missing.join(", ")}`).toEqual([]);
});

test("the sitemap lists only HTML pages", () => {
    const nonPages = listed.filter((url) => /\.(css|js|json|xml|txt|png|jpe?g|svg|woff2?|pdf)$/i.test(url));
    expect(nonPages, `assets in the sitemap: ${nonPages.join(", ")}`).toEqual([]);
});

test("every indexable content page is in the sitemap", () => {
    // `indexablePages` rather than `contentPages`: a page carrying `noindex` is
    // opting out on purpose, and requiring it in the sitemap would mean handing a
    // crawler two contradictory instructions about the same URL — the same defect
    // the redirect-stub test below exists to prevent. The styleguide is the first
    // page to exercise this.
    const absent = indexablePages.map(({ url }) => url).filter((url) => !listed.includes(url));

    expect(absent, `pages missing from the sitemap: ${absent.join(", ")}`).toEqual([]);
});

test("no noindex page is in the sitemap", () => {
    const contradictory = contentPages
        .filter((page) => !indexablePages.includes(page))
        .map(({ url }) => url)
        .filter((url) => listed.includes(url));

    expect(contradictory, `noindex pages advertised in the sitemap: ${contradictory.join(", ")}`).toEqual([]);
});

test("no redirect stub is in the sitemap", () => {
    // A stub carries noindex. Listing it in a sitemap gives a crawler two
    // contradictory instructions about the same URL.
    const stubs = redirectStubs.map(({ url }) => url).filter((url) => listed.includes(url));
    expect(stubs, `noindex redirect stubs in the sitemap: ${stubs.join(", ")}`).toEqual([]);
});

test("the sitemap has no duplicate entries", () => {
    const seen = new Set();
    const duplicates = listed.filter((url) => (seen.has(url) ? true : (seen.add(url), false)));
    expect(duplicates).toEqual([]);
});

test("the sitemap is sorted, so a rebuild produces no spurious diff", () => {
    expect(listed).toEqual([...listed].sort());
});
