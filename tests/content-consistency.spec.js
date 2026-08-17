import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pages, siteDir } from "./helpers/routes.mjs";
import { pdfText } from "../scripts/pdf-text.mjs";

const metrics = JSON.parse(
    readFileSync(new URL("../src/_data/metrics.json", import.meta.url), "utf8")
);

/**
 * Makes the disclosure policy and the superseded-numbers list properties of the
 * repository rather than things a writer has to remember.
 *
 * The old site contradicted itself — "6 countries" against "3 countries",
 * "50,000+ monthly users" against "~2M registered users" — because facts were
 * hand-copied into thirteen files. The data layer prevents that going forward.
 * This suite is the backstop for prose that bypasses it.
 */


const text = pages.map(({ url, html }) => ({
    url,
    // Strip markup and JSON-LD so a match is genuinely reader-visible.
    body: html
        .replace(/<script[\s\S]*?<\/script>/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
}));

test.describe("superseded numbers do not reappear", () => {
    for (const entry of metrics._superseded) {
        test(`"${entry.literal}" is absent from the build`, () => {
            const offenders = text
                .filter(({ body }) => body.toLowerCase().includes(entry.literal.toLowerCase()))
                .map(({ url }) => url);

            expect(
                offenders,
                `${offenders.join(", ")} still publishes "${entry.literal}". Correction on record: ${entry.correction}`
            ).toEqual([]);
        });
    }
});

/**
 * The résumé PDF is authored in Word and dropped in by hand, which makes it the
 * one document here the data layer cannot keep honest. The first version shipped
 * still saying "AI Quality Engineer" and "4+ years" months after both were wrong.
 *
 * It is currently **withheld from the build**. It lives in `src/_resume/`, which
 * no passthrough copies, rather than `src/assets/`, which is published wholesale.
 * Two things are wrong with the document itself — see WITHHELD_BECAUSE below —
 * and while it sat in `src/assets/` it was fetchable at a guessable URL on the
 * live site even though nothing linked to it. Unlinked is not unpublished.
 *
 * The scans still run, against the source. They are the gate the corrected
 * document has to clear before it goes back into `src/assets/`.
 */
const resumeSourcePath = fileURLToPath(new URL("../src/_resume/Resume.pdf", import.meta.url));
const resumePublishedPath = join(siteDir(), "assets", "Resume.pdf");
const resumeReadPath = existsSync(resumePublishedPath) ? resumePublishedPath : resumeSourcePath;
const resumePdf = existsSync(resumeReadPath) ? pdfText(readFileSync(resumeReadPath)) : null;

/**
 * Exactly why the PDF is withheld, asserted rather than written in a comment.
 *
 * Each entry is expected to STILL match, so these tests pass while the document
 * is broken and fail the moment someone fixes it — which is the signal to correct
 * this list, move the PDF back to `src/assets/`, link it from `/resume/`, and let
 * the ordinary denylist below take over. A comment would have gone stale; this
 * cannot.
 */
const WITHHELD_BECAUSE = [
    {
        pattern: /stored XSS/i,
        why: "names a vulnerability class found on a client system"
    },
    {
        pattern: /from 0% to 75%\+/i,
        why: "publishes coverage_zero_to_seventyfive, which the site suppresses",
        metricId: "coverage_zero_to_seventyfive"
    }
];

const withheldPatterns = new Set(WITHHELD_BECAUSE.map(({ pattern }) => String(pattern)));
const withheldMetricIds = new Set(WITHHELD_BECAUSE.map(({ metricId }) => metricId).filter(Boolean));

const resumeIsWithheld = !existsSync(resumePublishedPath);

const denylist = [
        { pattern: /\bAS-\d{3,}\b/, why: "internal ticket ID" },
        { pattern: /\bMSD\b/, why: "pharma partner name" },
        { pattern: /\bBayer\b/, why: "pharma partner name" },
        { pattern: /\b4\+\s*years\b/i, why: "stale experience figure; it is 4.5+" },
        { pattern: /\b2M registered\b/i, why: "unpublished metric" },
        { pattern: /47 findings/i, why: "security finding breakdown" },
        { pattern: /2 High, 7 Medium/i, why: "security finding breakdown" },
        { pattern: /shrank from 11/i, why: "client staffing detail" },
        { pattern: /stored XSS/i, why: "names a specific vulnerability class found on a client system" }
    ];

test.describe("disclosure policy", () => {
    for (const { pattern, why } of denylist) {
        test(`${pattern} does not appear (${why})`, () => {
            const offenders = text.filter(({ body }) => pattern.test(body)).map(({ url }) => url);
            expect(offenders, `${offenders.join(", ")} publishes a ${why}`).toEqual([]);
        });
    }

    test("'AI Quality Engineer' is never used as a current job title", () => {
        // It appears as a target role, which is fine. As a held title it is stale.
        const offenders = text
            .filter(({ body }) => /(?:I am|I'm|is)\s+(?:an?\s+)?AI Quality Engineer/i.test(body))
            .map(({ url }) => url);
        expect(offenders).toEqual([]);
    });
});

test.describe("the résumé PDF agrees with the site", () => {
    test("a source document exists to scan", () => {
        expect(
            resumePdf,
            `no PDF at ${resumeReadPath}. The résumé source is expected in src/_resume/ ` +
                `while it is withheld, or src/assets/ once it is republished.`
        ).not.toBeNull();
    });

    test("its text is machine-readable", () => {
        // If this fails, every assertion below is vacuously passing and the gate
        // is theatre. Better to know.
        test.skip(resumePdf === null, "no PDF to read");
        expect(resumePdf.length, "extracted no words; the scan below proves nothing").toBeGreaterThan(1000);
    });

    // The reason the document is withheld, and the trigger to republish it.
    for (const { pattern, why } of WITHHELD_BECAUSE) {
        test(`is still withheld because it ${why}`, () => {
            test.skip(!resumeIsWithheld, "the PDF is published; the denylist below governs it");
            test.skip(resumePdf === null, "no PDF to read");
            expect(
                pattern.test(resumePdf),
                `${pattern} no longer matches, so this defect looks fixed. If the document is corrected: ` +
                    `move it back to src/assets/, link it from /resume/, and delete this entry from ` +
                    `WITHHELD_BECAUSE. Do not delete the entry to make this test pass.`
            ).toBe(true);
        });
    }

    test("is not reachable on the built site while it is withheld", () => {
        test.skip(!resumeIsWithheld, "the PDF is published on purpose");
        // The gate that actually keeps the leak closed. Moving the file back into
        // src/assets/ republishes it wholesale, with no other signal.
        expect(
            existsSync(resumePublishedPath),
            `${resumePublishedPath} exists — a withheld document is being published`
        ).toBe(false);
    });

    for (const { pattern, why } of denylist) {
        test(`${pattern} does not appear in the PDF (${why})`, () => {
            test.skip(resumePdf === null, "no PDF to read");
            // Recorded as a reason for withholding rather than asserted clean, so
            // the suite is not permanently red over a document nobody can reach.
            test.skip(
                resumeIsWithheld && withheldPatterns.has(String(pattern)),
                "known defect; tracked in WITHHELD_BECAUSE"
            );
            expect(pattern.test(resumePdf), `the résumé PDF publishes a ${why}`).toBe(false);
        });
    }

    test("it carries the held job title, not the stale one", () => {
        test.skip(resumePdf === null, "no PDF to read");
        expect(resumePdf).toContain("Senior QA Automation Engineer");
    });

    for (const [id, metric] of Object.entries(metrics.items)) {
        if (metric.publish !== false) continue;

        test(`it does not publish ${id}, which the site suppresses`, () => {
            test.skip(resumePdf === null, "no PDF to read");
            // Matched on the shape of the claim rather than the display string,
            // because the PDF phrases things its own way — the site's suppressed
            // display for the coverage figure is "0 → 75%+", and the PDF wrote
            // the same unmeasurable claim as "from 0% to 75%+".
            const shape = metric.pdfPattern ? new RegExp(metric.pdfPattern, "i") : null;
            test.skip(shape === null, `${id} has no pdfPattern to match on`);
            test.skip(resumeIsWithheld && withheldMetricIds.has(id), "known defect; tracked in WITHHELD_BECAUSE");
            expect(shape.test(resumePdf), `the résumé publishes ${id}: ${metric.unpublishedReason}`).toBe(false);
        });
    }
});

test.describe("metric rendering rules", () => {
    test("no metric marked publish:false reaches the build", () => {
        for (const [id, metric] of Object.entries(metrics.items)) {
            if (metric.publish !== false) continue;
            const offenders = text.filter(({ body }) => body.includes(metric.display)).map(({ url }) => url);
            expect(offenders, `${id} is publish:false but "${metric.display}" is on ${offenders.join(", ")}`).toEqual([]);
        }
    });

    test("every projection rendered on the site carries its footnote", () => {
        for (const [id, metric] of Object.entries(metrics.items)) {
            if (metric.confidence !== "projection" || metric.publish === false) continue;

            for (const { url, body } of text) {
                if (!body.includes(metric.display)) continue;
                expect(body, `${url} shows ${id} without its footnote`).toContain(metric.footnote);
            }
        }
    });

    test("every team-attributed metric rendered on the site carries its credit", () => {
        for (const [id, metric] of Object.entries(metrics.items)) {
            if (metric.attribution !== "team" || metric.publish === false) continue;

            for (const { url, body } of text) {
                if (!body.includes(metric.display)) continue;
                expect(body, `${url} shows ${id} without crediting ${metric.credit}`).toContain(metric.credit);
            }
        }
    });
});

test("a bare numeral metric is never left without a noun", () => {
    /**
     * `countries` renders as "6" and `api_endpoints` as "30+", because the
     * convention is that the data layer holds the figure and the prose supplies
     * the word. That works right up until an author writes "across
     * {% metric "countries" %}." and ships a sentence that reads "across 6."
     *
     * It happened at four separate sites, which is what makes it worth a gate
     * rather than a proofread: every author reached for the same phrasing, so
     * the next one will too. The résumé shipped "across 6 and three distinct
     * generation architectures" and "300+ end-to-end scenarios, 30+, and
     * consumer-driven contracts".
     *
     * Scoped narrowly on purpose. It only fires when a metric whose display is a
     * bare numeral is immediately followed by punctuation or a conjunction —
     * which in running prose is unambiguously a missing noun, and which a stat
     * rail never produces, because there the number is followed by a closing
     * tag.
     */
    // A figure carrying a currency symbol or a percent sign already states what
    // it measures, so "down to $1.80–2.20." is a finished sentence and must not
    // be flagged. Only a naked count needs the prose to name the thing counted.
    const bareNumeral = /^[\d.,–—+\s→x×]+$/;
    const danglingAfter = /^\s*(?:[,.;]|and\b|or\b)/;

    /**
     * Matched on the rendered markup, not on the page text.
     *
     * The first version of this searched the stripped text for the display
     * string, which for `countries` is the single character "6" — so it matched
     * inside "2026.", "6.0" and "step 6)" and reported twelve false positives
     * against one real one. Anchoring on the shortcode's own wrapper means a
     * match is a metric by construction.
     */
    const rendered = /<span class="metric__value">([^<]*)<\/span><\/span>([\s\S]{0,60})/g;
    const displays = new Map(
        Object.entries(metrics.items)
            .filter(([, metric]) => metric.publish !== false && bareNumeral.test(metric.display))
            .map(([id, metric]) => [metric.display, id])
    );

    const offenders = [];

    for (const { url, html } of pages) {
        for (const [, display, following] of html.matchAll(rendered)) {
            const id = displays.get(display);
            if (!id) continue;

            // Tags are dropped, not replaced with a space: "6</span></p><p>Every"
            // must read as "Every", but the closing tag itself is not a word.
            const text = following.replace(/<[^>]*>/g, "");
            if (danglingAfter.test(text)) {
                offenders.push(`${url}: "…${display}${text.slice(0, 40).trim()}…" (${id})`);
            }
        }
    }

    expect(offenders, `a metric was rendered with no noun after it:\n  ${offenders.join("\n  ")}`).toEqual([]);
});

test("the architecture note is not paraphrased into an over-claim", () => {
    // "I test a RAG chatbot" is the single easiest thing to get wrong about this
    // platform, and it is wrong five times out of six.
    const offenders = text
        .filter(({ body }) => /\b(?:our|the)\s+RAG (?:platform|chatbots)\b/i.test(body))
        .map(({ url }) => url);
    expect(offenders, "generalises RAG beyond the one program that uses it").toEqual([]);
});
