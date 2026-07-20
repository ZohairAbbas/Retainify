import { useRef, useState } from "react";
import { useFetcher } from "react-router";
import Icons from "../ui/Icons.jsx";

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { headers: [], rows: [], error: "File is empty." };

  // Simple CSV parser — handles quoted fields with commas inside.
  const splitLine = (line) => {
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
  };

  const headers = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, ""));
  const emailIdx = headers.findIndex((h) => h === "email");
  if (emailIdx === -1) return { headers, rows: [], error: 'No "email" column found. First row must be a header with an "email" column.' };

  const nameIdx = headers.findIndex((h) => h === "name");
  const tagsIdx = headers.findIndex((h) => h === "tags");

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    const email = (cols[emailIdx] || "").trim().toLowerCase();
    if (!email) continue;
    const name = nameIdx !== -1 ? (cols[nameIdx] || "").trim() : "";
    const tagsRaw = tagsIdx !== -1 ? (cols[tagsIdx] || "").trim() : "";
    const tags = tagsRaw
      ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
      : [];
    rows.push({ email, name, tags, valid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) });
  }

  return { headers, rows, error: null };
}

const SCREENS = { upload: "upload", preview: "preview", result: "result" };

export default function ImportCsvModal({ open, onClose }) {
  const fetcher = useFetcher();
  const fileRef = useRef(null);
  const [screen, setScreen] = useState(SCREENS.upload);
  const [dragOver, setDragOver] = useState(false);
  const [parsed, setParsed] = useState(null); // { rows, error }
  const [fileName, setFileName] = useState("");

  const result = fetcher.data;
  const submitting = fetcher.state !== "idle";

  // Advance to result screen when fetch completes.
  if (fetcher.state === "idle" && result?.intent === "import_csv" && screen === SCREENS.preview) {
    setScreen(SCREENS.result);
  }

  if (!open) return null;

  const reset = () => {
    setScreen(SCREENS.upload);
    setParsed(null);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const loadFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = parseCSV(e.target.result || "");
      setParsed(result);
      setScreen(SCREENS.preview);
    };
    reader.readAsText(file);
  };

  const handleFileInput = (e) => loadFile(e.target.files?.[0]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    loadFile(e.dataTransfer.files?.[0]);
  };

  const submitImport = () => {
    if (!parsed) return;
    const fd = new FormData();
    fd.set("intent", "import_csv");
    fd.set("rows", JSON.stringify(parsed.rows));
    fetcher.submit(fd, { method: "post" });
  };

  const validRows = parsed?.rows.filter((r) => r.valid) ?? [];
  const invalidRows = parsed?.rows.filter((r) => !r.valid) ?? [];

  const downloadTemplate = () => {
    const csv = `email,name,tags\njane@example.com,Jane Doe,"VIP,wholesale"\nbob@example.com,Bob,`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "contacts-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rt-modal-backdrop" onClick={handleClose}>
      <div className="rt-sync-modal" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="rt-sync-head">
          <div>
            <div className="t-micro muted">
              {screen === SCREENS.upload && "Import"}
              {screen === SCREENS.preview && `Preview · ${fileName}`}
              {screen === SCREENS.result && "Import complete"}
            </div>
            <h2 className="t-h1" style={{ margin: "4px 0 0" }}>
              {screen === SCREENS.upload && "Import contacts"}
              {screen === SCREENS.preview && "Review your contacts"}
              {screen === SCREENS.result && "Done"}
            </h2>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={handleClose}
            aria-label="Close"
          >
            <Icons.Close size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="rt-sync-body">

          {/* ── Screen 1: Upload ── */}
          {screen === SCREENS.upload && (
            <>
              <p style={{ color: "var(--ink-2)", marginTop: 0 }}>
                Upload a CSV with an <strong>email</strong> column. Optionally include{" "}
                <strong>name</strong> and <strong>tags</strong> (comma-separated inside quotes).
                Contacts already in Retainify will be skipped.
              </p>

              {/* Drop zone */}
              <div
                className={`rt-csv-dropzone${dragOver ? " rt-csv-dragover" : ""}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                <Icons.ArrowDown size={24} style={{ color: "var(--ink-4)" }} />
                <div style={{ marginTop: 8, fontWeight: 500 }}>
                  {dragOver ? "Drop it!" : "Drop your CSV here or click to browse"}
                </div>
                <div className="t-small muted" style={{ marginTop: 4 }}>
                  .csv files only
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  style={{ display: "none" }}
                  onChange={handleFileInput}
                />
              </div>

              <div style={{ marginTop: 12, textAlign: "center" }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={downloadTemplate}
                >
                  <Icons.ArrowDown size={12} /> Download template
                </button>
              </div>
            </>
          )}

          {/* ── Screen 2: Preview ── */}
          {screen === SCREENS.preview && parsed && (
            <>
              {parsed.error && (
                <div className="rt-sync-done" style={{ marginBottom: 16 }}>
                  <div className="rt-sync-check" style={{ background: "var(--danger-bg)", color: "var(--danger-ink)" }}>
                    <Icons.Close size={20} />
                  </div>
                  <div>
                    <div className="t-h2">Could not read file</div>
                    <div className="muted">{parsed.error}</div>
                  </div>
                </div>
              )}

              {!parsed.error && (
                <>
                  <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
                    <div style={{ flex: 1, padding: "10px 14px", background: "var(--paper-2)", borderRadius: "var(--r-2)", border: "1px solid var(--hair-1)" }}>
                      <div className="t-micro muted">Will import</div>
                      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>
                        {validRows.length.toLocaleString()}
                      </div>
                    </div>
                    {invalidRows.length > 0 && (
                      <div style={{ flex: 1, padding: "10px 14px", background: "var(--warn-bg)", borderRadius: "var(--r-2)", border: "1px solid var(--hair-1)" }}>
                        <div className="t-micro muted">Invalid email (skip)</div>
                        <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>
                          {invalidRows.length.toLocaleString()}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Preview table — first 5 valid rows */}
                  {validRows.length > 0 && (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid var(--hair-1)" }}>
                            <th style={{ padding: "4px 8px", textAlign: "left", fontWeight: 500, color: "var(--ink-3)" }}>Email</th>
                            <th style={{ padding: "4px 8px", textAlign: "left", fontWeight: 500, color: "var(--ink-3)" }}>Name</th>
                            <th style={{ padding: "4px 8px", textAlign: "left", fontWeight: 500, color: "var(--ink-3)" }}>Tags</th>
                          </tr>
                        </thead>
                        <tbody>
                          {validRows.slice(0, 5).map((r, i) => (
                            <tr key={i} style={{ borderBottom: "1px solid var(--hair-1)" }}>
                              <td style={{ padding: "5px 8px" }}>{r.email}</td>
                              <td style={{ padding: "5px 8px", color: "var(--ink-3)" }}>{r.name || "—"}</td>
                              <td style={{ padding: "5px 8px", color: "var(--ink-3)" }}>{r.tags.join(", ") || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {validRows.length > 5 && (
                        <div className="t-small muted" style={{ padding: "6px 8px" }}>
                          + {(validRows.length - 5).toLocaleString()} more rows
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ── Screen 3: Result ── */}
          {screen === SCREENS.result && result && (
            <div className="rt-sync-done">
              <div className="rt-sync-check" style={{ background: "var(--success-bg)", color: "var(--success-ink)" }}>
                <Icons.Check size={20} />
              </div>
              <div>
                <div className="t-h2">
                  {result.imported === 0
                    ? "No new contacts"
                    : `${result.imported.toLocaleString()} contact${result.imported === 1 ? "" : "s"} imported`}
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  {result.skippedDuplicate > 0 && `${result.skippedDuplicate} already existed · `}
                  {result.skippedInvalid > 0 && `${result.skippedInvalid} skipped (invalid email)`}
                  {result.skippedDuplicate === 0 && result.skippedInvalid === 0 && "All rows were imported successfully."}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="rt-sync-foot">
          {screen === SCREENS.upload && (
            <button type="button" className="btn btn-ghost" onClick={handleClose}>
              Cancel
            </button>
          )}

          {screen === SCREENS.preview && (
            <>
              <button type="button" className="btn btn-ghost" onClick={reset}>
                Back
              </button>
              {!parsed?.error && validRows.length > 0 && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={submitImport}
                  disabled={submitting}
                >
                  <Icons.ArrowDown size={14} />
                  {submitting ? "Importing…" : `Import ${validRows.length.toLocaleString()} contact${validRows.length === 1 ? "" : "s"}`}
                </button>
              )}
              {(parsed?.error || validRows.length === 0) && (
                <button type="button" className="btn btn-ghost" onClick={reset}>
                  Try another file
                </button>
              )}
            </>
          )}

          {screen === SCREENS.result && (
            <button type="button" className="btn btn-primary" onClick={handleClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
