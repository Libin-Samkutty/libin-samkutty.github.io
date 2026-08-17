import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SITE_DIR = fileURLToPath(new URL("../../_site/", import.meta.url));

/**
 * Enumerates every HTML file the build produced and maps it back to the URL it
 * will be served at.
 *
 * Routes are discovered, never hardcoded. A page added next month is covered by
 * every suite in this directory without anyone remembering to add it — which is
 * the only version of "we test every page" that stays true.
 */
function walk(dir, found = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, found);
        else if (entry.endsWith(".html")) found.push(full);
    }
    return found;
}

// Discovery cuts both ways: if there is nothing to discover, every `for` loop in
// this directory generates zero tests and the suite reports green having asserted
// nothing. Both guards fail loudly instead, and name the fix.
if (!existsSync(SITE_DIR)) {
    throw new Error(`No build output at ${SITE_DIR}. Run \`npm run build\` first.`);
}

const files = walk(SITE_DIR);

export const pages = files.map((file) => {
    const rel = relative(SITE_DIR, file).split(sep).join("/");
    const url = rel === "index.html" ? "/" : rel.endsWith("/index.html") ? `/${rel.slice(0, -"index.html".length)}` : `/${rel}`;
    return { file, url, html: readFileSync(file, "utf8") };
});

if (!pages.length) {
    throw new Error(`${SITE_DIR} contains no HTML. Run \`npm run build\` first.`);
}

/** Real content pages: excludes redirect stubs and the 404, which have their own rules. */
export const contentPages = pages.filter(
    (page) => !page.html.includes('http-equiv="refresh"') && page.url !== "/404.html"
);

export const redirectStubs = pages.filter((page) => page.html.includes('http-equiv="refresh"'));

/**
 * Content pages a crawler is meant to index — the set the sitemap must name
 * exactly. Mirrors the `noindex` half of the filter in `src/sitemap.njk`, so a
 * page that deliberately opts out (the styleguide) is not also required to be
 * listed. It stays in `contentPages`, because axe and the HTML gates should still
 * hold it to the same standard as anything else that ships.
 */
export const indexablePages = contentPages.filter(
    (page) => !/<meta name="robots" content="noindex/.test(page.html)
);

/**
 * A representative sample, for the handful of tests whose cost is per-page rather
 * than per-file — focusing every element on a page, or booting a JS-disabled
 * context. Running those over all ~20 routes would quadruple the gate to prove
 * almost nothing, because the components repeat; running them over `/` alone
 * missed the components that only exist on a case study.
 *
 * Derived by URL shape rather than listed, so it follows the site instead of
 * going stale. The length assertion is the point: a silently shrinking sample is
 * a gate that quietly stops covering things.
 */
const firstUnder = (prefix) => contentPages.find(({ url }) => url.startsWith(prefix) && url !== prefix);

export const sampleRoutes = [
    contentPages.find(({ url }) => url === "/"),
    firstUnder("/work/"),
    firstUnder("/writing/"),
    contentPages.find(({ url }) => url === "/resume/")
].filter(Boolean);

if (sampleRoutes.length !== 4) {
    throw new Error(
        `Expected 4 sample routes (home, a case study, a post, the résumé); found ${sampleRoutes.length}. ` +
            `A section was renamed or removed — update sampleRoutes in ${import.meta.url}.`
    );
}

export function siteDir() {
    return SITE_DIR;
}
