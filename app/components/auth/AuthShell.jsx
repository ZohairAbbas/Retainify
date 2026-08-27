/**
 * The chrome every signed-out page shares: login, signup, forgot, reset,
 * invite accept, welcome.
 *
 * A single component rather than a layout route, because these pages are
 * top-level (they must not sit under /app, which requires a session) and a
 * shared component keeps them consistent without inventing a pathless route
 * segment for six files.
 */
import { useId, useState } from "react";
import { Link } from "react-router";

export function AuthShell({ title, subtitle, children, footer, aside, trust }) {
  return (
    <div className="auth-page">
      <div className="auth-panel">
        <div className="auth-card">
          <Link to="/" className="auth-mark">
            <span className="rt-app-mark" aria-hidden="true">R</span>
            <span className="auth-mark-name">Retainify</span>
          </Link>

          <h1 className="auth-title">{title}</h1>
          {subtitle && <p className="auth-sub">{subtitle}</p>}

          {children}

          {trust && (
            <div className="auth-trust">
              <LockGlyph />
              <span>{trust}</span>
            </div>
          )}

          {footer && <div className="auth-foot">{footer}</div>}
        </div>
      </div>

      {/* Decorative: it repeats nothing the form needs, so it is hidden from
          assistive tech rather than read out as a wall of orphaned numbers. */}
      <aside className="auth-aside" aria-hidden="true">
        {aside || <ProductVignette />}
      </aside>
    </div>
  );
}

/**
 * The right panel.
 *
 * Shows the product rather than describing it — a campaign result and the flow
 * that produced it. Drawn entirely in CSS: nothing to load, nothing to block,
 * and it stays sharp on any display.
 */
function ProductVignette() {
  return (
    <div className="auth-aside-inner">
      <div className="auth-aside-eyebrow">Retainify</div>
      <p className="auth-quote">
        Every send, and <em>what it was worth.</em>
      </p>

      <div className="vig-card">
        <div className="vig-head">
          <span className="vig-title">Winter restock · Broadcast</span>
          <span className="vig-pill">Sent</span>
        </div>
        <div className="vig-stats">
          <div>
            <div className="vig-stat-label">Delivered</div>
            <div className="vig-stat-value">8,412</div>
          </div>
          <div>
            <div className="vig-stat-label">Opened</div>
            <div className="vig-stat-value">41.6%</div>
          </div>
          <div>
            <div className="vig-stat-label">Clicked</div>
            <div className="vig-stat-value">9.2%</div>
          </div>
        </div>
        <div className="vig-bar">
          <span style={{ width: "41.6%", background: "var(--accent)" }} />
          <span style={{ width: "9.2%", background: "rgba(244,239,228,0.55)" }} />
        </div>
      </div>

      <div className="vig-card">
        <div className="vig-head">
          <span className="vig-title">Welcome series</span>
          <span className="vig-pill">Live</span>
        </div>
        <div className="vig-flow">
          <div className="vig-step"><span className="vig-dot">1</span> Contact subscribes</div>
          <div className="vig-link" />
          <div className="vig-step"><span className="vig-dot">2</span> Wait 1 day</div>
          <div className="vig-link" />
          <div className="vig-step"><span className="vig-dot">3</span> Send &ldquo;Start here&rdquo;</div>
        </div>
      </div>

      <p className="vig-note">
        Contacts, segments, automated flows and one-off broadcasts — with the
        analytics to show which of them actually worked.
      </p>
    </div>
  );
}

function LockGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function AlertGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.5" />
    </svg>
  );
}

/**
 * Form-level error.
 *
 * `role="alert"` so a screen reader announces it the moment it appears — a
 * failed sign-in that only changes pixels is invisible to anyone not looking.
 */
export function FormError({ children }) {
  if (!children) return null;
  return (
    <div className="auth-error" role="alert">
      <AlertGlyph />
      <span>{children}</span>
    </div>
  );
}

export function FormNotice({ children, tone = "info" }) {
  if (!children) return null;
  return (
    <div className={`auth-notice auth-notice-${tone}`} role="status">
      <span>{children}</span>
    </div>
  );
}

export function Field({ label, name, type = "text", hint, error, id: idProp, ...rest }) {
  const auto = useId();
  const id = idProp || `f-${name}-${auto}`;
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className="auth-field">
      <label htmlFor={id} className="auth-label">{label}</label>
      <input
        id={id}
        name={name}
        type={type}
        className={`input${error ? " input-invalid" : ""}`}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={hintId}
        {...rest}
      />
      {hint && <div id={hintId} className="auth-hint">{hint}</div>}
    </div>
  );
}

/**
 * Password input with a reveal toggle.
 *
 * Worth the extra control: on a phone keyboard a mistyped password is the most
 * common reason a correct one gets rejected, and "type it again blind" is a bad
 * answer. The toggle is a real button so it is reachable by keyboard, and it
 * announces its state rather than relying on an icon swap.
 *
 * `action` renders beside the label — that is where a "Forgot?" link belongs,
 * inline with the field it concerns.
 */
export function PasswordField({ label, name, hint, error, action, ...rest }) {
  const auto = useId();
  const id = `p-${name}-${auto}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const [shown, setShown] = useState(false);

  return (
    <div className="auth-field">
      <div className="auth-row">
        <label htmlFor={id} className="auth-label">{label}</label>
        {action}
      </div>
      <div className="auth-pw">
        <input
          id={id}
          name={name}
          type={shown ? "text" : "password"}
          className={`input${error ? " input-invalid" : ""}`}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={hintId}
          {...rest}
        />
        <button
          type="button"
          className="auth-pw-toggle"
          onClick={() => setShown((v) => !v)}
          aria-pressed={shown}
          aria-label={shown ? "Hide password" : "Show password"}
        >
          {shown ? "Hide" : "Show"}
        </button>
      </div>
      {hint && <div id={hintId} className="auth-hint">{hint}</div>}
    </div>
  );
}
