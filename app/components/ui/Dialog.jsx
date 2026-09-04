/**
 * In-app confirm and prompt dialogs, plus a toast.
 *
 * These replace window.confirm() and window.prompt(), which were used for six
 * destructive or data-entry actions across Contacts and Segments. Native modals
 * are a poor fit here for two reasons: the Shopify admin renders the app inside
 * a sandboxed iframe that can block them outright — leaving bulk tagging and
 * save-as-segment simply inoperable — and even where they do render they are
 * visually foreign and cannot show context like "this will affect 1,240
 * contacts".
 */
import { useEffect, useRef, useState } from "react";
import Icons from "./Icons.jsx";

/** Close on Escape, and trap initial focus inside the dialog. */
function useDialogBehaviour(onCancel, focusRef) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    focusRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, focusRef]);
}

/**
 * Destructive-action confirmation.
 *
 * @param {object} props
 * @param {string} props.title
 * @param {string} [props.body]        supporting detail, e.g. the affected count
 * @param {string} [props.confirmLabel]
 * @param {boolean} [props.destructive] styles the confirm button as dangerous
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null);
  useDialogBehaviour(onCancel, confirmRef);

  return (
    <div className="rt-modal-backdrop" onClick={onCancel}>
      <div
        className="rt-publish-modal"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{ width: 440 }}
      >
        <h2 className="t-h1" style={{ margin: "0 0 8px" }}>{title}</h2>
        {body && (
          <p className="t-small muted" style={{ margin: "0 0 24px", lineHeight: 1.6 }}>{body}</p>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn btn-secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            className={destructive ? "btn btn-danger" : "btn btn-primary"}
            onClick={onConfirm}
            disabled={loading}
            style={
              destructive
                ? { background: "var(--danger-ink, #B02A20)", color: "#fff", borderColor: "transparent" }
                : undefined
            }
          >
            {loading ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Single-field text prompt. Replaces window.prompt for tag names and segment
 * names, both of which needed validation the native dialog cannot express.
 *
 * `choices` optionally adds one radio row beneath the field — for the case
 * where naming a thing and choosing its kind are the same decision, and asking
 * twice would be two dialogs for one thought. The chosen value arrives as
 * onConfirm's second argument, so callers that don't pass `choices` are
 * unaffected.
 *
 * @param {{ label?: string, initial?: string, options: Array<{value: string, label: string, hint?: string}> }} [choices]
 */
export function PromptDialog({
  title,
  body,
  label,
  placeholder = "",
  initialValue = "",
  confirmLabel = "Save",
  loading = false,
  choices,
  onConfirm,
  onCancel,
}) {
  const [value, setValue] = useState(initialValue);
  const [choice, setChoice] = useState(choices?.initial ?? choices?.options?.[0]?.value ?? "");
  const inputRef = useRef(null);
  useDialogBehaviour(onCancel, inputRef);

  const trimmed = value.trim();
  const submit = () => {
    if (trimmed) onConfirm(trimmed, choice);
  };

  return (
    <div className="rt-modal-backdrop" onClick={onCancel}>
      <div
        className="rt-publish-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{ width: 440 }}
      >
        <h2 className="t-h1" style={{ margin: "0 0 8px" }}>{title}</h2>
        {body && (
          <p className="t-small muted" style={{ margin: "0 0 18px", lineHeight: 1.6 }}>{body}</p>
        )}
        {label && <label className="field-label" htmlFor="rt-prompt-input">{label}</label>}
        <input
          id="rt-prompt-input"
          ref={inputRef}
          className="input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        {choices?.options?.length > 0 && (
          <div style={{ marginTop: 18 }}>
            {choices.label && <span className="field-label">{choices.label}</span>}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
              {choices.options.map((opt) => (
                <label
                  key={opt.value}
                  className="t-small"
                  style={{
                    display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer",
                    padding: "10px 12px", borderRadius: 8,
                    border: `1px solid ${choice === opt.value ? "var(--ink-1)" : "var(--hair-1)"}`,
                    background: choice === opt.value ? "var(--paper-2)" : "transparent",
                  }}
                >
                  <input
                    type="radio"
                    name="rt-prompt-choice"
                    value={opt.value}
                    checked={choice === opt.value}
                    onChange={() => setChoice(opt.value)}
                    style={{ marginTop: 2, flexShrink: 0 }}
                  />
                  <span>
                    <span style={{ fontWeight: 500, color: "var(--ink-1)" }}>{opt.label}</span>
                    {opt.hint && (
                      <span className="muted" style={{ display: "block", marginTop: 2, lineHeight: 1.5 }}>
                        {opt.hint}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 24 }}>
          <button className="btn btn-secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={loading || !trimmed}>
            {loading ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Transient confirmation message.
 *
 * Bulk actions previously gave no feedback at all — a merchant unsubscribed
 * 1,200 contacts and the page simply re-rendered, with no way to tell whether
 * anything had happened.
 */
export function Toast({ message, tone = "ok", onDismiss, duration = 5000 }) {
  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(onDismiss, duration);
    return () => clearTimeout(t);
  }, [message, duration, onDismiss]);

  if (!message) return null;
  return (
    <div className={`rt-toast rt-toast-${tone}`} role="status" aria-live="polite">
      <span>{message}</span>
      <button className="rt-toast-close" onClick={onDismiss} aria-label="Dismiss">
        <Icons.Close size={13} />
      </button>
    </div>
  );
}
