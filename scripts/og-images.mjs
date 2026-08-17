import { chromium } from "@playwright/test";
import sharp from "sharp";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Renders one Open Graph card per content page, after the site is built.
 *
 * Two decisions worth recording.
 *
 * It runs *after* Eleventy rather than inside it, and reads the title and
 * description back out of the built HTML. That inverts the usual dependency:
 * the card cannot disagree with the page, because the page is its input. A
 * shortcode that took the same front matter would drift the first time a layout
 * started massaging the title.
 *
 * It renders in Chromium rather than compositing an SVG with sharp. The card
 * uses the site's own self-hosted variable fonts and its own tokens, so it looks
 * like the site rather than like an image that references it — and font
 * rendering does not depend on what happens to be installed on the machine.
 * A browser is already a devDependency here for the a11y suite, so this costs
 * one process, not one dependency.
 */

const SITE = fileURLToPath(new URL("../_site/", import.meta.url));
const OUT = join(SITE, "og");

const WIDTH = 1200;
const HEIGHT = 630;

function walk(dir, found = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry !== "og") walk(full, found);
        } else if (entry.endsWith(".html")) {
            found.push(full);
        }
    }
    return found;
}

function decode(value) {
    return value
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * The card's slug must match what the page already declared in its og:image, or
 * the file lands somewhere nothing points at. So it is derived from that
 * declaration rather than recomputed from the path — one source, checked by
 * `tests/links.spec.js`.
 */
function cardTarget(html) {
    const declared = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
    if (!declared) return null;
    const path = declared.replace(/^https?:\/\/[^/]+/, "");
    if (!path.startsWith("/og/")) return null;
    return path.slice("/og/".length);
}

const pages = walk(SITE)
    .map((file) => ({ file, html: readFileSync(file, "utf8") }))
    .filter(({ html }) => !html.includes('http-equiv="refresh"'))
    .map(({ file, html }) => {
        const target = cardTarget(html);
        if (!target) return null;

        const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "").replace(/\s*\|\s*Libin Samkutty$/, "");
        const description = decode(html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "");
        const kind = relative(SITE, file).split(sep)[0];

        return { target, title, description, kind };
    })
    .filter(Boolean);

if (pages.length === 0) {
    console.error("[og] No page declared an /og/ image. Did the build run?");
    process.exit(1);
}

const fontDir = pathToFileURL(join(SITE, "assets", "fonts")).href;

/**
 * The eyebrow is the one piece of text on the card that is not taken from the
 * page. It says what kind of thing the link is before the reader has clicked,
 * which is the entire job of a social card.
 */
const EYEBROWS = {
    work: "Case study",
    writing: "Writing"
};

function card({ title, description, kind }) {
    const eyebrow = EYEBROWS[kind] ?? "Libin Samkutty";

    // Long titles get a step down rather than a clamp. Truncating a headline
    // with an ellipsis in a preview card is worse than setting it smaller.
    const size = title.length > 52 ? 60 : title.length > 34 ? 72 : 84;

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
@font-face { font-family: Inter; src: url("${fontDir}/inter-var.woff2") format("woff2"); font-weight: 100 900; }
@font-face { font-family: "Source Serif"; src: url("${fontDir}/source-serif-var.woff2") format("woff2"); font-weight: 200 900; }

* { margin: 0; box-sizing: border-box; }

body {
    width: ${WIDTH}px; height: ${HEIGHT}px;
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 72px 80px;
    background: #0B0F1A;
    color: #E9EDF6;
    font-family: Inter, sans-serif;
    /* Echoes the hero: a lavender glow off the upper right, and the same 4%
       dot grid that reads as graph paper behind the portrait. */
    background-image:
        radial-gradient(760px 420px at 88% -12%, rgba(167, 139, 250, 0.20), transparent 70%),
        radial-gradient(circle at 1px 1px, rgba(233, 237, 246, 0.05) 1px, transparent 0);
    background-size: auto, 32px 32px;
}

.eyebrow {
    font-size: 24px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase;
    color: #C4B5FD;
}

h1 {
    font-family: "Source Serif", serif;
    font-size: ${size}px; font-weight: 600; line-height: 1.1; letter-spacing: -0.02em;
    max-width: 18ch;
    text-wrap: balance;
}

p {
    font-size: 27px; line-height: 1.45; color: #A9B3CA;
    max-width: 62ch;
    margin-top: 24px;
    /* Four lines is the point where the description stops supporting the
       headline and starts competing with it. */
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}

footer {
    display: flex; align-items: center; gap: 16px;
    font-size: 24px; color: #9AA5BE;
    border-top: 1px solid #252F47; padding-top: 28px;
}

footer strong { color: #E9EDF6; font-weight: 600; }
footer span { color: #5F6C88; }
</style></head>
<body>
    <p class="eyebrow">${escapeHtml(eyebrow)}</p>
    <div>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(description)}</p>
    </div>
    <footer>
        <strong>Libin Samkutty</strong><span>—</span>Senior QA Automation Engineer<span>·</span>libin-samkutty.github.io
    </footer>
</body></html>`;
}

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });

let largest = 0;

for (const entry of pages) {
    await page.setContent(card(entry), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);

    const raw = await page.screenshot({ type: "png" });

    // A screenshot straight out of Chromium is a 24-bit PNG, and the dot grid
    // gives every tile a slightly different neighbourhood, which is close to the
    // worst case for PNG's filters — the cards came out at 111 KB. The artwork
    // is flat colour, a soft gradient and text, so a 128-entry palette is
    // visually indistinguishable at the size a card is ever displayed and costs
    // about a third of that.
    // `dither: 0` matters more than the palette size here. Error-diffusion
    // scatters neighbouring palette entries through antialiased glyph edges,
    // which at this scale reads as a colour fringe on the body text — the
    // description came out tinted blue. Flat artwork wants a hard nearest-colour
    // mapping.
    const png = await sharp(raw).png({ palette: true, colors: 255, dither: 0, effort: 10 }).toBuffer();

    writeFileSync(join(OUT, entry.target), png);
    largest = Math.max(largest, png.length);
}

await browser.close();

console.log(`[og] Wrote ${pages.length} cards to _site/og/, largest ${Math.round(largest / 1024)} KB.`);

// The budget exists because a social card is fetched by a crawler on a schedule
// nobody controls, and a megabyte of PNG is a bill with no reader attached.
if (largest > 60 * 1024) {
    console.error(`[og] Largest card is ${Math.round(largest / 1024)} KB, over the 60 KB budget.`);
    process.exit(1);
}
