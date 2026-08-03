import { useMemo, useState } from "react";
import { CommonTimingFields } from "./shared.jsx";
import { sanitizePopupHtml, findMissingHooks, STARTER_HTML } from "./html-sanitize.js";

export function RenderCustom({ data, scale }) {
  // Scope merchant CSS to the popup wrapper so `body {}` / `:root {}` /
  // bare tag selectors don't leak into the admin page.
  const safe = useMemo(() => sanitizePopupHtml(data.html || "", ".tpl-custom"), [data.html]);
  return (
    <div
      className="tpl-custom"
      style={{ transform: scale ? `scale(${scale})` : undefined }}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}

export function EditorCustom({ data, onUpdate }) {
  const [showHooks, setShowHooks] = useState(true);
  const missing = findMissingHooks(data.html || "");

  return (
    <>
      <div className="rt-pop-section">
        <div className="rt-pop-section-h">HTML source</div>

        <div className="rt-pop-custom-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onUpdate({ html: STARTER_HTML })}
          >
            Load starter template
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowHooks((s) => !s)}
          >
            {showHooks ? "Hide" : "Show"} available hooks
          </button>
        </div>

        {showHooks && (
          <div className="rt-pop-hooks-panel">
            <div className="rt-pop-hooks-title">Wire your HTML to Retainify</div>
            <p className="rt-pop-hooks-lede">
              Add these attributes to elements in your HTML. Retainify handles email capture,
              discount codes, and popup close for you.
            </p>
            <ul className="rt-pop-hooks-list">
              <li><code>data-rt-email</code> <span>on your email <code>&lt;input&gt;</code> (required)</span></li>
              <li><code>data-rt-submit</code> <span>on your submit <code>&lt;button&gt;</code> (required)</span></li>
              <li><code>data-rt-close</code> <span>on your close/dismiss button (required — visitors need a way out)</span></li>
              <li><code>data-rt-status</code> <span>on an element where the “check your inbox” message should appear (optional)</span></li>
            </ul>
            <div className="rt-pop-hooks-note">
              <strong>Safety:</strong> <code>&lt;script&gt;</code>, <code>&lt;iframe&gt;</code>,
              inline event handlers (<code>onclick</code>, etc.), and <code>javascript:</code> URLs are stripped when the popup is displayed.
            </div>
          </div>
        )}

        <div className="rt-pop-field">
          <label className="field-label">HTML</label>
          <textarea
            className="textarea rt-pop-html-editor"
            spellCheck={false}
            rows={22}
            value={data.html || ""}
            onChange={(e) => onUpdate({ html: e.target.value })}
            placeholder="Paste your HTML here, or click ‘Load starter template’ above."
          />
          {missing.length > 0 && (
            <div className="rt-pop-validation-error">
              <strong>Missing required hooks:</strong>{" "}
              {missing.map((m, i) => (
                <span key={m}>
                  <code>{m}</code>{i < missing.length - 1 ? ", " : ""}
                </span>
              ))}
              . Your popup can’t capture emails without these — you won’t be able to save until they’re added.
            </div>
          )}
        </div>
      </div>

      <CommonTimingFields data={data} onUpdate={onUpdate} />
    </>
  );
}

export const customTemplate = {
  id: "custom",
  name: "Custom HTML",
  vibe: "Bring your own",
  oneliner: "Paste your own HTML + CSS. We handle email capture, discount codes, and timing.",
  tags: ["Custom", "HTML", "Advanced"],
  goal: "email_discount",
  Render: RenderCustom,
  Editor: EditorCustom,
  defaults: {
    template: "custom",
    html: STARTER_HTML,
    discount: 10,
    trigger: "delay",
    delay: "3",
    frequency: "session",
  },
};
