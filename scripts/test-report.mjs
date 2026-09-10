/**
 * Reduces a Playwright JSON report into the record /tests/ renders, and appends
 * it to the run history that page draws its trend from.
 *
 * Two reasons this is a reducer rather than the raw report. The report is
 * megabytes of config, snapshot paths and error contexts, none of which belongs
 * in a git history or a page. And the raw shape is Playwright's, which is free
 * to change between minor versions — pinning the page to a shape this script
 * owns means a Playwright upgrade breaks one file rather than a route.
 *
 * On the chicken-and-egg: the build needs the record and the suite needs the
 * build, so it resolves in one direction only. The page describes the *previous*
 * run and says so. That is what a CI dashboard does anyway, and it means the
 * site builds from a clean checkout with no network and no ordering trick.
 *
 *   npx playwright test        # writes test-results/report.json
 *   npm run test:report        # updates src/_data/testRuns.json
 *
 * The file it writes is committed by a person, never pushed by a workflow. A
 * workflow that commits to main on every deploy triggers itself, needs write
 * permission the job does not have, and turns a published figure into something
 * nobody chose to publish. Same reasoning as the visual baselines: the machine
 * produces it, a person accepts it.
 *
 * Three refusals are built in, because the specific ways a page like this goes
 * quietly wrong are all cheap to catch here:
 *
 *   - a partial run would publish "7 tests" for a suite of six hundred
 *   - a spec file with no recorded purpose would publish a row a reader has to
 *     guess at
 *   - a run whose totals do not add up means this script has drifted from
 *     Playwright's shape, and silently publishing the drift is worse than
 *     stopping
 *
 * What it does *not* refuse is a locally-generated record, because iterating on
 * the page needs one. `source` records where it came from and
 * tests/test-report.spec.js refuses to let a local one reach the site.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { firstDisclosureMatch } from "../tests/helpers/disclosure.mjs";
import { contentPages, indexablePages, pages } from "../tests/helpers/routes.mjs";

const SOURCE = fileURLToPath(new URL("../test-results/report.json", import.meta.url));
const TARGET = fileURLToPath(new URL("../src/_data/testRuns.json", import.meta.url));

/**
 * Below this, the run was a subset — someone testing one spec file — and
 * publishing it would understate the gate by two orders of magnitude. The
 * number is deliberately far below the real total so that adding tests never
 * trips it; it exists to catch `playwright test one.spec.js`, not to track size.
 *
 * Stamped into the record it writes, so tests/test-report.spec.js can assert
 * against this floor without importing this module and running it.
 */
const MINIMUM_TESTS = 200;

/** How many runs the trend keeps. Twenty fits a chart without a scrollbar and
 *  keeps the committed file small enough that its diff stays readable. */
const HISTORY_LIMIT = 20;

/** How many rows the slowest-tests table gets. */
const SLOWEST_COUNT = 10;

/** What each spec file is for, in a sentence. Prose belongs here, not in a page
 *  template, so the page stays a rendering of data. */
const PURPOSE = {
    "a11y.spec.js":
        "axe-core over every page in both themes, on desktop and a Pixel 7, plus the keyboard and focus behaviour a scanner cannot see.",
    "content-consistency.spec.js":
        "Reads the built HTML and the withheld résumé PDF against the disclosure denylist and the list of retired numbers.",
    "html-quality.spec.js":
        "Byte-level and structural checks: no BOM, unique titles and descriptions, one h1, no heading skips, every image dimensioned.",
    "links.spec.js":
        "Every root-relative link and every fragment resolves to something that exists on disk.",
    "sitemap.spec.js":
        "The sitemap lists every indexable page, no assets, no noindex pages, and stays sorted.",
    "test-report.spec.js":
        "Guards this page's own record: that it came from a runner, that it is green, and that its detail and its trend describe the same run.",
    "urls.spec.js":
        "Every legacy URL still resolves, and every redirect stub is a real 200 with a canonical and a working link.",
    "visual.spec.js":
        "Full-page screenshots of the styleguide and four sample routes, in both themes, at two viewports."
};

