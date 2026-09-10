import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const PORT = 8081;
const baseURL = `http://127.0.0.1:${PORT}`;

// Checked here rather than only in helpers/routes.mjs because `webServer` starts
// before any test file is imported: with no `_site`, http-server never comes up
// and the whole run dies after 30 seconds on "Timed out waiting from
// config.webServer", which says nothing about the actual cause.
if (!existsSync("_site")) {
    throw new Error("No build output at ./_site. Run `npm run build` before the e2e suite.");
}

export default defineConfig({
    testDir: "./tests",
    // These tests read a directory of static files. Nothing they do is order-
    // dependent, so full parallelism is safe and keeps the gate under a minute.
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: 0,
    /**
     * The JSON reporter is on in both modes, because /tests/ renders a real run
     * and the reducer that feeds it (scripts/test-report.mjs) needs something to
     * read whether the run happened on a laptop or on the runner. It writes a
     * file and prints nothing, so it does not compete with the human-readable
     * reporter beside it.
     */
    reporter: process.env.CI
        ? [["github"], ["html", { open: "never" }], ["json", { outputFile: "test-results/report.json" }]]
        : [["list"], ["json", { outputFile: "test-results/report.json" }]],

    use: {
        baseURL,
        trace: "retain-on-failure"
    },

    // Baselines are per project, because a Pixel 7 render and a 1440px render are
    // different pictures of the same page, not a discrepancy.
    snapshotPathTemplate: "tests/__screenshots__/{projectName}/{arg}{ext}",

    // Playwright's default is "missing": a screenshot with no baseline is written
    // and the run fails once, so the second run passes. On a Windows machine that
    // quietly mints a baseline that can never match the Ubuntu runner, and the
    // author has no reason to suspect it. "none" makes a missing baseline a plain
    // failure; the `--update-snapshots` flag still overrides it, which is what
    // .github/workflows/visual-baselines.yml uses.
    updateSnapshots: "none",

    expect: {
        // Default is 5000ms. `/styleguide/` is a single full-page shot of every
        // component on the site — over 7000px tall — and the two-consecutive-
        // stable-screenshots check that precedes any real diff needs more room on
        // a shared CI runner than it does locally. This is retry budget, not
        // comparison tolerance: `maxDiffPixels` below is unchanged.
        timeout: 15_000,
        toHaveScreenshot: {
            // `animations: "disabled"` finishes CSS transitions instead of catching
            // them mid-flight, which is the single largest source of pixel flake.
            animations: "disabled",
            // Compare in CSS pixels so a DPR difference between a local run and the
            // runner is not a diff.
            scale: "css",
            // An absolute cap, not `maxDiffPixelRatio`. Measured on this site:
            // two identical builds differ by 0 pixels, and re-pointing one colour
            // token differed by 4,853 — which a 1% ratio passes, because 1% of a
            // long full-page screenshot is tens of thousands of pixels. A ratio
            // also gets more permissive the longer the page, which is backwards.
            // 100 absorbs incidental antialiasing without hiding a component.
            maxDiffPixels: 100
        }
    },

    projects: [
        {
            name: "desktop",
            use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }
        },
        {
            // Mobile is not a nice-to-have here. The single worst accessibility bug
            // on the legacy site — a collapsed nav whose links stayed in the tab
            // order — was only reachable at a narrow viewport.
            //
            // Only the accessibility and visual suites run twice. The others assert
            // properties of the built files, which do not change with viewport, so
            // running them again would double the gate's runtime and prove nothing.
            // A screenshot is the opposite: the narrow layout is where a broken
            // grid or a collapsed nav actually shows up.
            name: "mobile",
            testMatch: /(a11y|visual)\.spec\.js/,
            use: { ...devices["Pixel 7"] }
        }
    ],

    webServer: {
        command: `npx http-server _site -p ${PORT} -s --no-dotfiles`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000
    }
});
