import { inflateSync } from "node:zlib";

const NUL = String.fromCharCode(0);

/**
 * Extracts the readable words from a PDF's content streams.
 *
 * This is deliberately not a layout-faithful renderer. The one question asked of
 * it is "does this document contain a string the site is not allowed to
 * publish?", and for that, word order and positioning are irrelevant — only
 * presence matters. A real PDF parser would be a dependency and a maintenance
 * surface for no additional signal.
 *
 * Limitation worth stating: text drawn as an image, or set in a font with a
 * non-standard encoding, will not appear here. So a clean result is evidence,
 * not proof. Word and LibreOffice both emit ordinary Flate-compressed content
 * streams with literal strings, which is what this handles.
 */
export function pdfText(buffer) {
    let raw = "";
    let cursor = 0;

    while (true) {
        const start = buffer.indexOf("stream", cursor);
        if (start < 0) break;

        // The stream data begins after the keyword's end-of-line, which may be
        // CR, LF or CRLF depending on the producer.
        let payload = start + "stream".length;
        if (buffer[payload] === 0x0d) payload += 1;
        if (buffer[payload] === 0x0a) payload += 1;

        const end = buffer.indexOf("endstream", payload);
        if (end < 0) break;

        try {
            raw += inflateSync(buffer.subarray(payload, end)).toString("latin1");
        } catch {
            // Not a Flate stream — an embedded font or image. Nothing to read.
        }

        cursor = end + "endstream".length;
    }

    // Literal strings are the arguments to the text-showing operators. Some
    // producers write them as UTF-16, so the interleaved null bytes are dropped;
    // that is crude, but it is enough to make the words greppable.
    const strings = [...raw.matchAll(/\(((?:\\.|[^()\\])*)\)/g)].map(([, value]) =>
        value.replace(/\\([()\\])/g, "$1").split(NUL).join("")
    );

    return strings.join("").replace(/\s+/g, " ").trim();
}