function fail(...lines) {
    for (const line of lines) console.error(`[report] ${line}`);
    process.exit(1);
}

if (!existsSync(SOURCE)) {
    fail(
        "No run to read at test-results/report.json.",
        "Run `npx playwright test` first — and without --reporter, which overrides the JSON reporter in playwright.config.js."
    );
}

const raw = JSON.parse(readFileSync(SOURCE, "utf8"));

/** Playwright nests suites by file and then by describe block. */
function* walk(suites, file = null) {
    for (const suite of suites ?? []) {
        const currentFile = suite.file ?? file;
        for (const spec of suite.specs ?? []) {
            yield { spec, file: spec.file ?? currentFile };
        }
        yield* walk(suite.suites, currentFile);
    }
}

/**
 * `test.status` is the outcome relative to what was expected, which is the field
 * that already accounts for `test.fail()` annotations. Reading the last result's
 * raw status instead would count a deliberate expected-failure as a failure.
 */
const OUTCOME = { expected: "passed", unexpected: "failed", skipped: "skipped", flaky: "flaky" };

/** Playwright's error text carries ANSI colour and a stack. The page shows the
 *  message, so keep the first useful lines and drop the rest. */
function readableError(result) {
    const raw = result?.errors?.[0]?.message ?? result?.error?.message ?? "";
    return (
        raw
            // eslint-disable-next-line no-control-regex
            .replace(/\[[\d;]*m/g, "")
            .split("\n")
            .filter((line) => line.trim() && !/^\s*at\s/.test(line))
            .slice(0, 4)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 300) || "No message recorded."
    );
}

const files = new Map();
const durations = [];
const failures = [];
const counts = { total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 };
let axeRuns = 0;

for (const { spec, file } of walk(raw.suites)) {
    // One spec can run in several projects (desktop and mobile), and each is a
    // separate test as far as the suite is concerned.
    for (const test of spec.tests ?? []) {
        const outcome = OUTCOME[test.status] ?? "failed";
        const last = test.results?.[test.results.length - 1];
        const ms = Math.round(last?.duration ?? 0);

        counts.total += 1;
        counts[outcome] += 1;

        if (!files.has(file)) {
            files.set(file, {
                file,
                purpose: PURPOSE[file] ?? null,
                tests: 0,
                passed: 0,
                failed: 0,
                skipped: 0,
                flaky: 0,
                ms: 0,
                projects: new Set()
            });
        }
        const entry = files.get(file);
        entry.tests += 1;
        entry[outcome] += 1;
        entry.ms += ms;
        if (test.projectName) entry.projects.add(test.projectName);

        if (outcome !== "skipped") {
            durations.push({ title: spec.title, file, project: test.projectName ?? "", ms });
        }
        if (outcome === "failed") {
            failures.push({ file, title: spec.title, project: test.projectName ?? "", message: readableError(last) });
        }
        if (file === "a11y.spec.js" && /axe violations/.test(spec.title)) axeRuns += 1;
    }
}

if (counts.total < MINIMUM_TESTS) {
    fail(
        `The run holds ${counts.total} tests, below the ${MINIMUM_TESTS} floor.`,
        "That reads as a single spec file rather than the suite, and publishing it would understate the gate.",
        "Run the whole thing: `npx playwright test`."
    );
}

const missing = [...files.keys()].filter((file) => !PURPOSE[file]);
if (missing.length) {
    fail(
        `No purpose recorded for: ${missing.join(", ")}.`,
        "Add a sentence to PURPOSE in this script. /tests/ describes what each suite is for, and an unexplained row is a row a reader has to guess at."
    );
}

/**
 * Playwright reports the same run twice — once as per-test records, once as
 * `stats`. They must agree. When they do not, this script has drifted from a
 * shape it does not own, and a mismatch caught here is a mismatch that never
 * reaches the page.
 */
