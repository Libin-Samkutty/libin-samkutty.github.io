import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Parity between the legacy site still sitting in the repo root and the built
 * Eleventy output.
 *
 * This is the gate for deleting the legacy tree, and it exists because the
 * hand-maintained inventory in `src/_data/legacyUrls.json` can only prove that
 * the URLs *someone remembered* still resolve. This script derives the inventory
 * from the files themselves, so a page nobody remembered is still checked.
 *
 * Run it while both trees exist. Once the legacy files are deleted it has
 * nothing to compare and says so.
 *
 * Deliberately not part of the test suite: it is a one-time migration check with
 * a finite life, and a permanent gate that depends on files scheduled for
 * deletion would have to be deleted along with them.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SITE = join(ROOT, "_site");

const failures = [];
const notes = [];

function fail(message) {
    failures.push(message);
}

/* ------------------------------------------------------------------ inputs */

if (!existsSync(SITE)) {
    console.error("No _site/. Run `npm run build` first.");
    process.exit(1);
}

const legacyPages = readdirSync(ROOT).filter((entry) => entry.endsWith(".html"));

if (legacyPages.length === 0) {
    console.log("No legacy HTML in the repo root — the migration is complete and this check is spent.");
    process.exit(0);
}

function walk(dir, found = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, found);
        else found.push(full);
    }
    return found;
}

const built = walk(SITE);
const builtRelative = new Set(built.map((file) => "/" + relative(SITE, file).split(sep).join("/")));

function resolves(url) {
    const path = url.split("#")[0].split("?")[0];
    if (builtRelative.has(path)) return true;
    if (builtRelative.has(path.replace(/\/$/, "") + "/index.html")) return true;
    return false;
}

/* --------------------------------------------------- every legacy URL lives */

for (const page of legacyPages) {
    const url = `/${page}`;
    if (!resolves(url)) {
        fail(`${url} existed on the live site and no longer resolves. Add a redirect stub.`);
    }
}

/* ------------------------------------- every legacy fragment target survives */

/**
 * Fragments are the part of a URL migration that quietly breaks. A redirect that
 * lands on the right page but loses the anchor sends the reader to the top of a
 * long document with no indication that anything was missed — so every in-page
 * anchor the old site published is checked against the page its URL now
 * redirects to, not merely against the redirect resolving.
 */
const redirects = JSON.parse(readFileSync(join(ROOT, "src/_data/redirects.json"), "utf8"));
const destinationFor = new Map(redirects.map(({ from, to }) => [from, to]));

function idsIn(url) {
    const path = url.replace(/\/$/, "");
    const candidates = [join(SITE, path, "index.html"), join(SITE, path)];
    for (const candidate of candidates) {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
            const html = readFileSync(candidate, "utf8");
            return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id));
        }
    }
    return null;
}

for (const page of legacyPages) {
    const html = readFileSync(join(ROOT, page), "utf8");

    // Only same-page anchors. A cross-page fragment is covered when that page is
    // processed in its own turn.
    const anchors = [...html.matchAll(/\shref="#([^"]+)"/g)].map(([, id]) => id).filter((id) => id !== "");
    if (anchors.length === 0) continue;

    const destination = destinationFor.get(`/${page}`) ?? `/${page}`;
    const ids = idsIn(destination);

    if (ids === null) {
        fail(`/${page} redirects to ${destination}, which was not found in the build.`);
        continue;
    }

    const lost = [...new Set(anchors)].filter((id) => !ids.has(id));
    if (lost.length > 0) {
        notes.push(
            `/${page} published anchors that ${destination} does not carry: ${lost.join(", ")}. ` +
                `Intentional if the section was cut; a silent dead-end if not.`
        );
    }
}

/* ------------------------------------------- assets the old pages depended on */

const legacyAssets = new Set();

for (const page of legacyPages) {
    const html = readFileSync(join(ROOT, page), "utf8");
    for (const [, reference] of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
        if (/^(?:https?:|mailto:|tel:|data:|#)/.test(reference)) continue;
        if (reference.endsWith(".html") || reference.includes(".html#")) continue;
        legacyAssets.add(reference.replace(/^\.?\//, ""));
    }
}

const droppedAssets = [...legacyAssets].filter((asset) => !resolves(`/${asset}`));

if (droppedAssets.length > 0) {
    notes.push(
        `Assets referenced by the legacy pages that the build does not publish:\n    ` +
            droppedAssets.sort().join("\n    ") +
            `\n  Expected for the old stylesheets, scripts and screenshots. Check nothing here is still wanted.`
    );
}

/* ---------------------------------------------------------------- reporting */

console.log(`Checked ${legacyPages.length} legacy pages against ${built.length} built files.\n`);

for (const note of notes) {
    console.log(`  note: ${note}\n`);
}

if (failures.length > 0) {
    console.error(`${failures.length} parity failure(s):\n`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    console.error("\nDo not delete the legacy tree until these resolve.");
    process.exit(1);
}

console.log("Parity holds. Every legacy URL resolves in the build.");
