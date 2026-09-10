import fs from "node:fs";
import path from "node:path";
import Image from "@11ty/eleventy-img";
import { bundle } from "lightningcss";
import site from "./src/_data/site.json" with { type: "json" };
import metrics from "./src/_data/metrics.json" with { type: "json" };
import programs from "./src/_data/programs.json" with { type: "json" };
import charts from "./src/_data/charts.json" with { type: "json" };

/**
 * Escapes text destined for an HTML text node or a double-quoted attribute.
 * Shortcodes return raw markup, so anything interpolated from the data layer
 * passes through here first.
 */
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * The confidence vocabulary. A metric's confidence decides how it is hedged in
 * prose, so the hedge cannot drift from the evidence — the two are the same field.
 */
const CONFIDENCE = {
    exact: { prefix: "", requiresFootnote: false },
    approximate: { prefix: "roughly ", requiresFootnote: false },
    estimate: { prefix: "approximately ", requiresFootnote: false },
    projection: { prefix: "an estimated ", requiresFootnote: true }
};

/**
 * Renders one metric. Throws rather than degrades: a build that cannot prove a
 * number is a build that should not ship.
 */
function renderMetric(id, options = {}) {
    const items = metrics.items;

    if (!Object.prototype.hasOwnProperty.call(items, id)) {
        const near = Object.keys(items)
            .filter((key) => key.includes(id.slice(0, 6)) || id.includes(key.slice(0, 6)))
            .slice(0, 5);
        throw new Error(
            `{% metric "${id}" %} — no such metric in src/_data/metrics.json.\n` +
                `Every published number lives in the data layer; prose may not carry its own.\n` +
                (near.length ? `Did you mean: ${near.join(", ")}?` : `Known keys: ${Object.keys(items).join(", ")}`)
        );
    }

    const metric = items[id];

    if (metric.publish === false) {
        throw new Error(
            `{% metric "${id}" %} — this metric is marked publish: false and must not reach the build.\n` +
                `Reason on record: ${metric.unpublishedReason ?? "(none recorded — add one)"}`
        );
    }

    const rule = CONFIDENCE[metric.confidence];
    if (!rule) {
        throw new Error(
            `{% metric "${id}" %} — unknown confidence "${metric.confidence}". ` +
                `Expected one of: ${Object.keys(CONFIDENCE).join(", ")}.`
        );
    }

    if (rule.requiresFootnote && !metric.footnote) {
        throw new Error(
            `{% metric "${id}" %} — confidence is "projection" but no footnote is recorded.\n` +
                `A projected figure must carry a visible statement that it is projected. Add a "footnote" field.`
        );
    }

    if (!metric.display) {
        throw new Error(`{% metric "${id}" %} — no "display" string recorded.`);
    }

    // `bare` suppresses the hedge for contexts that supply it themselves, such as
    // a stat rail where the label already reads "roughly". It cannot suppress a
    // projection footnote.
    const prefix = options.bare ? "" : rule.prefix;

    let html = `<span class="metric" data-confidence="${escapeHtml(metric.confidence)}">`;
    if (prefix) html += `<span class="metric__hedge">${escapeHtml(prefix.trim())}</span> `;
    html += `<span class="metric__value">${escapeHtml(metric.display)}</span>`;
    html += `</span>`;

    if (metric.confidence === "estimate" && metric.basis && options.basis !== false) {
        html += ` <span class="metric__basis">(${escapeHtml(metric.basis)})</span>`;
    }

    if (metric.attribution === "co-designed" && metric.credit) {
        html += ` <span class="metric__credit">— co-designed with ${escapeHtml(metric.credit)}</span>`;
    }

    const ATTRIBUTIONS = ["self", "co-designed", "team", "context"];
    if (!ATTRIBUTIONS.includes(metric.attribution)) {
        throw new Error(
            `{% metric "${id}" %} — unknown attribution "${metric.attribution}". ` +
                `Expected one of: ${ATTRIBUTIONS.join(", ")}.`
        );
    }

    if (metric.attribution === "team") {
        if (!metric.credit) {
            throw new Error(
                `{% metric "${id}" %} — attribution is "team" but no "credit" is recorded. ` +
                    `A number I did not produce must name who did.`
            );
        }
        html += ` <span class="metric__credit">— delivered by ${escapeHtml(metric.credit)}`;
        if (metric.role) html += `; my part was ${escapeHtml(metric.role)}`;
        html += `</span>`;
    }

    if (metric.footnote) {
        html += ` <span class="metric__footnote">${escapeHtml(metric.footnote)}</span>`;
    }

    return html;
}

