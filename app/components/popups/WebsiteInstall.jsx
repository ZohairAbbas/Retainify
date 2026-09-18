/**
 * Installing the popup on a website that isn't a Shopify store.
 *
 * Three steps, each showing its own state: list the domains the popup may run
 * on, paste one script tag, and see it confirmed live. The per-platform
 * instructions exist because "paste this in your <head>" is where most
 * merchants get stuck — every site builder hides that box somewhere else.
 */
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import Icons from "../ui/Icons.jsx";

const PLATFORMS = [
  {
    id: "html",
    label: "Any website (HTML)",
    steps: [
      "Open the HTML of your site's shared layout or template — the part every page uses.",
      "Paste the code just before the closing </head> tag (or before </body>).",
      "Save and publish.",
    ],
  },
  {
    id: "wordpress",
    label: "WordPress",
    steps: [
      "Install a header-code plugin such as WPCode (\"Insert Headers and Footers\"), or use your theme's own header scripts setting.",
      "Go to Code Snippets → Header & Footer and paste the code into the Header box.",
      "Save. If you use a caching plugin, clear its cache.",
    ],
  },
  {
    id: "wix",
    label: "Wix",
    steps: [
      "In your site's dashboard go to Settings → Custom code (under Advanced).",
      "Click + Add Custom Code, paste the code, and choose All pages · Load code once.",
      "Place it in Head, save, then publish your site.",
    ],
  },
  {
    id: "squarespace",
    label: "Squarespace",
    steps: [
      "Go to Settings → Advanced → Code Injection (called Developer tools → Code Injection on newer plans).",
      "Paste the code into the Header box and save.",
      "Code injection needs a Business plan or higher.",
    ],
  },
  {
    id: "webflow",
    label: "Webflow",
    steps: [
      "Open Site settings → Custom code.",
      "Paste the code into Head code and save.",
      "Publish the site — custom code only runs on the published site, not in the Designer.",
    ],
  },
  {
    id: "framer",
    label: "Framer",
    steps: [
      "Open Site Settings → General → Custom Code.",
      "Paste the code into \"End of <head> tag\" and save.",
      "Publish the site.",
    ],
  },
  {
    id: "gtm",
    label: "Google Tag Manager",
    steps: [
      "In your container, create a new tag of type Custom HTML and paste the code.",
      "Set the trigger to All Pages (Initialization or Page View).",
      "Save, then Submit and Publish the container.",
    ],
  },
];

