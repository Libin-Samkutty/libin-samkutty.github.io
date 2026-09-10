import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * Guards the record /tests/ publishes.
 *
 * The reason this exists is specific. Run the suite on Windows and the visual
 * comparison fails against baselines generated on Ubuntu, because the two
 * rasterise text differently — a real and known property of this repo, which is
 * why `.github/workflows/visual-baselines.yml` exists at all. The reducer would
 * then faithfully record twenty failures that are a font difference rather than
 * a defect, and /tests/ would faithfully publish them.
 *
 * So the honest constraint is not "remember to use the CI record". It is that a
 * record which did not come from a runner cannot reach the site, asserted. Same
 * idea as `WITHHELD_BECAUSE` in content-consistency.spec.js: write the property
 * down as a test rather than trusting care.
 *
 * The assertions hold their fire while the history is empty, because the first
 * run on a branch is the one that produces the first record. That bootstrap is
 * two rounds by construction and the suite should not deadlock it.
 */

const RECORD = fileURLToPath(new URL("../src/_data/testRuns.json", import.meta.url));
const record = JSON.parse(readFileSync(RECORD, "utf8"));

test.describe("the published test record", () => {
    test("is well formed whether or not it holds a run", () => {
        expect(record._meta, "the record must carry its own provenance").toBeTruthy();
        expect(Array.isArray(record.history), "history must be an array, even when empty").toBe(true);

        // Either both are present or neither is. A detail block with no trend
        // entry, or the reverse, means the reducer wrote a partial file.
        expect(
            Boolean(record.latest) === record.history.length > 0,
            "latest and history must agree about whether a run has been recorded"
        ).toBe(true);
    });

    test.describe("once a run has been recorded", () => {
        test.skip(() => record.history.length === 0, "no record accepted yet — the first run produces one");

        test("came from a runner, not a laptop", () => {
            // The message names the fix, because the person who hits this is
            // usually mid-PR wondering why their local record is rejected.
            expect(
                record.latest.source,
                "This record was generated locally. On Windows the visual suite fails against the Ubuntu baselines, " +
                    "so a local record publishes font-rasterisation differences as defects. Take the `test-run` artifact " +
                    "from a green CI run and commit that instead."
            ).toBe("ci");

            expect(record.latest.commit, "a record with no commit cannot be traced to a run").toMatch(/^[0-9a-f]{40}$/);
            expect(record.latest.runUrl, "the page links to the run; without a URL that claim is unbacked").toContain("/actions/runs/");
        });

        test("is green, because a red run does not ship", () => {
            // Not a style preference. The record describes the run that gated
            // the deploy currently serving the site, and a red run does not
            // deploy — so a red record here means the file is from somewhere
            // other than the run it claims to describe.
            expect(record.latest.failed, "the accepted record must be from a run that passed").toBe(0);

            // Also a disclosure property, not only a tidiness one. A failure
            // entry carries Playwright's error message, and the message from a
            // content-consistency failure quotes the denylisted term it matched.
            // A green record cannot hold one — asserted here rather than left
            // to follow from the count above.
            expect(record.latest.failures, "a published record must carry no failure messages").toEqual([]);
        });

        test("holds the whole suite rather than a subset", () => {
            // The floor comes from the record rather than a second copy of the
            // number here. The reducer enforces it at write time and stamps it,
            // so this catches a hand-edited file rather than restating policy.
            expect(record.latest.total).toBeGreaterThanOrEqual(record._meta.minimumTests);
            expect(
                record.latest.passed + record.latest.failed + record.latest.skipped,
                "the outcome counts must add up to the total"
            ).toBe(record.latest.total);
        });

        test("describes the same run in its detail and in its trend", () => {
            expect(record.history[0].commit, "history[0] and latest must be the same run").toBe(record.latest.commit);
            expect(record.history[0].total).toBe(record.latest.total);
            expect(record.history[0].failed).toBe(record.latest.failed);
        });

        test("explains every suite it lists", () => {
            const unexplained = record.latest.suites.filter((suite) => !suite.purpose).map((suite) => suite.file);
            expect(unexplained, "a row a reader has to guess at is worse than no row").toEqual([]);
        });

        test("keeps its history newest-first and traceable", () => {
            const times = record.history.map((run) => new Date(run.recordedAt).getTime());
            expect(times, "the trend draws left to right from this order").toEqual([...times].sort((a, b) => b - a));

            const commits = record.history.map((run) => run.commit);
            expect(commits.filter(Boolean), "every point on the trend must name its commit").toHaveLength(commits.length);
            expect(new Set(commits).size, "one commit, one point — a re-run replaces rather than adds").toBe(commits.length);
        });
    });
});
