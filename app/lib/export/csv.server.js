/**
 * CSV writing for merchant-facing exports.
 *
 * Two things here are not optional:
 *
 * 1. Formula injection. Every value in these exports originates with a shopper
 *    — contact names, email local parts, error strings. A field beginning with
 *    =, +, -, @, tab or CR is interpreted as a formula by Excel, Sheets and
 *    Numbers, so a contact named `=HYPERLINK("http://evil","click")` becomes a
 *    live link in the merchant's spreadsheet. Prefixing with an apostrophe
 *    neutralises it while displaying identically.
 *
 * 2. A UTF-8 BOM. Without it Excel on Windows renders non-ASCII names as
 *    mojibake, which for a contact list is most of the point of the export.
 */

const BOM = "\uFEFF"; // UTF-8 BOM, written as an escape so it is visible in source
const INJECTION_PREFIX = /^[=+\-@\t\r]/;

/** Quote and escape a single CSV field. */
export function csvField(value) {
  if (value === null || value === undefined) return "";

  let s = value instanceof Date ? value.toISOString() : String(value);

  // Neutralise spreadsheet formulas before quoting.
  if (INJECTION_PREFIX.test(s)) s = `'${s}`;

  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Join one record into a CSV line. */
export function csvRow(values) {
  return values.map(csvField).join(",");
}

/**
 * Stream rows to the client as a downloadable CSV.
 *
 * Takes an async iterable of row BATCHES so the caller can page the database
 * instead of materialising the whole export. The response starts flowing on the
 * first batch, so a large export doesn't sit behind a request timeout with no
 * output.
 *
 * @param {object} args
 * @param {string} args.filename
 * @param {string[]} args.headers      column headings, in order
 * @param {AsyncIterable<object[]>} args.batches
 * @param {(row: object) => Array} args.toRow   maps a row to field values
 */
export function csvStreamResponse({ filename, headers, batches, toRow }) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(BOM + csvRow(headers) + "\n"));
        for await (const batch of batches) {
          let chunk = "";
          for (const row of batch) chunk += csvRow(toRow(row)) + "\n";
          if (chunk) controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        // The response has already begun, so the status line is long gone. A
        // trailing marker is the only way to signal truncation — silently
        // ending would hand the merchant a short file they'd believe complete.
        console.error("[csv-export] stream failed:", err);
        controller.enqueue(
          encoder.encode(`\n"EXPORT INCOMPLETE — an error occurred, please retry"\n`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${sanitizeFilename(filename)}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Strip anything that would break the Content-Disposition header. */
export function sanitizeFilename(name) {
  return String(name || "export.csv")
    .replace(/[^\w.\- ]+/g, "_")
    .slice(0, 120);
}

/** ISO timestamp or empty — the format every spreadsheet parses unambiguously. */
export function csvDate(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}
