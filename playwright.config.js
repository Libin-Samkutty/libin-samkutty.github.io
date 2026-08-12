import { defineConfig, devices } from "@playwright/test";

const PORT = 8081;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
    testDir: "./tests",
    // These tests read a directory of static files. Nothing they do is order-
    // dependent, so full parallelism is safe and keeps the gate under a minute.
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: 0,
    reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

    use: {
        baseURL,
        trace: "retain-on-failure"
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
            // Only the accessibility suite runs twice. The others assert properties
            // of the built files, which do not change with viewport, so running
            // them again would double the gate's runtime and prove nothing.
            name: "mobile",
            testMatch: /a11y\.spec\.js/,
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
