import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SITE_DIR = new URL("../../_site/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

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

const files = walk(SITE_DIR);

export const pages = files.map((file) => {
    const rel = relative(SITE_DIR, file).split(sep).join("/");
    const url = rel === "index.html" ? "/" : rel.endsWith("/index.html") ? `/${rel.slice(0, -"index.html".length)}` : `/${rel}`;
    return { file, url, html: readFileSync(file, "utf8") };
});

/** Real content pages: excludes redirect stubs and the 404, which have their own rules. */
export const contentPages = pages.filter(
    (page) => !page.html.includes('http-equiv="refresh"') && page.url !== "/404.html"
);

export const redirectStubs = pages.filter((page) => page.html.includes('http-equiv="refresh"'));

export function siteDir() {
    return SITE_DIR;
}
