/**
 * The demo app the lab drives.
 *
 * A fictional answer-review console: an evaluation queue where a reviewer
 * reads a generated answer, sees its scores, and either approves it or flags
 * it. It is shaped like the real work so the tests visitors write are about
 * the domain, but every question, answer and score in it is invented. It is
 * not a depiction of any client system, and nothing here is drawn from
 * production traffic, prompts, retriever content or a golden dataset.
 *
 * It is built as an iframe `srcdoc` rather than shipped as an HTML file on
 * purpose. `tests/helpers/routes.mjs` discovers routes by walking `_site` for
 * every .html file, so a real file would become a route and be held to the
 * site's own accessibility gate — and one of the challenges needs a button
 * with a deliberately missing accessible name. A srcdoc iframe inherits the
 * parent's origin, so the runner can still reach into its document, but it
 * exists only at runtime and is never a page.
 *
 * Each variant is a defect worth teaching, not a random bug.
 *
 * The markup below is a template literal, so it contains no backticks. An
 * explanatory comment written inside the HTML with a backticked word in it
 * terminated the string and broke the whole app with a syntax error — which
 * the accessibility test then passed, because a lab that fails to load stays
 * hidden and axe only saw the static fallback. Lighthouse's console-error
 * audit is what caught it. Keep prose about this file in this header.
 *
 * The app's title is a <p> rather than an <h1>: axe flattens same-origin
 * iframes into the host page's heading order, so an <h1> here landed between
 * the page's h2s and its h3s and read as a skipped level. That is a real
 * finding rather than a quirk — two first-level headings on one rendered
 * screen is confusing however the markup is split. The iframe's accessible
 * name comes from its title attribute, which is the right way to label an
 * embedded document anyway.
 */

const STYLES = `
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
        margin: 0;
        padding: 16px;
        font: 14px/1.5 ui-sans-serif, system-ui, sans-serif;
        background: Canvas;
        color: CanvasText;
    }
    /*
      No colour is used to carry meaning and nothing is set to a mid grey.
      axe traverses same-origin iframes and evaluates this document as part of
      the host page, so a 3.9:1 label in here is a contrast failure on /lab/ —
      which it should be. The only accessibility defect in this app is the one
      the fourth challenge is about, and it lives in a variant, not here.
    */
    .title { font-size: 15px; font-weight: 600; margin: 0 0 12px; }
    .card { border: 1px solid rgb(128 128 128 / 0.5); border-radius: 6px; padding: 12px; }
    .q { font-weight: 600; margin: 0 0 8px; }
    .a { margin: 0 0 12px; }
    dl { display: flex; gap: 16px; margin: 0 0 12px; font-size: 13px; }
    dt { font-weight: 600; }
    dd { margin: 0 0 0 4px; font-variant-numeric: tabular-nums; }
    dl > div { display: flex; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    button {
        font: inherit; padding: 6px 12px; border-radius: 5px;
        border: 1px solid rgb(128 128 128 / 0.8); background: transparent;
        color: inherit; cursor: pointer;
    }
    button:disabled { opacity: 0.55; cursor: default; }
    button:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
    [data-testid="status"] { font-size: 13px; margin: 0; }
    .spinner { font-size: 13px; }
`;

/**
 * `flaky` makes the review load slowly and unpredictably. `renamed` changes the
 * approve button's visible label but keeps its test id and role name. `unnamed`
 * strips the flag button's accessible name entirely — it is an icon button with
 * no aria-label, which is why getByRole cannot find it.
 */
export function demoApp({ flaky = false, renamed = false, unnamed = false } = {}) {
    const approveLabel = renamed ? "Accept answer" : "Approve";

    const flagButton = unnamed
        ? `<button type="button" data-testid="flag">⚑</button>`
        : `<button type="button" data-testid="flag">Flag for review</button>`;

    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><style>${STYLES}</style></head>
<body>
<p class="title">Answer review</p>
<div class="card">
    <p class="q" data-testid="question">Is a second-trimester scan routine?</p>
    <p class="a" data-testid="answer">Loading review…</p>
    <dl>
        <div><dt>Faithfulness</dt><dd data-testid="faithfulness">—</dd></div>
        <div><dt>Safety</dt><dd data-testid="safety">—</dd></div>
    </dl>
    <div class="row">
        <button type="button" data-testid="approve" disabled>${approveLabel}</button>
        ${flagButton}
        <span class="spinner" data-testid="spinner">loading…</span>
    </div>
    <p data-testid="status" role="status">idle</p>
</div>
<script>
(function () {
    var byId = function (id) { return document.querySelector('[data-testid="' + id + '"]'); };
    var status = byId("status");
    var reviewed = 0;

    // Between 120ms and 900ms in the flaky variant. Long enough that a test
    // written with a fixed 200ms sleep passes locally and fails about half the
    // time, which is the entire lesson.
    var delay = ${flaky} ? 120 + Math.floor(Math.random() * 780) : 120;

    setTimeout(function () {
        byId("answer").textContent =
            "A routine anomaly scan is usually offered between 18 and 21 weeks. Ask your clinic what they schedule.";
        byId("faithfulness").textContent = "0.82";
        byId("safety").textContent = "pass";
        byId("approve").disabled = false;
        byId("spinner").remove();
        status.textContent = "ready";
    }, delay);

    byId("approve").addEventListener("click", function () {
        reviewed += 1;
        status.textContent = "approved " + reviewed;
    });

    byId("flag").addEventListener("click", function () {
        status.textContent = "flagged";
    });
}());
<\/script>
</body>
</html>`;
}
