import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { contentPages, pages, siteDir } from "./helpers/routes.mjs";

/**
 * Internal links and asset references only.
 *
 * External links are deliberately not checked here. Rate limiting and transient
 * outages on someone else's server would make every deploy flaky, and a flaky
 * gate gets ignored, which costs more than the broken link it was meant to
 * catch. They belong in a scheduled workflow that reports rather than blocks.
 */


const root = siteDir();
const knownUrls = new Set(pages.map(({ url }) => url));
const fragmentsByUrl = new Map(
    pages.map(({ url, html }) => [url, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]))])
);

function resolvesOnDisk(path) {
    if (knownUrls.has(path)) return true;
    if (existsSync(join(root, path.replace(/^\//, "")))) return true;
    if (existsSync(join(root, path.replace(/^\//, ""), "index.html"))) return true;
    return false;
}

for (const { url, html } of pages) {
    test(`${url} has no broken internal references`, () => {
        const broken = [];

        const references = [
            ...[...html.matchAll(/\shref="([^"]+)"/g)].map((match) => match[1]),
            ...[...html.matchAll(/\ssrc="([^"]+)"/g)].map((match) => match[1])
        ];

        for (const reference of references) {
            if (/^(?:https?:|mailto:|tel:|data:|#)/.test(reference)) continue;
            if (!reference.startsWith("/")) continue;

            const [path, fragment] = reference.split("#");
            if (!resolvesOnDisk(path)) {
                broken.push(`${reference} (no such file)`);
                continue;
            }
            if (fragment && fragmentsByUrl.has(path) && !fragmentsByUrl.get(path).has(fragment)) {
                broken.push(`${reference} (no element with id="${fragment}")`);
            }
        }

        expect(broken, `${url} links to: ${broken.join(", ")}`).toEqual([]);
    });

    test(`${url} has no broken same-page fragments`, () => {
        const ids = fragmentsByUrl.get(url) ?? new Set();
        const broken = [...html.matchAll(/\shref="#([^"]+)"/g)]
            .map((match) => match[1])
            .filter((fragment) => !ids.has(fragment));

        expect(broken, `${url} links to missing anchors: ${broken.join(", ")}`).toEqual([]);
    });
}

/**
 * Social cards, over real pages only.
 *
 * This is not covered by the reference check above, because a meta URL sits in
 * `content=` rather than `href=`/`src=`. Every card on the site 404'd for a
 * while for exactly that reason: the path was well-formed, the file was in an
 * unpublished source directory, and nothing looked at it. A card is fetched by a
 * crawler and never by the reader, so a broken one stays silent until the day
 * someone shares the link.
 *
 * Redirect stubs are excluded because they are `noindex` bounce pages. A stub
 * that rendered a rich card would be competing with the page it points at.
 */
for (const { url, html } of contentPages) {
    test(`${url} declares an og:image that exists`, () => {
        const declared = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
        expect(declared, `${url} declares no og:image`).toBeTruthy();

        const path = declared.replace(/^https?:\/\/[^/]+/, "");
        expect(resolvesOnDisk(path), `${url} points og:image at ${path}, which does not exist`).toBe(true);
    });
}
