/**
 * Admin side of the popup kit: a preview and an editor for each kit template.
 *
 * The preview renders exactly the HTML the storefront will — same function,
 * same CSS — so what the merchant sees here is what shoppers get.
 */
import { rtPopupKit } from "./kit.js";
import { TextField, SegField, PaletteRowWithCustom, CommonTimingFields } from "./shared.jsx";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Same allow-list as the storefront's sanitizeRichHtml: <em>, <br> and
// <span class="accent">. Everything else is shown as text.
function rich(s) {
  if (s == null) return "";
  // The trailing "|<" catches a lone "<" with no ">" after it, which would
  // otherwise pass through raw and open a tag in the preview.
  return String(s).replace(/<[^>]*>|[^<]+|</g, (part) => {
    if (part.charAt(0) !== "<") return part.replace(/&/g, "&amp;");
    if (/^<\/?em\s*>$/i.test(part) || /^<br\s*\/?\s*>$/i.test(part)) return part.toLowerCase();
    if (/^<span\s+class="accent"\s*>$/i.test(part)) return '<span class="accent">';
    if (/^<\/span\s*>$/i.test(part)) return "</span>";
    return esc(part);
  });
}

const PREVIEW = rtPopupKit({ esc, rich, wa: () => "", preview: true });
export const KIT_PALETTES = PREVIEW.palettes;

