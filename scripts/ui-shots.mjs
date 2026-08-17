import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { contentPages } from "../tests/helpers/routes.mjs";

/**
 * Captures the built site as pictures and as geometry, for a human or an agent
 * to review the composition. This is a review tool, not a gate: nothing here
 * asserts, nothing here fails a build, and no npm script wires it in.
 *
 * Three decisions worth recording.
 *
 * It is separate from `tests/visual.spec.js` because the two answer different
 * questions. The spec asks "did the pixels change since the last baseline",
 * which says nothing about whether the pixels were right to begin with. This
 * asks "what does the page actually look like", at widths the spec does not
 * cover, and writes somewhere the spec never reads.
 *
 * It writes measurements alongside the images. "Too much whitespace" is not an
 * argument anyone can settle by looking; "the content band is 1200px inside a
 * 1920px viewport, so 37% of the screen is margin" is. Every number in
 * `measurements.json` is read off the rendered page, not computed from the CSS,
 * so a clamp or a fallback font cannot make it lie.
 *
 * It serves the directory rather than opening `file://` URLs. Every asset
 * reference in the build is root-relative, so on a file origin the stylesheet
 * and both variable fonts 404 and the screenshot is of an unstyled page that
 * looks broken for the wrong reason.
 */

// Never `tests/__screenshots__/`. Those are Playwright baselines, they are
// generated only by .github/workflows/visual-baselines.yml on the Ubuntu
// runner, and a PNG written here on Windows can never match one. Writing into
// that directory would turn a review tool into a silent baseline forge.
const OUT = fileURLToPath(new URL("../.ui-review/", import.meta.url));

// 8080 is the Eleventy dev server and 8081 is Playwright's webServer. Taking a
// third port means this can run while either of those is up.
const PORT = 8082;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const DEFAULT_WIDTHS = [390, 768, 1280, 1920];
const THEMES = ["light", "dark"];

// Tall enough that the first-screen shot is a laptop's worth of page rather
// than a strip. The full-page shot ignores this.
const VIEWPORT_HEIGHT = 900;

const args = process.argv.slice(2);
const flags = args.filter((arg) => arg.startsWith("--"));
const routeArgs = args.filter((arg) => !arg.startsWith("--"));

function flag(name) {
    return flags.find((f) => f.startsWith(`--${name}=`))?.split("=")[1];
}

const widths = flag("widths")?.split(",").map(Number) ?? DEFAULT_WIDTHS;
const themes = flag("theme") ? [flag("theme")] : THEMES;

if (widths.some((w) => !Number.isFinite(w) || w < 240)) {
    console.error(`[ui] --widths must be a comma-separated list of pixel widths. Got: ${flag("widths")}`);
    process.exit(1);
}

// Named routes win over discovery, so iterating on one page does not cost a
// full sweep. An unknown route is an error rather than an empty run, because
// silently capturing nothing looks identical to capturing something clean.
const routes = routeArgs.length
    ? routeArgs.map((wanted) => {
          const match = contentPages.find(({ url }) => url === wanted);
          if (!match) {
              console.error(`[ui] No such route: ${wanted}`);
              console.error(`[ui] Known routes: ${contentPages.map((p) => p.url).join(" ")}`);
              process.exit(1);
          }
          return match;
      })
    : contentPages;

