/**
 * Lighthouse CI budgets.
 *
 * These are constraints, not aspirations. The one that does the most work is
 * `resource-summary:third-party:count` at 0 — the previous site pulled from two
 * CDN origins, and "we should self-host" is a preference that erodes, whereas a
 * failing build is not.
 *
 * `target: "filesystem"` deliberately. The default, temporary-public-storage,
 * uploads every report to a public URL.
 */
module.exports = {
    ci: {
        collect: {
            staticDistDir: "./_site",
            numberOfRuns: 3,
            url: [
                "http://localhost/index.html",
                "http://localhost/work/index.html",
                "http://localhost/work/llm-judge-independence/index.html",
                "http://localhost/resume/index.html"
            ],
            settings: {
                preset: "desktop",
                skipAudits: ["uses-http2", "canonical"]
            }
        },

        assert: {
            assertions: {
                "categories:performance": ["error", { minScore: 0.95 }],
                "categories:accessibility": ["error", { minScore: 1 }],
                "categories:best-practices": ["error", { minScore: 1 }],
                "categories:seo": ["error", { minScore: 1 }],

                "largest-contentful-paint": ["error", { maxNumericValue: 2000 }],
                "first-contentful-paint": ["error", { maxNumericValue: 1400 }],
                "cumulative-layout-shift": ["error", { maxNumericValue: 0.05 }],
                "total-blocking-time": ["error", { maxNumericValue: 150 }],

                "resource-summary:total:size": ["error", { maxNumericValue: 614400 }],
                "resource-summary:stylesheet:size": ["error", { maxNumericValue: 61440 }],
                "resource-summary:script:size": ["error", { maxNumericValue: 15360 }],
                "resource-summary:image:size": ["error", { maxNumericValue: 256000 }],
                "resource-summary:font:size": ["error", { maxNumericValue: 122880 }],
                "resource-summary:total:count": ["error", { maxNumericValue: 25 }],
                "resource-summary:third-party:count": ["error", { maxNumericValue: 0 }],

                "unused-css-rules": ["warn", { maxLength: 1 }],
                "modern-image-formats": "error",
                "uses-responsive-images": "error",
                "efficient-animated-content": "error"
            }
        },

        upload: {
            target: "filesystem",
            outputDir: "./.lighthouseci"
        }
    }
};
