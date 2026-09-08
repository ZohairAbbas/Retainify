/**
 * A WhatsApp chat-bubble preview of a message template.
 *
 * Renders the whole Meta component spec — header (text or media), body, footer
 * and buttons — not just the body. A merchant approving a template in Business
 * Manager sees all four parts, so a preview that shows only the body leaves
 * them guessing about the half of the message that carries the call to action.
 *
 * The spec is Meta's own shape, as stored on WhatsappTemplate.components:
 *   [{ type: "HEADER", format: "TEXT"|"IMAGE"|"VIDEO"|"DOCUMENT", text? },
 *    { type: "BODY", text },
 *    { type: "FOOTER", text },
 *    { type: "BUTTONS", buttons: [{ type: "URL"|"QUICK_REPLY"|…, text, url? }] }]
 */

/** Pull one component by type out of a Meta spec array. */
function findComponent(components, type) {
  if (!Array.isArray(components)) return null;
  return components.find((c) => String(c?.type || "").toUpperCase() === type) || null;
}

/** Default variable rendering: leave {{n}} visible rather than invent data. */
const defaultRenderVar = (n) => `{{${n}}}`;

function substitute(text, renderVar) {
  return String(text || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => renderVar(Number(n)));
}

/**
 * @param {object} props
 * @param {Array} [props.components] - raw Meta component spec.
 * @param {string} [props.bodyText] - fallback body when `components` is absent.
 * @param {object} [props.buttonUrls] - real destinations by button index. Meta
 *   only ever sees our click redirect, so the spec's own URL is never the link
 *   the merchant chose — show theirs when we have it.
 * @param {string} [props.mediaUrl] - image to show for a media header.
 * @param {(n: number) => string} [props.renderVar] - how to display {{n}}.
 */
export default function TemplatePreview({
  components,
  bodyText = "",
  buttonUrls,
  mediaUrl = "",
  renderVar = defaultRenderVar,
}) {
  const header = findComponent(components, "HEADER");
  const body = findComponent(components, "BODY");
  const footer = findComponent(components, "FOOTER");
  const buttonsSpec = findComponent(components, "BUTTONS");
  const buttons = Array.isArray(buttonsSpec?.buttons) ? buttonsSpec.buttons : [];

  const headerFormat = String(header?.format || "TEXT").toUpperCase();
  const isMediaHeader = !!header && headerFormat !== "TEXT";
  const headerImage = isMediaHeader && headerFormat === "IMAGE" ? mediaUrl : "";
  const text = substitute(body?.text || bodyText, renderVar);

  return (
    <div style={{ background: "#E5DDD5", borderRadius: "var(--r-3)", padding: 16 }}>
      <div
        style={{
          background: "#FFFFFF",
          borderRadius: 8,
          maxWidth: 280,
          boxShadow: "0 1px 1px rgba(0,0,0,.12)",
          overflow: "hidden",
          fontFamily: "var(--font-ui)",
        }}
      >
        {/* Media header. Without a URL to show we still say the header exists —
            a blank space would read as a template that simply has none. */}
        {isMediaHeader &&
          (headerImage ? (
            <img
              src={headerImage}
              alt=""
              style={{ width: "100%", maxHeight: 140, objectFit: "cover", display: "block" }}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <div
              style={{
                background: "#F0F2F5",
                color: "#667781",
                fontSize: 11,
                textAlign: "center",
                padding: "22px 10px",
              }}
            >
              {headerFormat === "IMAGE"
                ? "Image header"
                : headerFormat === "VIDEO"
                  ? "Video header"
                  : "Document header"}
            </div>
          ))}

        <div style={{ padding: "8px 10px" }}>
          {header && !isMediaHeader && header.text && (
            <div style={{ fontSize: 13, fontWeight: 600, color: "#111", marginBottom: 4, lineHeight: 1.35 }}>
              {substitute(header.text, renderVar)}
            </div>
          )}

          <div style={{ fontSize: 13, color: "#111", lineHeight: 1.4, whiteSpace: "pre-wrap" }}>{text}</div>

          {footer?.text && (
            <div style={{ fontSize: 11, color: "#8696a0", marginTop: 6, lineHeight: 1.35 }}>
              {footer.text}
            </div>
          )}

          <div style={{ fontSize: 10, color: "#9aa0a6", textAlign: "right", marginTop: 4 }}>now</div>
        </div>

        {buttons.length > 0 && (
          <div style={{ borderTop: "1px solid #E9EDEF" }}>
            {buttons.map((b, idx) => {
              const isUrl = String(b?.type || "").toUpperCase() === "URL";
              const destination = buttonUrls?.[idx] || buttonUrls?.[String(idx)] || b?.url || "";
              return (
                <div
                  key={idx}
                  style={{
                    borderTop: idx === 0 ? "none" : "1px solid #E9EDEF",
                    padding: "8px 10px",
                    textAlign: "center",
                    fontSize: 13,
                    color: "#00A5F4",
                  }}
                >
                  {b?.text || (isUrl ? "Open link" : "Reply")}
                  {isUrl && destination && (
                    <div
                      className="t-micro"
                      style={{
                        color: "#8696a0",
                        marginTop: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {destination}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
