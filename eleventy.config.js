import path from "node:path";
import Image from "@11ty/eleventy-img";
import { bundle } from "lightningcss";
import site from "./src/_data/site.json" with { type: "json" };
import metrics from "./src/_data/metrics.json" with { type: "json" };
import programs from "./src/_data/programs.json" with { type: "json" };

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
                // Matching attributes matters even though markdown-it emits a bare
                // <table>: the closing replace below matches every </table>, so an
                // open pattern that missed <table class="..."> would leave an
                // orphan </section> the moment anyone hand-wrote one.
                .replace(/<table\b[^>]*>/g, (openTag) => {
                    tableIndex += 1;
                    return (
                        `<section class="table-scroll" tabindex="0" ` +
                        `aria-label="Table ${tableIndex}, scrollable">${openTag}`
                    );
                })
                .replace(/<\/table>/g, "</table></section>")
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
