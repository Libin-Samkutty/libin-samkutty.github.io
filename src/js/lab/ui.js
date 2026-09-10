/**
 * The lab's interface.
 *
 * Loaded only on /lab/, from a front-matter-gated script tag, so the sitewide
 * 15 KB script budget in lighthouserc.cjs still measures only site.js.
 *
 * Follows the same three rules as site.js: every block guards its own
 * elements, behaviour hooks are `data-*` and state is `is-`, and nothing here
 * is required to read the page. With JavaScript off, /lab/ is a readable
 * article about how the runner works, with each challenge's test source in a
 * code block. Run is the enhancement.
 */

import { runTest, loadApp } from "./runner.js";

(function lab() {
    const root = document.querySelector("[data-lab]");
    if (!root) return;

    const frame = root.querySelector("[data-lab-frame]");
    const editor = root.querySelector("[data-lab-editor]");
    const runButton = root.querySelector("[data-lab-run]");
    const resetButton = root.querySelector("[data-lab-reset]");
    const output = root.querySelector("[data-lab-output]");
    const picker = root.querySelector("[data-lab-picker]");
    if (!frame || !editor || !runButton || !output || !picker) return;

    const challenges = JSON.parse(root.querySelector("[data-lab-challenges]").textContent);
    const STORE = "lab-solved";

    let current = challenges[0];
    let running = false;

    /* ------------------------------------------------------------- progress */

    const readSolved = () => {
        try {
            return new Set(JSON.parse(localStorage.getItem(STORE) || "[]"));
        } catch (e) {
            // Private browsing, or a value from an older shape. Either way the
            // lab works, it just does not remember.
            return new Set();
        }
    };

    const writeSolved = (set) => {
        try {
            localStorage.setItem(STORE, JSON.stringify([...set]));
        } catch (e) {
            /* Nothing to do. Progress is a convenience, not the feature. */
        }
    };

    const markSolved = (id) => {
        const solved = readSolved();
        if (solved.has(id)) return;
        solved.add(id);
        writeSolved(solved);
        paintPicker();
    };

    function paintPicker() {
        const solved = readSolved();
        picker.querySelectorAll("[data-challenge]").forEach((button) => {
            const done = solved.has(button.dataset.challenge);
            button.classList.toggle("is-solved", done);
            const state = button.querySelector("[data-lab-state]");
            if (state) state.textContent = done ? "solved" : "";
        });
        const count = root.querySelector("[data-lab-count]");
        if (count) count.textContent = `${solved.size} of ${challenges.length} solved`;
    }

    /* ------------------------------------------------------------- rendering */

    const escape = (value) =>
        String(value).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

    function renderRun(runs) {
        const rows = runs
            .map((run, index) => {
                const steps = run.steps
                    .map(
                        (step) =>
                            `<li class="lab-step is-${step.status}">` +
                            `<span class="lab-step__title">${escape(step.title)}</span>` +
                            `<span class="lab-step__ms" data-volatile>${step.ms}ms</span>` +
                            (step.error ? `<pre class="lab-step__error">${escape(step.error)}</pre>` : "") +
                            `</li>`
                    )
                    .join("");

                const label = runs.length > 1 ? `Run ${index + 1} · ${run.variantName}` : run.variantName;

                return (
                    `<section class="lab-run is-${run.status}">` +
                    `<h3 class="lab-run__title">${escape(label)} — ${run.status} <span data-volatile>(${run.ms}ms)</span></h3>` +
                    `<ol class="lab-steps">${steps}</ol>` +
                    (run.error && !run.steps.some((s) => s.error)
                        ? `<pre class="lab-step__error">${escape(run.error)}</pre>`
                        : "") +
                    `</section>`
                );
            })
            .join("");

        output.innerHTML = rows;
    }

    function renderVerdict(passed, runs) {
        const wanted = current.requires;
        const note = document.createElement("p");
        note.className = passed ? "lab-verdict is-pass" : "lab-verdict is-fail";

        if (passed) {
            note.textContent = `Solved. ${current.lesson}`;
        } else if (wanted === "fail") {
            note.textContent =
                "Not yet — this challenge wants the test to fail, and yours passed. Read the prompt again.";
        } else {
            const failed = runs.filter((r) => r.status === "fail").length;
            note.textContent =
                runs.length > 1
                    ? `Not yet — ${failed} of ${runs.length} runs failed. A test that passes sometimes is a test that fails sometimes.`
                    : "Not yet. Read the failure above: it names what it waited for and what it saw instead.";
        }
        output.prepend(note);
    }

    /* ------------------------------------------------------------- running */

    async function run() {
        if (running) return;
        running = true;
        runButton.disabled = true;
        runButton.textContent = "Running…";
        output.innerHTML = '<p class="lab-verdict">Running…</p>';

        const variants = {
            default: {},
            flaky: { flaky: true },
            renamed: { renamed: true },
            unnamed: { unnamed: true }
        };

        const runs = [];
        for (const name of current.runs) {
            const result = await runTest(editor.value, frame, variants[name] || {});
            runs.push({ ...result, variantName: name });
        }

        renderRun(runs);

        const allPassed = runs.every((r) => r.status === "pass");
        const solved = current.requires === "fail" ? runs.every((r) => r.status === "fail") : allPassed;

        renderVerdict(solved, runs);
        if (solved) markSolved(current.id);

        runButton.disabled = false;
        runButton.textContent = "Run test";
        running = false;
    }

    /* ------------------------------------------------------------- wiring */

    function select(id) {
        const found = challenges.find((c) => c.id === id);
        if (!found) return;
        current = found;
        editor.value = found.start;

        picker.querySelectorAll("[data-challenge]").forEach((button) => {
            const active = button.dataset.challenge === id;
            button.classList.toggle("is-current", active);
            button.setAttribute("aria-current", active ? "true" : "false");
        });

        const prompt = root.querySelector("[data-lab-prompt]");
        if (prompt) prompt.textContent = found.prompt;

        const hint = root.querySelector("[data-lab-hint]");
        if (hint) hint.textContent = found.hint;

        const runsNote = root.querySelector("[data-lab-runs]");
        if (runsNote) {
            runsNote.textContent =
                found.requires === "fail"
                    ? `Runs once against the ${found.runs[0]} app. This one is solved by making it fail.`
                    : `Runs ${found.runs.length} time${found.runs.length > 1 ? "s" : ""}: ${found.runs.join(", ")}.`;
        }

        output.innerHTML = "";
        loadApp(frame, {});
    }

    picker.addEventListener("click", (event) => {
        const button = event.target.closest("[data-challenge]");
        if (!button) return;
        select(button.dataset.challenge);
    });

    runButton.addEventListener("click", run);

    if (resetButton) {
        resetButton.addEventListener("click", () => {
            editor.value = current.start;
            output.innerHTML = "";
        });
    }

    // Ctrl/Cmd+Enter runs, because anyone who writes tests will try it.
    editor.addEventListener("keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            run();
        }
    });

    // The panel is inert without JavaScript, so it ships hidden and is
    // revealed here — the same contract the theme toggle uses. Unhidden last,
    // after everything above has been wired, so a throw earlier in this
    // function leaves a page with no dead controls on it rather than a panel
    // whose buttons do nothing.
    root.hidden = false;

    // And the static list goes, because the panel now says everything it said.
    // Ordered after `root.hidden = false` on purpose: if anything above throws,
    // the reader keeps the static version rather than losing both.
    const staticList = document.querySelector("[data-lab-static]");
    if (staticList) staticList.hidden = true;

    select(challenges[0].id);
    paintPicker();
})();
