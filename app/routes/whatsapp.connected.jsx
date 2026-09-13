/**
 * Where Meta returns the merchant after Embedded Signup.
 *
 * Exchanges the authorization code, works out which WhatsApp Business account
 * was granted, stores it against the shop, and tells the merchant they can
 * close the tab. The settings page they came from notices on its own.
 *
 * ── When more than one account is granted ──────────────────────────────────
 * A login by someone who administers several WhatsApp Business accounts grants
 * all of them, and the redirect flow carries no WA_EMBEDDED_SIGNUP message
 * naming the one they picked. Guessing is not an option: attaching the wrong
 * business would send every later message from a number that isn't theirs. So
 * this asks. The granted token is parked in WhatsappConnectPending until they
 * answer, deliberately apart from any WhatsappAccount they already have live.
 *
 * Unauthenticated by necessity — Meta redirects the browser here, carrying no
 * app session. The `state` parameter is the signed link token minted for one
 * shop, and it is what makes this safe: without a valid signature there is no
 * shop to connect anything to. The choice below re-checks it for the same
 * reason, because a form post is no more trusted than the redirect was.
 */
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import prisma from "../db.server.js";
import { encryptSecret, decryptSecret } from "../lib/crypto/secrets.server.js";
import { verifyConnectToken, connectCallbackUrl } from "../lib/whatsapp/connect-link.server.js";
import {
  exchangeCodeForToken,
  discoverWabaIds,
  describeWabas,
  provisionWhatsappAccount,
} from "../lib/whatsapp/embedded-signup.server.js";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";

  // Coming back from a completed choice, not from Meta. The authorization code
  // is spent by then, so re-running the exchange would fail and overwrite a
  // success with an error — hence the redirect to a clean URL that carries the
  // outcome instead.
  if (url.searchParams.get("done") === "1") {
    return {
      ok: true,
      number: url.searchParams.get("n") || "",
      warning: url.searchParams.get("w") || "",
      templatesSynced: Number(url.searchParams.get("t")) || null,
    };
  }

  // Meta sends the merchant back here when they cancel, too.
  const denied = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (denied) return { ok: false, error: humanise(denied) };

  const check = verifyConnectToken(state);
  if (!check.ok) return { ok: false, error: check.error };
  if (!code) return { ok: false, error: "Meta didn't return an authorization code. Please try again." };

  // Must be the same value the dialog was built with. Both come from
  // connectCallbackUrl(), so they cannot drift apart.
  const tokenRes = await exchangeCodeForToken(code, { redirectUri: connectCallbackUrl() });
  if (!tokenRes.ok) return { ok: false, error: tokenRes.error };

  // The redirect flow carries no WA_EMBEDDED_SIGNUP message, so the accounts
  // are read back from the token itself.
  const found = await discoverWabaIds(tokenRes.accessToken);
  if (!found.ok) return { ok: false, error: found.error };

  if (found.wabaIds.length > 1) {
    await prisma.whatsappConnectPending.upsert({
      where: { shop: check.shop },
      create: {
        shop: check.shop,
        accessTokenEnc: encryptSecret(tokenRes.accessToken),
        tokenExpiresAt: tokenRes.expiresAt ?? null,
      },
      update: {
        accessTokenEnc: encryptSecret(tokenRes.accessToken),
        tokenExpiresAt: tokenRes.expiresAt ?? null,
      },
    });
    return {
      ok: false,
      choose: true,
      state,
      accounts: await describeWabas(tokenRes.accessToken, found.wabaIds),
    };
  }

  return finish(check.shop, tokenRes.accessToken, tokenRes.expiresAt ?? null, found.wabaIds[0]);
};