const stats = raw.stats ?? {};
const reported = {
    passed: (stats.expected ?? 0) + (stats.flaky ?? 0),
    failed: stats.unexpected ?? 0,
    skipped: stats.skipped ?? 0
};
const derived = { passed: counts.passed + counts.flaky, failed: counts.failed, skipped: counts.skipped };
for (const key of Object.keys(reported)) {
    if (reported[key] !== derived[key]) {
        fail(
            `Playwright's stats and its per-test records disagree on "${key}": ${reported[key]} against ${derived[key]}.`,
            "This script reads a shape Playwright owns, so a mismatch means that shape moved. Fix the reduction rather than publishing either number."
        );
    }
}

const onCI = process.env.GITHUB_ACTIONS === "true";
const runId = process.env.GITHUB_RUN_ID;
const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
const repository = process.env.GITHUB_REPOSITORY;

/**
 * On a `pull_request` event, GITHUB_SHA is a synthetic merge of the branch into
 * its base and GITHUB_REF_NAME is something like "34/merge". Neither survives
 * the PR: the commit exists on no branch and the ref is not a place. Publishing
 * them would put a SHA on the page that nobody can look up, which is worse than
 * publishing nothing.
 *
 * So on a pull request the head commit and head branch are read out of the event
 * payload instead. Both are real and both stay real. On a push, GITHUB_SHA is
 * already the commit that was pushed and needs no correction.
 */
function provenance() {
    const sha = process.env.GITHUB_SHA ?? null;
    const ref = process.env.GITHUB_REF_NAME ?? null;

    if (process.env.GITHUB_EVENT_NAME !== "pull_request") return { commit: sha, branch: ref };

    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath || !existsSync(eventPath)) return { commit: sha, branch: process.env.GITHUB_HEAD_REF ?? ref };

    try {
        const event = JSON.parse(readFileSync(eventPath, "utf8"));
        return {
            commit: event.pull_request?.head?.sha ?? sha,
            branch: event.pull_request?.head?.ref ?? process.env.GITHUB_HEAD_REF ?? ref
        };
    } catch {
        return { commit: sha, branch: process.env.GITHUB_HEAD_REF ?? ref };
    }
}

const { commit, branch } = provenance();

const suites = [...files.values()]
    .map(({ projects, ...rest }) => ({ ...rest, projects: [...projects].sort() }))
    .sort((a, b) => b.tests - a.tests);

const latest = {
    recordedAt: stats.startTime ?? new Date().toISOString(),
    source: onCI ? "ci" : "local",
    commit,
    commitShort: commit ? commit.slice(0, 7) : null,
    branch,
    workflow: process.env.GITHUB_WORKFLOW ?? null,
    // Whether this run is the one that published the site, or a branch check.
    // The page says different things about the two and must not guess.
    deployed: process.env.GITHUB_EVENT_NAME === "push" && branch === "main",
    runUrl: runId && repository ? `${server}/${repository}/actions/runs/${runId}` : null,
    runner: process.env.RUNNER_OS ?? null,
    playwright: raw.config?.version ?? null,
    workers: raw.config?.metadata?.actualWorkers ?? raw.config?.workers ?? null,
    projects: (raw.config?.projects ?? []).map((project) => project.name).sort(),

    durationMs: Math.round(stats.duration ?? 0),
    total: counts.total,
    passed: counts.passed + counts.flaky,
    failed: counts.failed,
    skipped: counts.skipped,

    suites,
    slowest: durations.sort((a, b) => b.ms - a.ms).slice(0, SLOWEST_COUNT),
    failures,

    // Counted from the build the run went over, not typed. `routes` is every
    // HTML file produced, which is larger than `contentPages` because redirect
    // stubs and the 404 have their own rules and are held to them separately.
    coverage: {
        routes: pages.length,
        contentPages: contentPages.length,
        indexablePages: indexablePages.length,
        axeRuns
    }
};

