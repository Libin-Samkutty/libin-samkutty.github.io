export default function (eleventyConfig) {
    // Static passthrough. src/_images and src/_svg are underscore-prefixed, so
    // Eleventy ignores them -- the 2.4 MB headshot source is never published.
    eleventyConfig.addPassthroughCopy({ "src/css": "css" });
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
        // User Pages site served at the domain root.
        pathPrefix: "/"
    };
}
