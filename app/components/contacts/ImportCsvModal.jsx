/**
 * CSV contact import.
 *
 * Three things this had to fix:
 *
 *  1. Scale. The whole file used to be posted as one JSON form field and
 *     imported with a sequential upsert per row — a large list exceeded the
 *     request body limit or timed out partway, leaving a partial import with no
 *     record of where it stopped. Rows are now uploaded in batches with visible
 *     progress, and a failure reports exactly how far it got.
 *
 *  2. Consent. Every row used to be written as `subscribed` with a
 *     marketingConsentAt of "now" — a consent record that never happened. The
 *     merchant now has to attest, and without it contacts import as
 *     non-marketable rather than being silently opted in.
 *
 *  3. Mapping. Columns were hardcoded to email/name/tags, so any other header
 *     naming ("Email Address", "Customer Name") imported nothing.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import Icons from "../ui/Icons.jsx";

const BATCH_SIZE = 500;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

// Header names we can recognise without being told.
const AUTO_MAP = {
  email: ["email", "emailaddress", "email_address", "e-mail", "mail"],
  name: ["name", "fullname", "full_name", "customername", "customer_name", "firstname", "first_name"],
  phone: ["phone", "phonenumber", "phone_number", "mobile", "telephone", "tel"],
  tags: ["tags", "tag", "labels", "segments"],
};

/** Split one CSV line, honouring quoted fields containing commas. */
function splitLine(line) {
  const cols = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      cols.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cols.push(cur.trim());
  return cols;
}

function parseCSV(text) {
  // Strip a UTF-8 BOM, which Excel writes and which otherwise corrupts the
  // first header name so it never matches "email".
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { headers: [], rows: [], error: "That file is empty." };

  const headers = splitLine(lines[0]);
  const rows = lines.slice(1).map(splitLine);
  return { headers, rows, error: null };
}

