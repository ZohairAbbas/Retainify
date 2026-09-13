/**
 * Where Meta returns the merchant after Embedded Signup.
 *
 * Exchanges the authorization code, works out which WhatsApp Business account
 * was granted, stores it against the shop, and tells the merchant they can
 * close the tab. The settings page they came from notices on its own.
 *
 * Unauthenticated by necessity — Meta redirects the browser here, carrying no
 * app session. The `state` parameter is the signed link token minted for one
 * shop, and it is what makes this safe: without a valid signature there is no
 * shop to connect anything to.
 */
import { useLoaderData } from "react-router";
import { verifyConnectToken } from "../lib/whatsapp/connect-link.server.js";
import {
  exchangeCodeForToken,
  discoverWabaIds,
  provisionWhatsappAccount,
} from "../lib/whatsapp/embedded-signup.server.js";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";

  // Meta sends the merchant back here when they cancel, too.
  const denied = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (denied) return { ok: false, error: humanise(denied) };

  const check = verifyConnectToken(state);
  if (!check.ok) return { ok: false, error: check.error };
  if (!code) return { ok: false, error: "Meta didn't return an authorization code. Please try again." };

  const tokenRes = await exchangeCodeForToken(code);
  if (!tokenRes.ok) return { ok: false, error: tokenRes.error };

  // The redirect flow carries no WA_EMBEDDED_SIGNUP message, so the account is
  // read back from the token itself.
  const found = await discoverWabaIds(tokenRes.accessToken);
  if (!found.ok) return { ok: false, error: found.error };
  if (found.wabaIds.length > 1) {
    // Not silently picking one: guessing which of several accounts a merchant
    // meant would attach the wrong number to their shop, and every message
    // afterwards would go out from a business that isn't theirs.
    return {
      ok: false,
      error:
        "This login granted access to more than one WhatsApp Business account, so we can't tell which to connect. Re-run the connection and select just one.",
    };
  }

  const result = await provisionWhatsappAccount({
    shop: check.shop,
    accessToken: tokenRes.accessToken,
    expiresAt: tokenRes.expiresAt ?? null,
    wabaId: found.wabaIds[0],
  });
  if (!result.ok) return { ok: false, error: result.error };

  return {
    ok: true,
    number: result.account?.displayPhoneNumber || "",
    warning: result.warning || "",
    templatesSynced: result.templatesSynced ?? null,
  };
};

/** Meta's own text is usually fine; strip the plus-encoding it arrives with. */
function humanise(raw) {
  return String(raw).replace(/\+/g, " ");
}

export default function WhatsappConnected() {
  const data = useLoaderData();

  return (
    <div style={{ font: "16px/1.6 system-ui, sans-serif", maxWidth: "34rem", margin: "12vh auto", padding: "0 1.5rem" }}>
      <h1 style={{ fontSize: "1.25rem", margin: "0 0 .75rem" }}>
        {data.ok ? "WhatsApp connected" : "That didn't complete"}
      </h1>

      {data.ok ? (
        <>
          <p style={{ color: "#444", margin: "0 0 1rem" }}>
            {data.number ? `${data.number} is now connected to your store.` : "Your WhatsApp Business account is now connected."}
            {data.templatesSynced ? ` ${data.templatesSynced} message templates were imported.` : ""}
          </p>
          {data.warning && (
            <p style={{ color: "#7a4b00", background: "#fff5e0", padding: ".75rem 1rem", borderRadius: 6, margin: "0 0 1rem", fontSize: ".95rem" }}>
              {data.warning}
            </p>
          )}
          <p style={{ color: "#666", fontSize: ".9rem", margin: 0 }}>
            You can close this tab and go back to Retainify. Refresh the WhatsApp page to see it.
          </p>
        </>
      ) : (
        <>
          <p style={{ color: "#444", margin: "0 0 1rem" }}>{data.error}</p>
          <p style={{ color: "#666", fontSize: ".9rem", margin: 0 }}>
            Close this tab and start again from the WhatsApp page in your Retainify admin.
          </p>
        </>
      )}
    </div>
  );
}