function timeAgo(d) {
  if (!d) return "";
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

export default function WebsiteInstall({ embed, popup }) {
  const fetcher = useFetcher();
  const savedDomains = (embed.domains || []).join("\n");
  const [domains, setDomains] = useState(savedDomains);
  const [platform, setPlatform] = useState("html");
  const [copied, setCopied] = useState(false);
  // Keyed on the saved text, not the array, so an unrelated reload (toggling
  // the popup) doesn't wipe domains being typed.
  useEffect(() => setDomains(savedDomains), [savedDomains]);

  const snippet = `<script src="${embed.scriptUrl}" data-site="${embed.siteKey}" async></script>`;
  const hasDomains = (embed.domains || []).length > 0;
  const hasPopup = Boolean(popup?.template);
  const live = Boolean(popup?.enabled);
  const seen = Boolean(embed.lastSeenAt);
  const testUrl = hasDomains ? `https://${embed.domains[0]}/?rt_popup=preview` : "";
  const saving = fetcher.state !== "idle";
  const error = fetcher.data?.domainsError;
  const dirty = domains.trim() !== savedDomains;

  function copy() {
    navigator.clipboard?.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  const guide = PLATFORMS.find((p) => p.id === platform) || PLATFORMS[0];

  return (
    <section className="rt-wi" id="install" style={{ scrollMarginTop: 16 }}>
      <div className="rt-wi-head">
        <div>
          <h2 className="t-h3" style={{ margin: 0 }}>Install on your website</h2>
          <p className="t-small muted" style={{ margin: "4px 0 0" }}>
            Works on any site you can add a line of code to. Signups land in Contacts and can trigger your flows.
          </p>
        </div>
        <InstallStatus hasPopup={hasPopup} hasDomains={hasDomains} live={live} seen={seen} embed={embed} />
      </div>

      <ol className="rt-wi-steps">
        <li className={hasDomains ? "is-done" : ""}>
          <div className="rt-wi-step-h"><span className="rt-wi-num">1</span> Your website's domain</div>
          <p className="t-small muted">
            The popup only loads on these sites, so nobody can copy your code onto theirs. One per line;
            <code> yourstore.com</code> also covers <code>www.</code> and other subdomains.
          </p>
          <fetcher.Form method="post" className="rt-wi-domains">
            <input type="hidden" name="intent" value="save-domains" />
            <textarea
              className="textarea"
              name="domains"
              rows={2}
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="yourstore.com"
              aria-label="Website domains"
            />
            <button type="submit" className="btn btn-secondary btn-sm" disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save domains"}
            </button>
          </fetcher.Form>
          {error && <div className="t-small" style={{ color: "var(--danger-ink)", marginTop: 6 }}>{error}</div>}
          {fetcher.data?.truncated && <div className="t-small muted" style={{ marginTop: 6 }}>Only the first 10 domains were kept.</div>}
        </li>

        <li className={seen ? "is-done" : ""}>
          <div className="rt-wi-step-h"><span className="rt-wi-num">2</span> Paste this code into your site</div>
          <div className="rt-wi-code">
            <code>{snippet}</code>
            <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
              {copied ? <>Copied</> : <><Icons.Copy size={12} /> Copy</>}
            </button>
          </div>
          <div className="rt-wi-tabs" role="tablist" aria-label="Where to paste it">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={platform === p.id}
                className={platform === p.id ? "on" : ""}
                onClick={() => setPlatform(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <ol className="rt-wi-guide">
            {guide.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </li>

        <li className={seen && live ? "is-done" : ""}>
          <div className="rt-wi-step-h"><span className="rt-wi-num">3</span> Check it's working</div>
          <ul className="rt-wi-checks">
            <li className={hasPopup ? "ok" : ""}>{hasPopup ? "Popup chosen" : "Pick a popup below and save it"}</li>
            <li className={live ? "ok" : ""}>{live ? "Popup is switched on" : "Switch the popup on (toggle above)"}</li>
            <li className={seen ? "ok" : ""}>
              {seen
                ? `Seen on ${embed.lastSeenOrigin || "your site"} ${timeAgo(embed.lastSeenAt)}`
                : "Not seen on your site yet — open a page with the code on it, then refresh this page"}
            </li>
          </ul>
          {testUrl && (
            <p className="t-small muted" style={{ margin: "8px 0 0" }}>
              To see it straight away, ignoring "already shown": open{" "}
              <a href={testUrl} target="_blank" rel="noreferrer">{testUrl}</a>. Add{" "}
              <code>?rt_popup=preview</code> to any page on your site the same way.
            </p>
          )}
          <details className="rt-wi-trouble">
            <summary>Not showing up?</summary>
            <ul>
              <li>The page's domain must be in the list above — check for a typo, or a different domain your site redirects to.</li>
              <li>It shows once per visitor (per your frequency setting). Use the <code>?rt_popup=preview</code> link, or a private window.</li>
              <li>Clear your site builder's or caching plugin's cache after pasting, then republish.</li>
              <li>Ad blockers and strict privacy extensions can block it — test with them off.</li>
              <li>Open your browser console on the page: Retainify logs a warning there if the tag is missing its site key.</li>
            </ul>
          </details>
        </li>
      </ol>
    </section>
  );
}

function InstallStatus({ hasPopup, hasDomains, live, seen, embed }) {
  let tone = "warn";
  let text = "Not installed yet";
  if (seen && live && hasPopup) { tone = "ok"; text = `Live on ${embed.lastSeenOrigin || "your site"}`; }
  else if (seen && !live) { tone = "idle"; text = "Installed · popup paused"; }
  else if (!hasDomains) { text = "Add your domain to start"; }
  return <span className={`rt-wi-status rt-wi-status-${tone}`}><span className="rt-wi-dot" />{text}</span>;
}
