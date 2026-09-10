/**
 * The disclosure denylist, in one place because two things now enforce it.
 *
 * It began inline in content-consistency.spec.js, which scans the built HTML.
 * That was the only surface until /tests/ started publishing text written by the
 * test run itself — spec names, test titles — which reaches a page without ever
 * having been authored by anyone.
 *
 * That matters more than it sounds. The titles in content-consistency.spec.js
 * are built from these very patterns, so the suite that enforces the denylist
 * generates strings containing every term on it. Those titles are far too fast
 * to reach the slowest-tests table in practice, and "in practice" is not the
 * standard this repository holds anything else to. So scripts/test-report.mjs
 * checks the record against this list before writing it, and refuses rather than
 * publishing a term the rest of the site is careful to keep off.
 *
 * Each entry needs a `pattern` and a `why`. The `why` is read out in the failure
 * message, so write it for whoever hits the failure in six months.
 */
export const denylist = [
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

/**
 * The first denylist entry `value` matches, or null. Used by the reducer, which
 * needs to know *which* rule tripped in order to say so.
 */
export function firstDisclosureMatch(value) {
    const text = String(value ?? "");
    return denylist.find(({ pattern }) => pattern.test(text)) ?? null;
}