/** `/work/contract-testing-pact/` becomes `work--contract-testing-pact`. */
function slug(url) {
    const trimmed = url.replace(/^\/|\/$/g, "");
    return trimmed === "" ? "index" : trimmed.replace(/\//g, "--").replace(/\.html$/, "");
}

/**
 * Everything measured inside the page, in one pass, because a second
 * `page.evaluate` after a layout-affecting read is a second chance for the two
 * halves to disagree.
 *
 * Characters per line is derived by measuring the advance width of a run of the
 * paragraph's own computed font in a canvas, rather than trusting the `ch` unit.
 * `ch` is the width of a zero, which in a proportional face is wider than the
 * average letter, so a 68ch column holds rather more than 68 characters of
 * English. The number that matters for readability is the one a reader's eye
 * crosses, so it is measured against a real sentence.
 */
function measure() {
    const px = (value) => Math.round(parseFloat(value) * 100) / 100;

    const typeOf = (el) => {
        if (!el) return null;
        const style = getComputedStyle(el);
        return {
            fontFamily: style.fontFamily.split(",")[0].replace(/['"]/g, ""),
            fontSize: px(style.fontSize),
            lineHeight: style.lineHeight === "normal" ? "normal" : px(style.lineHeight),
            fontWeight: style.fontWeight,
            letterSpacing: style.letterSpacing === "normal" ? 0 : px(style.letterSpacing)
        };
    };

    const box = (el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
            top: Math.round(rect.top + window.scrollY),
            left: Math.round(rect.left),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
        };
    };

    const SAMPLE = "The quick brown fox jumps over the lazy dog and keeps running until it stops. ";

    const charsPerLine = (el) => {
        if (!el) return null;
        const style = getComputedStyle(el);
        const ctx = document.createElement("canvas").getContext("2d");
        ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const perChar = ctx.measureText(SAMPLE).width / SAMPLE.length;
        if (!perChar) return null;

        // The content box, not the border box: padding is not reading width.
        const inner =
            el.getBoundingClientRect().width -
            parseFloat(style.paddingInlineStart) -
            parseFloat(style.paddingInlineEnd);
        return Math.round(inner / perChar);
    };

    const root = getComputedStyle(document.documentElement);
    const token = (name) => root.getPropertyValue(name).trim() || null;

    const wrap = document.querySelector(".wrap");
    const wrapRect = wrap?.getBoundingClientRect();

    // The widest prose paragraph on the page, because the measure problem is
    // always at the widest line and an average would hide it.
    const paragraphs = [...document.querySelectorAll("main p")].filter(
        (p) => p.textContent.trim().length > 120
    );
    const widestProse = paragraphs.sort(
        (a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width
    )[0];

    const heroTitle = document.querySelector(".hero__title");
    const heroImage = document.querySelector(".hero__portrait img");

    return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        document: { height: document.documentElement.scrollHeight },

        tokens: {
            wrapMax: token("--wrap-max"),
            measure: token("--measure"),
            gutter: token("--gutter")
        },

        // The band a reader's eye actually has to cross, and what is left over
        // on each side of it. `deadSideRatio` is the whitespace complaint,
        // stated as a number.
        band: wrapRect
            ? {
                  width: Math.round(wrapRect.width),
                  left: Math.round(wrapRect.left),
                  right: Math.round(window.innerWidth - wrapRect.right),
                  deadSideRatio:
                      Math.round(((window.innerWidth - wrapRect.width) / window.innerWidth) * 1000) / 1000
              }
            : null,

        type: {
            body: typeOf(document.body),
            h1: typeOf(document.querySelector("h1")),
            h2: typeOf(document.querySelector("main h2")),
            prose: typeOf(widestProse)
        },

        // 45 to 75 is the readability band, 60 to 70 the target. Recorded, not
        // judged: the judgement belongs in the skill, where it can be argued
        // with, not baked into the tool.
        charsPerLine: {
            widestProse: charsPerLine(widestProse),
            selector: widestProse ? widestProse.className || widestProse.tagName.toLowerCase() : null
        },

        // Homepage only. The offset between the top of the headline and the top
        // of the portrait is the vertical-alignment question, recorded so it
        // stops being an impression.
        hero: heroTitle
            ? {
                  title: box(heroTitle),
                  image: box(heroImage),
                  imageTopMinusTitleTop:
                      heroImage && heroTitle
                          ? Math.round(
                                heroImage.getBoundingClientRect().top - heroTitle.getBoundingClientRect().top
                            )
                          : null
              }
            : null
    };
}

function serve() {
    // `shell: true` on Windows: spawning `npx.cmd` directly hits Node's
    // EINVAL-on-.cmd issue, and the shell is what actually knows how to run it.
    const child = spawn(
        "npx",
        ["http-server", "_site", "-p", String(PORT), "-s", "--no-dotfiles"],
        {
            cwd: fileURLToPath(new URL("../", import.meta.url)),
            stdio: "ignore",
            shell: process.platform === "win32"
        }
    );

    return new Promise((resolve, reject) => {
        child.once("error", reject);

        const deadline = Date.now() + 20_000;
        const poll = async () => {
            try {
                await fetch(ORIGIN);
                resolve(child);
            } catch {
                if (Date.now() > deadline) {
                    child.kill();
                    reject(new Error(`http-server did not come up on ${ORIGIN} within 20s.`));
                    return;
                }
                setTimeout(poll, 150);
            }
        };
        poll();
    });
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const server = await serve();
const browser = await chromium.launch();

const measurements = {};
let shots = 0;

try {
    for (const width of widths) {
        for (const theme of themes) {
            const dir = join(OUT, String(width), theme);
            mkdirSync(dir, { recursive: true });

            const context = await browser.newContext({
                viewport: { width, height: VIEWPORT_HEIGHT },
                colorScheme: theme,
                // Same reason `visual.spec.js` does it: with motion reduced the
                // site's own machinery reveals every `[data-reveal]` element up
                // front, so nothing is captured mid-transition or missing.
                reducedMotion: "reduce",
                deviceScaleFactor: 1
            });
            const page = await context.newPage();

            for (const route of routes) {
                await page.goto(`${ORIGIN}${route.url}`, { waitUntil: "load" });
                await page.evaluate(() => document.fonts.ready);

                const name = slug(route.url);

                await page.screenshot({ path: join(dir, `${name}--fold.png`), fullPage: false });
                await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
                shots += 2;

                // Light and dark render the same boxes, so measuring twice would
                // only invite the two copies to disagree.
                if (theme === themes[0]) {
                    measurements[route.url] ??= {};
                    measurements[route.url][width] = await page.evaluate(measure);
                }
            }

            await context.close();
        }
    }
} finally {
    await browser.close();
    server.kill();
}

writeFileSync(join(OUT, "measurements.json"), `${JSON.stringify(measurements, null, 4)}\n`);

console.log(
    `[ui] Wrote ${shots} screenshots for ${routes.length} route(s) at ${widths.join(", ")} in ${themes.join(" and ")}.`
);
console.log(`[ui] Geometry in .ui-review/measurements.json. Images under .ui-review/<width>/<theme>/.`);