/**
 * Every string in this record reaches a published page, and none of it was
 * written by a person: spec names, test titles and branch names all come from
 * the run. That is a surface the disclosure denylist did not previously cover,
 * and it is not hypothetical — content-consistency.spec.js builds its own test
 * titles out of the denylist patterns, so the suite that enforces the policy
 * generates strings containing every term on it. Those tests are far too fast
 * to reach the slowest-tests table, and "too fast in practice" is not a control.
 *
 * So the check happens here, at the point data becomes publishable, and it
 * refuses rather than trimming. A record that trips this is not a formatting
 * problem to route around; it is something a person needs to look at.
 */
for (const [where, value] of [
    ["branch", latest.branch],
    ["workflow", latest.workflow],
    ...latest.suites.flatMap((suite) => [
        [`suite ${suite.file}`, suite.file],
        [`the purpose recorded for ${suite.file}`, suite.purpose]
    ]),
    ...latest.slowest.map((test, index) => [`slowest test ${index + 1} (${test.file})`, test.title]),
    ...latest.failures.map((failure, index) => [`failure ${index + 1} (${failure.file})`, `${failure.title} ${failure.message}`])
]) {
    const hit = firstDisclosureMatch(value);
    if (hit) {
        fail(
            `The record would publish something the disclosure denylist rejects — ${hit.why} — in ${where}.`,
            `Matched ${hit.pattern} against: ${String(value).slice(0, 160)}`,
            "Rename the test rather than relaxing this. /tests/ renders these strings verbatim, and the denylist applies to them the same as to any other published prose."
        );
    }
}

/** The six fields the trend draws, plus the commit that identifies the run. */
function trendEntry(run) {
    return {
        recordedAt: run.recordedAt,
        commit: run.commit,
        commitShort: run.commitShort,
        source: run.source,
        total: run.total,
        passed: run.passed,
        failed: run.failed,
        skipped: run.skipped,
        durationMs: run.durationMs
    };
}

const existing = existsSync(TARGET) ? JSON.parse(readFileSync(TARGET, "utf8")) : {};
const previous = Array.isArray(existing.history) ? existing.history : [];

// A re-run of the same commit replaces its entry rather than adding a second
// point for it. Two dots for one commit would read as two runs of a changing
// suite, which is the opposite of what the trend is for. Records with no commit
// are all local, so they collapse to one slot and never accumulate.
const history = [trendEntry(latest), ...previous.filter((run) => (run.commit ?? null) !== (latest.commit ?? null))]
    .sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt))
    .slice(0, HISTORY_LIMIT);

const record = {
    _meta: {
        purpose: "The last recorded run of this site's own Playwright suite, and the trend across recent runs. Rendered at /tests/.",
        generatedBy: "scripts/test-report.mjs, from test-results/report.json",
        note: "This describes the previous run, not a live one. A static site cannot execute its own tests on request, and the page says so rather than implying otherwise.",
        accepted:
            "Written by a machine on a runner, committed by a person. The workflows upload it as an artifact; nothing pushes it.",
        retries:
            "playwright.config.js sets retries to 0, so there is no retry data and therefore no flake rate to publish. /tests/ must not imply one.",
        history: `Newest first, at most ${HISTORY_LIMIT} runs. Only runs whose record was committed appear, so gaps are commits nobody accepted a record for.`,
        minimumTests: MINIMUM_TESTS
    },
    latest,
    history
};

writeFileSync(TARGET, `${JSON.stringify(record, null, 4)}\n`);

console.log(
    `[report] ${latest.total} tests across ${suites.length} spec files, ${latest.failed} failed, ` +
        `${(latest.durationMs / 1000).toFixed(1)}s, source ${latest.source}.`
);
console.log(`[report] History now holds ${history.length} run${history.length === 1 ? "" : "s"}. Wrote src/_data/testRuns.json.`);

if (!onCI) {
    console.log(
        "[report] Recorded as local. tests/test-report.spec.js will refuse this record, which is deliberate: " +
            "the visual suite fails on Windows against Ubuntu-generated baselines, so a local run reports failures that are font rasterisation rather than defects."
    );
}