export default function (eleventyConfig) {
    /* ---------------------------------------------------------------- build assertions */

    eleventyConfig.on("eleventy.before", () => {
        if (typeof site.experienceYears !== "string") {
            throw new Error(
                `site.experienceYears must be a string. As a number, "4.5+" silently becomes 4.5 and drops the plus.`
            );
        }
        if (/^4\+/.test(site.experienceYears)) {
            throw new Error(`site.experienceYears is "4+", which is the stale figure. It is "4.5+".`);
        }

        const publishedIds = Object.entries(metrics.items)
            .filter(([, metric]) => metric.publish !== false)
            .map(([id]) => id);
        if (publishedIds.length === 0) {
            throw new Error("No publishable metrics — the data layer is empty or misshapen.");
        }

        for (const [id, metric] of Object.entries(metrics.items)) {
            if (metric.publish === false && !metric.unpublishedReason) {
                throw new Error(
                    `metrics.items.${id} is publish: false with no unpublishedReason. ` +
                        `Suppressing a number without recording why is how it comes back.`
                );
            }
        }
    });

    /* ---------------------------------------------------------------- shortcodes */

    eleventyConfig.addShortcode("metric", (id, options) => renderMetric(id, options ?? {}));

    // The value alone, no wrapper and no hedge. For attributes, JSON-LD and titles.
    eleventyConfig.addShortcode("metricValue", (id) => {
        const metric = metrics.items[id];
        if (!metric) throw new Error(`{% metricValue "${id}" %} — no such metric.`);
        if (metric.publish === false) throw new Error(`{% metricValue "${id}" %} — publish: false.`);
        return escapeHtml(metric.display);
    });

    // One phrasing of the RAG clarification, everywhere. Paraphrasing it is how it
    // becomes wrong.
    eleventyConfig.addShortcode("architectureNote", (variant) => {
        // Nunjucks passes "" rather than undefined for a missing argument, so a
        // default parameter value alone would not fire.
        const note = programs.architectureNote[variant || "short"];
        if (!note) throw new Error(`{% architectureNote "${variant}" %} — expected "short" or "long".`);
        return (
            `<p class="architecture-note"><span class="architecture-note__label">Architecture</span> ` +
            `${escapeHtml(note)} ` +
            `<a href="${escapeHtml(programs.architectureNote.canonicalPost)}">Why the distinction matters</a>.</p>`
        );
    });

    /**
     * Just the confidence tag and its basis — for record rows where the value and
     * its grade sit in different columns and {% metric %}'s wrapper would nest
     * the value twice.
     */
    const GRADE_LABEL = {
        exact: "measured",
        approximate: "approximate",
        estimate: "estimated",
        projection: "projected"
    };

    eleventyConfig.addShortcode("grade", (id) => {
        const metric = metrics.items[id];
        if (!metric) throw new Error(`{% grade "${id}" %} — no such metric in src/_data/metrics.json.`);
        if (metric.publish === false) throw new Error(`{% grade "${id}" %} — this metric is publish: false.`);

        const label = GRADE_LABEL[metric.confidence];
        if (!label) {
            throw new Error(
                `{% grade "${id}" %} — unknown confidence "${metric.confidence}". Expected one of: ${Object.keys(GRADE_LABEL).join(", ")}.`
            );
        }

        let html = `<span class="grade" data-confidence="${escapeHtml(metric.confidence)}">`;
        html += `<span class="grade__label">${escapeHtml(label)}</span>`;
        if (metric.basis) html += ` <span class="grade__basis">${escapeHtml(metric.basis)}</span>`;
        html += `</span>`;
        return html;
    });

    /**
     * Inline SVG charts, drawn from charts.json rather than authored per-page, so
     * a chart cannot cite a number the data layer does not carry. currentColor
     * throughout means one source works in both themes. A `.visually-hidden`
     * table carries the same values for screen readers and for CSS-off reading.
     */
    eleventyConfig.addShortcode("chart", (id) => {
        const chart = charts.items[id];
        if (!chart) {
            throw new Error(
                `{% chart "${id}" %} — no such chart in src/_data/charts.json.\n` +
                    `Known keys: ${Object.keys(charts.items).join(", ")}`
            );
        }

        const metric = metrics.items[chart.metric];
        if (!metric) {
            throw new Error(`{% chart "${id}" %} — references metric "${chart.metric}", which does not exist in metrics.json.`);
        }
        if (metric.publish === false) {
            throw new Error(
                `{% chart "${id}" %} — references metric "${chart.metric}", which is publish: false. A chart cannot draw an unpublished number.`
            );
        }

        const entries = chart.series;
        if (!Array.isArray(entries) || entries.length === 0) {
            throw new Error(`{% chart "${id}" %} — "series" must be a non-empty array.`);
        }

        const titleId = `chart-${id}-title`;
        const descId = `chart-${id}-desc`;

        const width = 640;
        const height = 220;
        const padding = { top: 28, right: 16, bottom: 40, left: 16 };
        const plotWidth = width - padding.left - padding.right;
        const plotHeight = height - padding.top - padding.bottom;

        const values = entries.flatMap((entry) => [entry.value, entry.measured].filter((value) => typeof value === "number"));
        const max = Math.max(...values, 0);

        let body = "";

        if (chart.type === "decay") {
            const stepX = entries.length > 1 ? plotWidth / (entries.length - 1) : 0;
            const points = entries.map((entry, index) => ({
                x: padding.left + stepX * index,
                y: padding.top + plotHeight * (1 - (max ? entry.value / max : 0)),
                entry
            }));

            const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
            body += `<path d="${path}" fill="none" stroke="currentColor" stroke-width="2" class="chart__line" />`;

            for (const point of points) {
                body += `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4" fill="currentColor" class="chart__point" />`;
                body += `<text x="${point.x.toFixed(1)}" y="${(point.y - 10).toFixed(1)}" class="chart__value" text-anchor="middle">${escapeHtml(String(point.entry.value))}</text>`;
                body += `<text x="${point.x.toFixed(1)}" y="${height - 10}" class="chart__label" text-anchor="middle">${escapeHtml(point.entry.label)}</text>`;
            }
        } else if (chart.type === "before-after" || chart.type === "comparison") {
            const barGap = 24;
            const barWidth = (plotWidth - barGap * (entries.length - 1)) / entries.length;

            entries.forEach((entry, index) => {
                const x = padding.left + index * (barWidth + barGap);
                const barHeight = max ? (entry.value / max) * plotHeight : 0;
                const y = padding.top + (plotHeight - barHeight);

                body += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" class="chart__bar" fill="currentColor" />`;

                if (typeof entry.measured === "number") {
                    const tickY = padding.top + plotHeight * (1 - entry.measured / max);
                    body += `<line x1="${x.toFixed(1)}" x2="${(x + barWidth).toFixed(1)}" y1="${tickY.toFixed(1)}" y2="${tickY.toFixed(1)}" class="chart__threshold" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3" />`;
                }

                body += `<text x="${(x + barWidth / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" class="chart__value" text-anchor="middle">${escapeHtml(String(entry.value))}</text>`;
                body += `<text x="${(x + barWidth / 2).toFixed(1)}" y="${height - 10}" class="chart__label" text-anchor="middle">${escapeHtml(entry.label)}</text>`;
            });
        } else {
            throw new Error(`{% chart "${id}" %} — unknown type "${chart.type}". Expected before-after, decay or comparison.`);
        }

        const rows = entries
            .map((entry) => {
                const measured = typeof entry.measured === "number" ? `<td>${escapeHtml(String(entry.measured))}</td>` : "";
                return `<tr><th scope="row">${escapeHtml(entry.label)}</th><td>${escapeHtml(String(entry.value))}</td>${measured}</tr>`;
            })
            .join("");

        return (
            `<figure class="chart">` +
            // width and height as well as the viewBox, so the SVG has an
            // intrinsic size. With only a viewBox it has none, and the reset's
            // `max-inline-size: 100%` lets it fill whatever box it lands in —
            // which meant a 640-unit chart rendering at 1200px and drawing its
            // 1.5px strokes at nearly 3. Now the reset scales it down and never
            // up, and the aspect ratio is known before paint, so it reserves its
            // own space instead of shifting the page.
            `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${titleId} ${descId}" class="chart__svg">` +
            `<title id="${titleId}">${escapeHtml(chart.title)}</title>` +
            `<desc id="${descId}">${escapeHtml(chart.unit)}, ${entries.length} data points.</desc>` +
            body +
            `</svg>` +
            `<table class="visually-hidden"><caption>${escapeHtml(chart.title)} (${escapeHtml(chart.unit)})</caption>` +
            `<thead><tr><th scope="col">Label</th><th scope="col">Value</th></tr></thead>` +
            `<tbody>${rows}</tbody></table>` +
            `</figure>`
        );
    });

    /**
     * The run-history trend on /tests/.
     *
     * A separate shortcode from {% chart %} rather than an extension of it,
     * because the two draw different kinds of number. {% chart %} draws a
     * published claim: it requires an entry in charts.json whose `metric`
     * resolves in metrics.json, and refuses to plot a figure the data layer does
     * not carry. This draws a machine-written record of runs that happened, which
     * is the same case as /archive/ printing `{{ item.year }}` across 34 rows —
     * generated data, not a claim, and there is deliberately no way to pass a
     * series into {% chart %} from a page.
     *
     * It takes the history array rather than reading the data file, so one
     * renderer serves /tests/ with the real record and /styleguide/ with a frozen
     * fixture. That matters: /tests/ is not a screenshot route, but /styleguide/
     * is, and a component whose geometry moved on every accepted run would either
     * fail every baseline or have to be masked out of them — which would mean the
     * visual suite stopped guarding it.
     */
    const TREND_PANELS = [
        {
            key: "size",
            title: "Suite size",
            unit: "tests per run",
            column: "Tests",
            value: (run) => run.total,
            format: (value) => String(value)
        },
        {
            key: "duration",
            title: "Wall clock",
            unit: "seconds per run",
            column: "Duration",
            value: (run) => Math.round((run.durationMs ?? 0) / 1000),
            format: (value) => `${value}s`
        }
    ];

    eleventyConfig.addShortcode("runTrend", (history, prefix = "trend") => {
        if (!Array.isArray(history) || history.length === 0) {
            throw new Error(
                `{% runTrend %} — needs a non-empty run history. Guard the call with {% if testRuns.history.length %} so the page renders its empty state instead of this throwing.`
            );
        }

        // Oldest to newest, left to right. The record is stored newest-first
        // because that is the order every other consumer of it wants.
        const runs = [...history].reverse();

        const width = 320;
        const height = 180;
        // Room on the left for the two axis figures, and under the plot for the
        // commit labels at each end.
        const pad = { top: 26, right: 14, bottom: 34, left: 38 };
        const plotW = width - pad.left - pad.right;
        const plotH = height - pad.top - pad.bottom;

        const panels = TREND_PANELS.map((panel) => {
            const values = runs.map(panel.value);
            const min = Math.min(...values);
            const max = Math.max(...values);
            const span = max - min;
            const stepX = runs.length > 1 ? plotW / (runs.length - 1) : 0;

            const points = runs.map((run, index) => ({
                run,
                value: values[index],
                x: runs.length > 1 ? pad.left + stepX * index : pad.left + plotW / 2,
                // A series whose values are all equal has no range to scale
                // into, so it sits on the midline rather than dividing by zero.
                y: pad.top + (span ? plotH * (1 - (values[index] - min) / span) : plotH / 2)
            }));

            const titleId = `${prefix}-${panel.key}-title`;
            const descId = `${prefix}-${panel.key}-desc`;

            let body = "";

            if (points.length > 1) {
                const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
                body += `<path d="${path}" fill="none" stroke="currentColor" stroke-width="1.5" class="chart__line" />`;
            }

            for (const point of points) {
                body += `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="2.5" fill="currentColor" class="chart__point" />`;

                // A run with failures gets a ring as well as a dot, so it is
                // marked by shape. Nothing on this site carries meaning by
                // colour alone, and a red dot in a chart is the easiest place to
                // forget that.
                if (point.run.failed > 0) {
                    body +=
                        `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="6" fill="none" ` +
                        `stroke="currentColor" stroke-width="1.5" class="chart__point chart__point--failed" />`;
                }
            }

            // The two ends of the range, so a plot that does not start at zero
            // says what it does start at.
            if (span) {
                body +=
                    `<text x="${pad.left - 6}" y="${pad.top + 4}" text-anchor="end" class="chart__label">${escapeHtml(panel.format(max))}</text>` +
                    `<text x="${pad.left - 6}" y="${pad.top + plotH + 4}" text-anchor="end" class="chart__label">${escapeHtml(panel.format(min))}</text>`;
            }

            // The newest value goes in the caption rather than beside its point.
            // Tracking the point put it on top of the line whenever the series
            // ended on a downward leg, and when the newest value was also the
            // maximum it printed the same figure twice. As caption text it is
            // real text — selectable, scalable, and never colliding.
            const newest = points[points.length - 1];

            // Only the ends are labelled on the axis. Twenty commit hashes will
            // not fit across 272 units, and the table below carries all of them.
            const baseline = height - 10;
            if (points.length > 1) {
                body +=
                    `<text x="${pad.left}" y="${baseline}" text-anchor="start" class="chart__label">${escapeHtml(points[0].run.commitShort ?? "—")}</text>` +
                    `<text x="${pad.left + plotW}" y="${baseline}" text-anchor="end" class="chart__label">${escapeHtml(newest.run.commitShort ?? "—")}</text>`;
            } else {
                body += `<text x="${newest.x.toFixed(1)}" y="${baseline}" text-anchor="middle" class="chart__label">${escapeHtml(newest.run.commitShort ?? "—")}</text>`;
            }

            const scaleNote = span ? `Vertical axis spans ${panel.format(min)} to ${panel.format(max)}, not zero.` : "Every recorded run holds the same value.";
            const failedCount = runs.filter((run) => run.failed > 0).length;
            const failedNote = failedCount
                ? ` ${failedCount} run${failedCount === 1 ? "" : "s"} recorded failures and ${failedCount === 1 ? "is" : "are"} ringed.`
                : "";

            const rows = [...runs]
                .reverse()
                .map(
                    (run) =>
                        `<tr><th scope="row">${escapeHtml(run.commitShort ?? "—")}</th>` +
                        `<td>${escapeHtml(dateFormat.format(new Date(run.recordedAt)))}</td>` +
                        `<td>${escapeHtml(panel.format(panel.value(run)))}</td>` +
                        `<td>${run.failed > 0 ? "failed" : "passed"}</td></tr>`
                )
                .join("");

            return (
                `<figure class="chart run-trend__panel">` +
                `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" ` +
                `aria-labelledby="${titleId} ${descId}" class="chart__svg">` +
                `<title id="${titleId}">${escapeHtml(panel.title)}, last ${runs.length} recorded run${runs.length === 1 ? "" : "s"}</title>` +
                `<desc id="${descId}">${escapeHtml(panel.unit)}, ${runs.length} data point${runs.length === 1 ? "" : "s"}. ${escapeHtml(scaleNote)}${escapeHtml(failedNote)}</desc>` +
                body +
                `</svg>` +
                `<table class="visually-hidden"><caption>${escapeHtml(panel.title)} (${escapeHtml(panel.unit)})</caption>` +
                `<thead><tr><th scope="col">Commit</th><th scope="col">Recorded</th><th scope="col">${escapeHtml(panel.column)}</th><th scope="col">Result</th></tr></thead>` +
                `<tbody>${rows}</tbody></table>` +
                // Last child, not between the svg and the table: <figcaption>
                // is only permitted as the first or last child of a <figure>.
                // The table it follows is visually hidden, so the caption still
                // renders directly under the plot.
                `<figcaption class="chart__caption">${escapeHtml(panel.title)}, now ` +
                `<strong class="chart__now">${escapeHtml(panel.format(newest.value))}</strong></figcaption>` +
                `</figure>`
            );
        });

        return `<div class="run-trend">${panels.join("")}</div>`;
    });

    /**
     * Hand-authored SVG partials, inlined rather than <img>-referenced so
     * currentColor picks up the page's own theme instead of a rasterised palette.
     */
    const DIAGRAMS_DIR = path.join(process.cwd(), "src/_includes/diagrams");

    eleventyConfig.addShortcode("diagram", (name) => {
        const file = path.join(DIAGRAMS_DIR, `${name}.svg`);
        if (!fs.existsSync(file)) {
            const available = fs.existsSync(DIAGRAMS_DIR)
                ? fs.readdirSync(DIAGRAMS_DIR).map((entry) => entry.replace(/\.svg$/, ""))
                : [];
            throw new Error(
                `{% diagram "${name}" %} — no such diagram at src/_includes/diagrams/${name}.svg.\n` +
                    (available.length ? `Available: ${available.join(", ")}` : `The diagrams directory does not exist yet.`)
            );
        }
        // A blank line inside the SVG source is invisible on /styleguide/,
        // which is pure Nunjucks and never touches markdown-it. Inside a
        // case study's markdown body it is not invisible: markdown-it's raw
        // HTML block ends at the first blank line, so everything after one
        // fell out of the block and got individually paragraph-wrapped.
        return fs.readFileSync(file, "utf8").replace(/\n[ \t]*\n/g, "\n");
    });

    /**
     * Responsive images.
     *
     * Sources live in src/_images/, which Eleventy never publishes because of the
     * leading underscore — so the 2.4 MB original cannot be served by accident,
     * which is exactly what the old site did for its hero.
     *
     * Derivatives are generated at build time and are gitignored. Committing them
     * would put roughly 180 binaries in the history for no benefit; CI regenerates
     * them in well under a minute.
     */
    eleventyConfig.addAsyncShortcode("image", async (src, alt, sizes = "100vw", options = {}) => {
        if (alt === undefined) {
            // Not a default of "". An empty alt is a real, meaningful choice for a
            // decorative image, and it must be made deliberately rather than
            // arrived at by forgetting the argument.
            throw new Error(`{% image "${src}" %} — alt text is required. Pass "" explicitly if the image is decorative.`);
        }

        const source = path.join("src/_images", src);
        const shared = {
            outputDir: "./_site/img/",
            urlPath: "/img/",
            sharpAvifOptions: { quality: 62 },
            sharpWebpOptions: { quality: 76 }
        };

        // No `null` width anywhere: that emits the original 2048px source, and a
        // 2048px render of a portrait displayed at 480 CSS pixels is build output
        // nothing will ever request.
        const modern = await Image(source, {
            widths: [320, 480, 640, 960, 1280],
            formats: ["avif", "webp"],
            ...shared
        });

        // The PNG fallback gets exactly one width. Every browser that lacks WebP
        // also lacks AVIF, and that set is now vanishingly small — generating five
        // PNG widths added 2.4 MB to the build for a file essentially nobody
        // fetches. One width keeps the fallback honest without paying for it.
        const fallback = await Image(source, { widths: [640], formats: ["png"], ...shared });

        // Key order decides which format generateHTML uses for the <img> itself,
        // so the raster fallback must be added last.
        const metadata = { ...modern, png: fallback.png };

        return Image.generateHTML(metadata, {
            alt,
            sizes,
            loading: options.eager ? "eager" : "lazy",
            decoding: options.eager ? "sync" : "async",
            ...(options.eager ? { fetchpriority: "high" } : {}),
            ...(options.class ? { class: options.class } : {})
        });
    });

    /**
     * A portrait at a stable, predictable path.
     *
     * Everything else on the site goes through content-hashed filenames, which
     * is right for anything a page references — the page is rebuilt at the same
     * time and the two never disagree. Structured data is the exception: the
     * `Person.image` URL in JSON-LD is consumed by crawlers that cache it, and a
     * URL that changes whenever the source is re-encoded is a URL they will
     * eventually 404 on.
     *
     * It also has to be a portrait rather than a social card. Consumers of
     * `Person.image` render it as a photograph of the person, and a card with a
     * headline set across it is not that.
     */
    eleventyConfig.on("eleventy.after", async () => {
        await Image(path.join("src/_images", "headshot.png"), {
            widths: [400],
            formats: ["jpeg"],
            outputDir: "./_site/assets/",
            urlPath: "/assets/",
            filenameFormat: () => "portrait.jpg",
            sharpJpegOptions: { quality: 82, mozjpeg: true }
        });
    });

    /* ---------------------------------------------------------------- filters */

    const dateFormat = new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC"
    });

    const monthFormat = new Intl.DateTimeFormat("en-GB", {
        month: "short",
        year: "numeric",
        timeZone: "UTC"
    });

    eleventyConfig.addFilter("readableDate", (value) => dateFormat.format(new Date(value)));
    eleventyConfig.addFilter("monthYear", (value) => monthFormat.format(new Date(value)));
    eleventyConfig.addFilter("isoDate", (value) => new Date(value).toISOString().slice(0, 10));
    eleventyConfig.addFilter("year", (value) => new Date(value).getUTCFullYear());

    // Reading time from the rendered content. Deliberately coarse — a minute
    // figure that looks precise is a small lie about a rough measure.
    eleventyConfig.addFilter("readingTime", (content) => {
        const words = String(content).replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
        return Math.max(1, Math.round(words / 220));
    });

    eleventyConfig.addFilter("absoluteUrl", (path) => new URL(path, site.url).href);

    /**
     * A URL path flattened into one filename-safe token, so `/work/foo/` and
     * `/writing/foo/` cannot collide on a single `foo.png`. The home page has no
     * segments and becomes "home".
     */
    eleventyConfig.addFilter("ogSlug", (url) => {
        const slug = url.replace(/^\/|\/$/g, "").replace(/\.html$/, "").replace(/[^a-z0-9]+/gi, "-");
        return slug === "" ? "home" : slug.toLowerCase();
    });

    eleventyConfig.addFilter("limit", (array, count) => array.slice(0, count));

    eleventyConfig.addFilter("byLevel", (skills, level) => skills.filter((skill) => skill.level === level));

    // Flattens skills.groups into one ordered list of Core skill names, for
    // the résumé's scannable header — the "Core capabilities" section below
    // it needs the group structure to attribute each skill, the scan block
    // just needs the names.
    eleventyConfig.addFilter("coreSkillNames", (groups) =>
        groups.flatMap((group) => group.skills.filter((skill) => skill.level === "core").map((skill) => skill.name))
    );

    eleventyConfig.addFilter("otherThan", (items, url) => items.filter((item) => item.url !== url));

    /**
     * Breadcrumbs derived from the URL rather than declared per page, so a page
     * cannot claim a position in the hierarchy it does not occupy. Layout
     * templates cannot pass data up to the base layout in Eleventy's layout
     * chain, which is the other reason this is computed here.
     */
    const SECTION_LABELS = { work: "Work", writing: "Writing", about: "About", resume: "Résumé", contact: "Contact", skills: "Stack" };

    eleventyConfig.addFilter("breadcrumbs", (url, pageTitle) => {
        const segments = String(url).split("/").filter(Boolean);
        const crumbs = [{ label: "Home", url: "/" }];
        let path = "";
        segments.forEach((segment, index) => {
            path += `/${segment}`;
            const isLast = index === segments.length - 1;
            crumbs.push({
                label: isLast && pageTitle ? pageTitle : (SECTION_LABELS[segment] ?? segment),
                url: `${path}/`
            });
        });
        return crumbs;
    });

    /* ---------------------------------------------------------------- transforms */

    /**
     * Gives every section heading an id and builds the rail's table of contents
     * from the same list, in one pass.
     *
     * One pass is the point. `tests/links.spec.js` asserts that every `#fragment`
     * on the site resolves to a real `id`, and the cheapest way to satisfy that
     * permanently is to make it impossible to violate: the hrefs are generated
     * from the same array as the ids, so they cannot drift apart. Two passes, or
     * a hand-maintained list in front matter, would both need a human to keep
     * them in step.
     *
     * Chosen over markdown-it-anchor plus a TOC plugin. Those are two more
     * dependencies, and they only see markdown — `/styleguide/` and the other
     * .njk pages never touch markdown-it, so half the site would be uncovered.
     *
     * The body is delimited by comments rather than matched by class, because a
     * regex cannot find the close tag of a nested element and every article body
     * contains nested divs. The comments are removed on the way out.
     */
    eleventyConfig.addTransform("documentOutline", function (content) {
        if (!this.page.outputPath || !this.page.outputPath.endsWith(".html")) return content;

        const RAIL = '<div class="doc__rail" data-outline></div>';
        const body = content.match(/<!--outline:start-->([\s\S]*?)<!--outline:end-->/);
        if (!body) return content;

        // Existing ids anywhere on the page, so a generated one cannot collide
        // with a hand-written anchor — `/skills/` already puts `id="group-…"` on
        // its h2s, and `#main` exists on every page.
        const taken = new Set([...content.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

        // The rail's own heading id is not in the document yet, so reserve it
        // before generating anything that could slug to the same string.
        taken.add("doc-outline-title");

        const slugify = (html) =>
            html
                .replace(/<[^>]+>/g, "")
                .replace(/&[a-z]+;|&#\d+;/gi, "")
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "");

        const headings = [];

        const annotated = body[1].replace(
            /<h2\b([^>]*)>([\s\S]*?)<\/h2>/g,
            (whole, attrs, inner) => {
                const existing = attrs.match(/\bid="([^"]+)"/);

                let id = existing ? existing[1] : slugify(inner);
                if (!id) return whole; // A heading with no text to slug is left alone.

                if (!existing) {
                    // A case study and a post can both have "Results". Only the
                    // generated ones are disambiguated; an author-written id is
                    // theirs and is left exactly as typed.
                    let candidate = id;
                    let n = 2;
                    while (taken.has(candidate)) candidate = `${id}-${n++}`;
                    id = candidate;
                }
                taken.add(id);

                // The label keeps the heading's own escaped markup minus any
                // inline tags, so an apostrophe stays an entity and is never
                // double-escaped on the way into the link.
                headings.push({ id, label: inner.replace(/<[^>]+>/g, "").trim() });

                return existing ? whole : `<h2${attrs} id="${id}">${inner}</h2>`;
            }
        );

        // Function replacements throughout, never string ones: `$&`, `$1` and
        // friends are substitution patterns in a string replacement, and article
        // prose is entirely capable of containing them.
        const withIds = content.replace(body[0], () => annotated);

        // No headings means no rail. Removing the placeholder is deliberate: an
        // empty <nav> is a landmark a screen-reader user can jump into and find
        // nothing in.
        if (!headings.length) return withIds.replace(RAIL, () => "");

        const items = headings
            .map(({ id, label }) => `<li><a href="#${id}">${label}</a></li>`)
            .join("");

        const nav =
            `<nav class="doc__rail" aria-labelledby="doc-outline-title">` +
            `<h2 class="doc__rail-title" id="doc-outline-title">On this page</h2>` +
            `<ol>${items}</ol>` +
            `</nav>`;

        return withIds.replace(RAIL, () => nav);
    });

    /**
     * Wraps every table in a focusable, labelled scroll region.
     *
     * A table that scrolls horizontally is unreachable by keyboard unless the
     * scrolling element itself is focusable — a real failure, not a technicality,
     * and one that only appears at a narrow viewport. Doing it here rather than
     * asking authors to hand-wrap tables in markdown means it cannot be forgotten
     * on the next post.
     */
    eleventyConfig.addTransform("scrollableRegions", function (content) {
        if (!this.page.outputPath || !this.page.outputPath.endsWith(".html")) return content;

        // Declared per invocation, so the number a reader hears is the table's
        // position on the page they are on. A counter in the config closure is
        // shared by every page in the build: it numbered eight one-table pages
        // "Table 1" through "Table 8", and the number moved with template build
        // order, so an incremental rebuild under --serve changed it again.
        let tableIndex = 0;

        return (
            content
                // <section> rather than a div with role="region": a named section
                // is the native landmark, so a screen-reader user can jump straight
                // to the table instead of arrowing into it.
                //
                // Matches the whole table element (tables in this codebase never
                // nest) rather than the open and close tags separately, so a
                // visually-hidden table — the one {% chart %} emits for its data,
                // never meant to render — can be skipped as a single unit. Wrapping
                // it would add a pointless focus stop for a table nobody sees, and
                // .table-scroll table's `min-inline-size: 100%` would override the
                // 1px `.visually-hidden` sets, overflowing the page for real.
                .replace(/<table\b[^>]*>[\s\S]*?<\/table>/g, (tableBlock) => {
                    if (/class="[^"]*\bvisually-hidden\b[^"]*"/.test(tableBlock)) {
                        return tableBlock;
                    }
                    tableIndex += 1;
                    return (
                        `<section class="table-scroll" tabindex="0" ` +
                        `aria-label="Table ${tableIndex}, scrollable">${tableBlock}</section>`
                    );
                })
                // Code blocks overflow horizontally on a phone for the same reason
                // and are unreachable for the same reason. tabindex on the <pre>
                // itself is enough; wrapping it would add a landmark for something
                // that is already announced as a code block.
                .replace(/<pre(?![^>]*\btabindex=)([^>]*)>/g, '<pre$1 tabindex="0">')
        );
    });

    /* ---------------------------------------------------------------- collections */

    eleventyConfig.addCollection("caseStudies", (collection) =>
        collection
            .getFilteredByGlob("src/work/*.md")
            .filter((item) => item.data.draft !== true)
            .sort((a, b) => (a.data.order ?? 99) - (b.data.order ?? 99))
    );

    eleventyConfig.addCollection("posts", (collection) =>
        collection
            .getFilteredByGlob("src/blog/*.md")
            .filter((item) => item.data.draft !== true)
            .sort((a, b) => b.date - a.date)
    );

    /* ---------------------------------------------------------------- passthrough and server */

    /**
     * CSS is bundled, not copied.
     *
     * Passing the files through would ship main.css as a chain of @import rules,
     * and an @import is a render-blocking request that cannot start until the
     * parent stylesheet has arrived — nine files becomes a serial waterfall in
     * front of first paint. Lightning CSS inlines them into one file, downlevels
     * nesting and custom media, and minifies.
     *
     * Only main.css compiles. The partials return undefined, which tells Eleventy
     * to write nothing for them.
     */
    eleventyConfig.addTemplateFormats("css");
    eleventyConfig.addExtension("css", {
        outputFileExtension: "css",
        compile: async (_content, inputPath) => {
            if (!/[\\/]main\.css$/.test(inputPath)) return;

            return async () => {
                const { code, warnings } = bundle({
                    filename: inputPath,
                    minify: true,
                    // Targets chosen so light-dark() survives rather than being
                    // downlevelled: it is the mechanism the whole theme layer rests
                    // on, and there is no faithful fallback for it.
                    targets: {
                        chrome: 123 << 16,
                        firefox: 120 << 16,
                        safari: (17 << 16) | (5 << 8)
                    }
                });

                for (const warning of warnings) {
                    console.warn(`[lightningcss] ${warning.message}`);
                }

                return code.toString();
            };
        }
    });

    eleventyConfig.addPassthroughCopy({ "src/js": "js" });
    eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });

    eleventyConfig.addWatchTarget("src/css/");
    eleventyConfig.addWatchTarget("src/js/");

    eleventyConfig.setServerOptions({ port: 8080 });

    return {
        dir: {
            input: "src",
            output: "_site",
            includes: "_includes",
            data: "_data"
        },
        templateFormats: ["njk", "md", "html"],
        markdownTemplateEngine: "njk",
        htmlTemplateEngine: "njk",
        pathPrefix: "/"
    };
}