/** The merchant picked one of their accounts. */
export const action = async ({ request }) => {
  const form = await request.formData();
  const state = String(form.get("state") || "");
  const wabaId = String(form.get("wabaId") || "");

  const check = verifyConnectToken(state);
  if (!check.ok) return { ok: false, error: check.error };

  const pending = await prisma.whatsappConnectPending.findUnique({ where: { shop: check.shop } });
  if (!pending) {
    return { ok: false, error: "That connection has already been completed or has expired. Please start again." };
  }

  let accessToken;
  try {
    accessToken = decryptSecret(pending.accessTokenEnc);
  } catch (err) {
    return { ok: false, error: `Could not read the saved credentials: ${err.message}` };
  }

  // Only an account this token was actually granted. The form is a value from
  // the browser, and an id typed into it must not be able to attach an account
  // the merchant never authorised.
  const found = await discoverWabaIds(accessToken);
  if (!found.ok) return { ok: false, error: found.error };
  if (!found.wabaIds.includes(wabaId)) {
    return { ok: false, error: "That WhatsApp Business account wasn't part of this login. Please start again." };
  }

  const result = await finish(check.shop, accessToken, pending.tokenExpiresAt, wabaId);
  if (!result.ok) return result;

  await prisma.whatsappConnectPending.delete({ where: { shop: check.shop } }).catch(() => {});

  const done = new URLSearchParams({ done: "1" });
  if (result.number) done.set("n", result.number);
  if (result.warning) done.set("w", result.warning);
  if (result.templatesSynced) done.set("t", String(result.templatesSynced));
  return redirect(`/whatsapp/connected?${done}`);
};

async function finish(shop, accessToken, expiresAt, wabaId) {
  const result = await provisionWhatsappAccount({ shop, accessToken, expiresAt, wabaId });
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    number: result.account?.displayPhoneNumber || "",
    warning: result.warning || "",
    templatesSynced: result.templatesSynced ?? null,
  };
}

/** Meta's own text is usually fine; strip the plus-encoding it arrives with. */
function humanise(raw) {
  return String(raw).replace(/\+/g, " ");
}

const page = { font: "16px/1.6 system-ui, sans-serif", maxWidth: "34rem", margin: "12vh auto", padding: "0 1.5rem" };
const muted = { color: "#666", fontSize: ".9rem", margin: 0 };

export default function WhatsappConnected() {
  // A failed choice answers with actionData; a successful one redirects, so the
  // loader owns every success. Both hooks are read unconditionally — calling
  // one behind a condition changes hook order between renders.
  const actionData = useActionData();
  const loaderData = useLoaderData();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const data = actionData || loaderData;

  if (loaderData.choose && !actionData) {
    return (
      <div style={page}>
        <h1 style={{ fontSize: "1.25rem", margin: "0 0 .75rem" }}>Which account should we connect?</h1>
        <p style={{ color: "#444", margin: "0 0 1.25rem" }}>
          This login has access to more than one WhatsApp Business account. Pick the one this store
          sends from.
        </p>
        <Form method="post">
          <input type="hidden" name="state" value={data.state} />
          <div style={{ display: "flex", flexDirection: "column", gap: ".5rem", marginBottom: "1.25rem" }}>
            {data.accounts.map((account, i) => (
              <label
                key={account.id}
                htmlFor={`waba-${account.id}`}
                style={{
                  display: "flex", gap: ".75rem", alignItems: "flex-start", cursor: "pointer",
                  border: "1px solid #d8d8d8", borderRadius: 8, padding: ".75rem 1rem",
                }}
              >
                <input
                  type="radio"
                  id={`waba-${account.id}`}
                  name="wabaId"
                  value={account.id}
                  defaultChecked={i === 0}
                  style={{ marginTop: ".35rem" }}
                />
                <span>
                  <strong>{account.name || "WhatsApp Business account"}</strong>
                  <span style={{ display: "block", color: "#666", fontSize: ".9rem" }}>
                    {account.numbers.length ? account.numbers.join(", ") : "No phone number yet"}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <button
            type="submit"
            disabled={busy}
            style={{
              font: "inherit", padding: ".6rem 1.1rem", borderRadius: 6, border: 0,
              background: "#1f7a4d", color: "#fff", cursor: busy ? "default" : "pointer",
            }}
          >
            {busy ? "Connecting…" : "Connect this account"}
          </button>
        </Form>
      </div>
    );
  }

  return (
    <div style={page}>
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
          <p style={muted}>You can close this tab and go back to Retainify.</p>
        </>
      ) : (
        <>
          <p style={{ color: "#444", margin: "0 0 1rem" }}>{data.error}</p>
          <p style={muted}>Close this tab and start again from the WhatsApp page in your Retainify admin.</p>
        </>
      )}
    </div>
  );
}