/** Best-guess column indexes from the header row. */
function autoMap(headers) {
  const norm = headers.map((h) => h.toLowerCase().replace(/[\s_-]+/g, ""));
  const find = (candidates) => {
    for (const c of candidates) {
      const i = norm.indexOf(c.replace(/[\s_-]+/g, ""));
      if (i !== -1) return i;
    }
    return -1;
  };
  return {
    email: find(AUTO_MAP.email),
    name: find(AUTO_MAP.name),
    phone: find(AUTO_MAP.phone),
    tags: find(AUTO_MAP.tags),
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function ImportCsvModal({ open, onClose, properties = [] }) {
  const revalidator = useRevalidator();
  const fileRef = useRef(null);

  const [screen, setScreen] = useState("upload"); // upload | map | importing | result
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState(null);
  const [mapping, setMapping] = useState({ email: -1, name: -1, phone: -1, tags: -1 });
  // Column index per custom-property key, e.g. { vip_tier: 3 }.
  const [propMapping, setPropMapping] = useState({});
  const [consent, setConsent] = useState(false);
  const [parseError, setParseError] = useState("");

  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [totals, setTotals] = useState(null);
  const [importError, setImportError] = useState("");

  // Guards against a re-render restarting an in-flight import.
  const runningRef = useRef(false);

  const reset = () => {
    setScreen("upload");
    setParsed(null);
    setFileName("");
    setMapping({ email: -1, name: -1, phone: -1, tags: -1 });
    setPropMapping({});
    setConsent(false);
    setParseError("");
    setProgress({ done: 0, total: 0 });
    setTotals(null);
    setImportError("");
    runningRef.current = false;
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleClose = () => {
    // Refresh the list so a completed import is visible immediately.
    if (totals && (totals.imported || totals.updated)) revalidator.revalidate();
    reset();
    onClose();
  };

  const loadFile = (file) => {
    if (!file) return;
    setParseError("");
    if (file.size > MAX_FILE_BYTES) {
      setParseError("That file is larger than 20MB. Split it and import in parts.");
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onerror = () => setParseError("That file could not be read.");
    reader.onload = (e) => {
      const result = parseCSV(String(e.target.result || ""));
      if (result.error) {
        setParseError(result.error);
        return;
      }
      setParsed(result);
      setMapping(autoMap(result.headers));
      // Auto-match custom properties by label or key, so a column headed
      // "VIP Tier" lands on the vip_tier property without being told.
      const norm = result.headers.map((h) => h.toLowerCase().replace(/[\s_-]+/g, ""));
      const guessed = {};
      for (const def of properties) {
        const wanted = [def.label, def.key].map((v) => String(v).toLowerCase().replace(/[\s_-]+/g, ""));
        const idx = norm.findIndex((h) => wanted.includes(h));
        if (idx !== -1) guessed[def.key] = idx;
      }
      setPropMapping(guessed);
      setScreen("map");
    };
    reader.readAsText(file);
  };

  // Rows built from the current mapping, with validity marked for the preview.
  const mapped = useMemo(() => {
    if (!parsed || mapping.email === -1) return [];
    const propEntries = Object.entries(propMapping).filter(([, i]) => i !== -1 && i !== undefined);
    return parsed.rows.map((cols) => {
      const email = String(cols[mapping.email] || "").trim().toLowerCase();
      const tagsRaw = mapping.tags !== -1 ? String(cols[mapping.tags] || "") : "";
      const props = {};
      for (const [key, idx] of propEntries) {
        const v = String(cols[idx] ?? "").trim();
        if (v) props[key] = v;
      }
      return {
        email,
        name: mapping.name !== -1 ? String(cols[mapping.name] || "").trim() : "",
        phone: mapping.phone !== -1 ? String(cols[mapping.phone] || "").trim() : "",
        tags: tagsRaw ? tagsRaw.split(/[,;|]/).map((t) => t.trim()).filter(Boolean) : [],
        props,
        valid: EMAIL_RE.test(email),
      };
    });
  }, [parsed, mapping, propMapping]);

  const validRows = useMemo(() => mapped.filter((r) => r.valid), [mapped]);
  const invalidCount = mapped.length - validRows.length;

  // ── The chunked upload loop ─────────────────────────────────────────────
  async function runImport() {
    if (runningRef.current) return;
    runningRef.current = true;
    setScreen("importing");
    setImportError("");

    const batches = [];
    for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
      batches.push(validRows.slice(i, i + BATCH_SIZE));
    }
    setProgress({ done: 0, total: validRows.length });

    const running = { imported: 0, updated: 0, skippedInvalid: invalidCount, skippedDuplicate: 0 };

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const body = new FormData();
      body.set("intent", "import_csv");
      body.set("consent", consent ? "1" : "0");
      body.set(
        "rows",
        JSON.stringify(
          batch.map((r) => ({
            email: r.email,
            name: r.name,
            phone: r.phone,
            tags: r.tags,
            props: r.props,
          })),
        ),
      );

      let json;
      try {
        const resp = await fetch(window.location.pathname + window.location.search, {
          method: "POST",
          body,
        });
        json = await resp.json();
      } catch {
        json = { ok: false, error: "The connection dropped." };
      }

      if (!json?.ok) {
        // Stop at the first failure and say exactly how far we got, so the
        // merchant can re-import the remainder rather than starting over or
        // double-importing.
        setImportError(
          `${json?.error || "Import failed."} ${running.imported + running.updated} of ${validRows.length} contacts were saved before this happened.`,
        );
        setTotals(running);
        setScreen("result");
        runningRef.current = false;
        return;
      }

      running.imported += json.imported || 0;
      running.updated += json.updated || 0;
      running.skippedDuplicate += json.skippedDuplicate || 0;
      running.skippedInvalid += json.skippedInvalid || 0;
      setProgress({ done: Math.min(validRows.length, (i + 1) * BATCH_SIZE), total: validRows.length });
    }

    setTotals(running);
    setScreen("result");
    runningRef.current = false;
  }

  useEffect(() => {
    if (!open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const downloadTemplate = () => {
    const csv =
      "email,name,phone,tags\njane@example.com,Jane Doe,+15551234567,\"VIP,wholesale\"\nbob@example.com,Bob Smith,,\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "retainify-contacts-template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const pctDone = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="rt-modal-backdrop" onClick={handleClose}>
      <div
        className="rt-save-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 620, maxHeight: "88vh", display: "flex", flexDirection: "column" }}
      >
        <div className="rt-save-head">
          <div className="t-micro">Contacts</div>
          <h2 className="t-h1">Import from CSV</h2>
        </div>

        <div className="rt-save-body" style={{ overflowY: "auto" }}>
          {/* ── 1. Choose a file ─────────────────────────────────────────── */}
          {screen === "upload" && (
            <>
              <div
                className={`rt-emb-uploader${dragOver ? " rt-emb-uploader-drag" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  loadFile(e.dataTransfer.files?.[0]);
                }}
                onClick={() => fileRef.current?.click()}
                style={{ cursor: "pointer" }}
              >
                <Icons.ArrowDown size={20} />
                <div className="t-small" style={{ marginTop: 8 }}>
                  Drop a CSV here, or click to browse
                </div>
                <div className="field-help" style={{ marginTop: 8 }}>
                  Up to 20MB. Needs a header row with an email column.
                </div>
              </div>
              {parseError && <div className="rt-emb-uploader-error">{parseError}</div>}
              <button className="rt-link" onClick={downloadTemplate} style={{ marginTop: 14 }}>
                Download a template CSV
              </button>
            </>
          )}

          {/* ── 2. Map columns + confirm consent ─────────────────────────── */}
          {screen === "map" && parsed && (
            <>
              <p className="t-small muted" style={{ marginTop: 0 }}>
                <strong>{fileName}</strong> · {parsed.rows.length.toLocaleString()} rows
              </p>

              <div className="t-micro muted" style={{ margin: "18px 0 10px" }}>Match your columns</div>
              <div style={{ display: "grid", gap: 12 }}>
                {[
                  { key: "email", label: "Email", required: true },
                  { key: "name", label: "Name", required: false },
                  { key: "phone", label: "Phone", required: false },
                  { key: "tags", label: "Tags", required: false },
                ].map((f) => (
                  <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <label className="field-label" style={{ width: 90, margin: 0 }} htmlFor={`map-${f.key}`}>
                      {f.label}{f.required && " *"}
                    </label>
                    <select
                      id={`map-${f.key}`}
                      className="select"
                      style={{ flex: 1 }}
                      value={mapping[f.key]}
                      onChange={(e) =>
                        setMapping((m) => ({ ...m, [f.key]: Number(e.target.value) }))
                      }
                    >
                      <option value={-1}>{f.required ? "Select a column…" : "Don't import"}</option>
                      {parsed.headers.map((h, i) => (
                        <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {properties.length > 0 && (
                <>
                  <div className="t-micro muted" style={{ margin: "20px 0 10px" }}>
                    Your custom properties
                  </div>
                  <div style={{ display: "grid", gap: 12 }}>
                    {properties.map((def) => (
                      <div key={def.key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <label
                          className="field-label"
                          style={{ width: 90, margin: 0 }}
                          htmlFor={`map-prop-${def.key}`}
                          title={def.label}
                        >
                          {def.label}
                        </label>
                        <select
                          id={`map-prop-${def.key}`}
                          className="select"
                          style={{ flex: 1 }}
                          value={propMapping[def.key] ?? -1}
                          onChange={(e) =>
                            setPropMapping((m) => ({ ...m, [def.key]: Number(e.target.value) }))
                          }
                        >
                          <option value={-1}>Don&apos;t import</option>
                          {parsed.headers.map((h, i) => (
                            <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {mapping.email !== -1 && (
                <>
                  <div className="t-micro muted" style={{ margin: "22px 0 10px" }}>
                    Preview · first 5 rows
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table className="t-small" style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid var(--hair-1)" }}>
                          <th style={{ padding: "6px 8px" }}>Email</th>
                          <th style={{ padding: "6px 8px" }}>Name</th>
                          <th style={{ padding: "6px 8px" }}>Tags</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mapped.slice(0, 5).map((r, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid var(--hair-1)" }}>
                            <td style={{ padding: "6px 8px", color: r.valid ? undefined : "var(--danger-ink)" }}>
                              {r.email || <em className="muted">(blank)</em>}
                              {!r.valid && " — invalid"}
                            </td>
                            <td style={{ padding: "6px 8px" }}>{r.name || "—"}</td>
                            <td style={{ padding: "6px 8px" }}>{r.tags.join(", ") || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="t-small" style={{ marginTop: 12 }}>
                    <strong>{validRows.length.toLocaleString()}</strong> importable
                    {invalidCount > 0 && (
                      <span className="muted"> · {invalidCount.toLocaleString()} skipped (invalid email)</span>
                    )}
                  </div>

                  {/* Consent gate */}
                  <label
                    className="t-small"
                    style={{
                      display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer",
                      marginTop: 20, padding: 14, borderRadius: 8,
                      border: "1px solid var(--hair-1)", background: "var(--paper-2)",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                      style={{ marginTop: 2 }}
                    />
                    <span>
                      These people agreed to receive marketing email from my store
                      <span className="muted" style={{ display: "block", marginTop: 4, lineHeight: 1.5 }}>
                        Required before Retainify will email them. Leave it unticked
                        to import them as contacts you can browse and segment but
                        not send to — you can subscribe them later.
                      </span>
                    </span>
                  </label>
                </>
              )}
            </>
          )}

          {/* ── 3. Progress ──────────────────────────────────────────────── */}
          {screen === "importing" && (
            <div style={{ padding: "24px 0" }}>
              <div className="t-body" style={{ marginBottom: 12 }}>
                Importing {progress.total.toLocaleString()} contacts…
              </div>
              <div
                style={{
                  height: 6, background: "var(--hair-1)", borderRadius: 3, overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${pctDone}%`, height: "100%", background: "var(--brand-700)",
                    transition: "width 200ms ease",
                  }}
                />
              </div>
              <div className="t-small muted" style={{ marginTop: 10 }}>
                {progress.done.toLocaleString()} of {progress.total.toLocaleString()} · {pctDone}%
              </div>
              <div className="field-help" style={{ marginTop: 14 }}>
                Keep this window open until it finishes.
              </div>
            </div>
          )}

          {/* ── 4. Result ────────────────────────────────────────────────── */}
          {screen === "result" && totals && (
            <div style={{ padding: "8px 0" }}>
              {importError ? (
                <div
                  className="t-small"
                  style={{
                    background: "var(--danger-bg)", color: "var(--danger-ink)",
                    padding: "10px 14px", borderRadius: "var(--r-2)", marginBottom: 16,
                  }}
                >
                  {importError}
                </div>
              ) : (
                <div className="t-h3" style={{ marginBottom: 12 }}>Import complete</div>
              )}
              <ul className="t-small" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
                <li><strong>{totals.imported.toLocaleString()}</strong> new contacts added</li>
                <li><strong>{totals.updated.toLocaleString()}</strong> existing contacts updated</li>
                {totals.skippedDuplicate > 0 && (
                  <li className="muted">{totals.skippedDuplicate.toLocaleString()} duplicate rows within the file</li>
                )}
                {totals.skippedInvalid > 0 && (
                  <li className="muted">{totals.skippedInvalid.toLocaleString()} rows skipped — invalid email</li>
                )}
              </ul>
              {!consent && (totals.imported > 0 || totals.updated > 0) && (
                <div className="field-help" style={{ marginTop: 16 }}>
                  These contacts were imported without marketing consent, so flows
                  won&apos;t email them. Subscribe them individually once you have
                  their permission.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rt-save-foot">
          <div className="rt-save-foot-left">
            {screen === "map" && (
              <button className="btn btn-ghost" onClick={() => setScreen("upload")}>
                Choose a different file
              </button>
            )}
          </div>
          <div className="rt-save-foot-right">
            <button
              className="btn btn-secondary"
              onClick={handleClose}
              disabled={screen === "importing"}
            >
              {screen === "result" ? "Done" : "Cancel"}
            </button>
            {screen === "map" && (
              <button
                className="btn btn-primary"
                onClick={runImport}
                disabled={mapping.email === -1 || validRows.length === 0}
              >
                Import {validRows.length.toLocaleString()} contacts
              </button>
            )}
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={(e) => loadFile(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}