function KitRender({ id, data }) {
  const t = PREVIEW.templates[id];
  const html = t.render(data || {});
  const wrap = t.mount === "bar" ? { width: 720 } : null;
  return (
    <div style={wrap || undefined}>
      {/* Raw, not {t.css}: React escapes quotes and ">" in a text child,
          which a <style> element keeps literally — breaking the font names
          and child selectors, and the hydration match. */}
      <style dangerouslySetInnerHTML={{ __html: t.css }} />
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

const PALETTE_OPTIONS = Object.entries(PREVIEW.palettes).map(([id, p]) => ({
  id,
  label: id,
  colors: [p.bg, p.accent, p.ink],
}));

function Textarea({ label, value, onChange, rows = 3, help }) {
  return (
    <div className="rt-pop-field">
      <label className="field-label">{label}</label>
      <textarea className="textarea" rows={rows} value={value || ""} onChange={(e) => onChange(e.target.value)} />
      {help && <div className="field-help">{help}</div>}
    </div>
  );
}

const RICH_HELP = "Use <em>…</em> for accent words.";

/** Build a kit template's editor from a list of fields. */
function makeEditor(fields, { discount = true, extra } = {}) {
  return function KitEditor({ data, onUpdate }) {
    return (
      <>
        <div className="rt-pop-section">
          <div className="rt-pop-section-h">Content</div>
          {extra && extra({ data, onUpdate })}
          {fields.map(([key, label, kind, help]) =>
            kind === "textarea" ? (
              <Textarea key={key} label={label} value={data[key]} onChange={(v) => onUpdate({ [key]: v })} help={help} />
            ) : (
              <TextField
                key={key}
                label={label}
                value={data[key]}
                type={kind === "number" ? "number" : "text"}
                onChange={(v) => onUpdate({ [key]: v })}
                help={help || (kind === "rich" ? RICH_HELP : undefined)}
              />
            ),
          )}
        </div>
        <div className="rt-pop-section">
          <div className="rt-pop-section-h">Style</div>
          <PaletteRowWithCustom
            label="Colours"
            value={data.palette}
            onChange={(v) => onUpdate({ palette: v })}
            options={PALETTE_OPTIONS}
            slots={[
              { key: "bg", label: "Background" },
              { key: "ink", label: "Text" },
              { key: "accent", label: "Accent & button" },
            ]}
            customValue={data.paletteCustom}
            onCustomChange={(v) => onUpdate({ paletteCustom: v })}
          />
        </div>
        <CommonTimingFields data={data} onUpdate={onUpdate} showDiscount={discount} />
      </>
    );
  };
}

function kitTemplate(meta, fields, editorOpts) {
  const Render = ({ data }) => <KitRender id={meta.id} data={data} />;
  Render.displayName = `Render_${meta.id}`;
  return { ...meta, kit: true, mount: PREVIEW.templates[meta.id].mount, Render, Editor: makeEditor(fields, editorOpts) };
}

const FINE = "By subscribing you agree to receive marketing emails. Unsubscribe anytime.";

export const spotlightTemplate = kitTemplate(
  {
    id: "spotlight",
    name: "The Offer",
    vibe: "Bold · Centered",
    oneliner: "One big number, one field, one button — the layout that converts best for first-order discounts.",
    tags: ["Email capture", "Discount", "High converting"],
    goal: "email_discount",
    defaults: {
      template: "spotlight",
      palette: "cream",
      eyebrow: "Welcome offer",
      offerLabel: "off your <em>first order</em>",
      body: "Join the list for early access to new arrivals and members-only offers.",
      placeholder: "Email address",
      cta: "Unlock my discount",
      declineText: "No thanks, I'll pay full price",
      fine: FINE,
      discount: 15,
      trigger: "delay",
      delay: "7",
      frequency: "session",
    },
  },
  [
    ["eyebrow", "Eyebrow"],
    ["offerLabel", "Under the number", "rich"],
    ["body", "Body", "textarea"],
    ["placeholder", "Email placeholder"],
    ["cta", "Button label"],
    ["declineText", "Decline link", "text", "Leave empty to hide. A polite way out lifts signups — it reads as a choice, not a trap."],
    ["fine", "Fine print"],
  ],
);

export const twostepTemplate = kitTemplate(
  {
    id: "twostep",
    name: "Yes / No",
    vibe: "Two-step · Micro-yes",
    oneliner: "Asks a one-click question first, then the email. Small first step, noticeably more signups.",
    tags: ["Email capture", "Two-step", "High converting"],
    goal: "email_discount",
    defaults: {
      template: "twostep",
      palette: "sage",
      eyebrow: "Quick question",
      headline: "Want <em>15% off</em> your first order?",
      body: "It takes ten seconds and the code is yours.",
      yesText: "Yes, I want 15% off",
      noText: "No thanks, I'll pay full price",
      headline2: "Where should we <em>send it?</em>",
      body2: "Your code arrives as soon as you confirm your email.",
      placeholder: "Email address",
      cta: "Send my code",
      fine: FINE,
      discount: 15,
      trigger: "delay",
      delay: "7",
      frequency: "session",
      previewStep: "1",
    },
  },
  [
    ["eyebrow", "Eyebrow"],
    ["headline", "Question", "rich"],
    ["body", "Body", "textarea"],
    ["yesText", "Yes button"],
    ["noText", "No button"],
    ["headline2", "Step 2 headline", "rich"],
    ["body2", "Step 2 body", "textarea"],
    ["placeholder", "Email placeholder"],
    ["cta", "Submit button"],
    ["fine", "Fine print"],
  ],
  {
    extra: ({ data, onUpdate }) => (
      <SegField
        label="Preview"
        value={String(data.previewStep || "1")}
        onChange={(v) => onUpdate({ previewStep: v })}
        options={[{ value: "1", label: "Step 1 · question" }, { value: "2", label: "Step 2 · email" }]}
      />
    ),
  },
);

export const slideinTemplate = kitTemplate(
  {
    id: "slidein",
    name: "Corner Note",
    vibe: "Quiet · Slide-in",
    oneliner: "A small card in the corner that never covers the page. Kind to mobile visitors and to SEO.",
    tags: ["Email capture", "Non-intrusive", "Slide-in"],
    goal: "email_discount",
    defaults: {
      template: "slidein",
      palette: "cream",
      headline: "A little <em>welcome gift</em>",
      body: "10% off your first order when you join our list.",
      placeholder: "Email address",
      cta: "Get 10%",
      fine: "No spam. Unsubscribe anytime.",
      discount: 10,
      trigger: "scroll",
      delay: "3",
      frequency: "day",
    },
  },
  [
    ["headline", "Headline", "rich"],
    ["body", "Body", "textarea"],
    ["placeholder", "Email placeholder"],
    ["cta", "Button label"],
    ["fine", "Fine print"],
  ],
);

export const countdownTemplate = kitTemplate(
  {
    id: "countdown",
    name: "Last Call",
    vibe: "Urgent · Countdown",
    oneliner: "A real per-visitor timer. The deadline is set once and never resets, so the urgency is honest.",
    tags: ["Email capture", "Urgency", "Timer"],
    goal: "email_discount",
    defaults: {
      template: "countdown",
      palette: "midnight",
      eyebrow: "Offer ends in",
      minutes: 15,
      headline: "<em>20% off</em> — for the next few minutes",
      body: "Sign up before the timer runs out and your code is yours to use today.",
      placeholder: "Email address",
      cta: "Claim before it's gone",
      fine: FINE,
      discount: 20,
      trigger: "exit",
      delay: "3",
      frequency: "week",
    },
  },
  [
    ["eyebrow", "Label above the timer"],
    ["minutes", "Minutes on the clock", "number", "Starts the first time this visitor sees it and survives page reloads."],
    ["headline", "Headline", "rich"],
    ["body", "Body", "textarea"],
    ["placeholder", "Email placeholder"],
    ["cta", "Button label"],
    ["fine", "Fine print"],
  ],
);

export const newsletterTemplate = kitTemplate(
  {
    id: "newsletter",
    name: "The Dispatch",
    vibe: "Content · No discount",
    oneliner: "A newsletter signup that sells the content, not a coupon. For blogs, services, SaaS and any site without a shop.",
    tags: ["Newsletter", "No discount", "Any website"],
    goal: "newsletter",
    defaults: {
      template: "newsletter",
      palette: "cream",
      eyebrow: "The weekly dispatch",
      headline: "Notes worth <em>opening.</em>",
      body: "One short email a week with what we're making, reading and learning.",
      bullets: "Practical ideas you can use the same day\nEarly access to new launches\nNo fluff — unsubscribe in one click",
      proof: "Join 2,000+ readers",
      placeholder: "you@example.com",
      cta: "Subscribe",
      fine: "We send one email a week. Unsubscribe anytime.",
      discount: 0,
      trigger: "scroll",
      delay: "3",
      frequency: "week",
    },
  },
  [
    ["eyebrow", "Kicker"],
    ["headline", "Headline", "rich"],
    ["body", "Body", "textarea"],
    ["bullets", "Benefits (one per line)", "textarea"],
    ["proof", "Social proof line", "text", "e.g. \"Join 2,000+ readers\". Leave empty to hide — never inflate it."],
    ["placeholder", "Email placeholder"],
    ["cta", "Button label"],
    ["fine", "Fine print"],
  ],
  { discount: false },
);

export const barTemplate = kitTemplate(
  {
    id: "bar",
    name: "Announcement Bar",
    vibe: "Minimal · Top bar",
    oneliner: "A slim strip across the top with an inline email field. The least intrusive way to ask.",
    tags: ["Email capture", "Minimal", "Top bar"],
    goal: "email_discount",
    defaults: {
      template: "bar",
      palette: "ink",
      headline: "Get <em>10% off</em> your first order —",
      placeholder: "Email address",
      cta: "Get 10% off",
      discount: 10,
      trigger: "delay",
      delay: "3",
      frequency: "day",
    },
  },
  [
    ["headline", "Message", "rich"],
    ["placeholder", "Email placeholder"],
    ["cta", "Button label"],
  ],
);

export const KIT_TEMPLATES = [
  spotlightTemplate,
  twostepTemplate,
  slideinTemplate,
  countdownTemplate,
  newsletterTemplate,
  barTemplate,
];
