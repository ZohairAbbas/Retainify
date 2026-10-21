/**
 * Coexistence: a number that stays live in the merchant's WhatsApp Business app.
 *
 * Run: node --test app/lib/whatsapp/coexistence.db.test.js  (DATABASE_URL → scratch DB)
 *
 * The one thing that must never happen to such a number is POST /register:
 * it moves the number onto the Cloud API alone and signs it out of the app on
 * the merchant's phone — their chats, their customers, gone from their hand.
 * So these pin that we never call it, and that the account is still sendable
 * without it.
 */
import "../../test-support/db-guard.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.WHATSAPP_TOKEN_KEY ||= randomBytes(32).toString("base64");
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ||= "verify-token";

const { default: prisma } = await import("../../db.server.js");
const { provisionWhatsappAccount, webhookCallbackUrl } = await import("./embedded-signup.server.js");
const { registerWhatsappNumber } = await import("./index.server.js");

const SHOP = "__test__wa-coexistence";

/** Meta, as far as provisioning talks to it. Records every URL it is asked for. */
const realFetch = globalThis.fetch;
let calls = [];
function fakeMeta() {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || "GET" });
    const reply = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.includes("/register")) return reply({ success: true });
    if (u.includes("/phone_numbers")) return reply({ data: [{ id: "PN1", display_phone_number: "+1 555 0100" }] });
    if (u.includes("/subscribed_apps")) {
      return init.method === "POST"
        ? reply({ success: true })
        : reply({ data: [{ override_callback_uri: webhookCallbackUrl() }] });
    }
    return reply({ data: [] }); // templates, and anything else: empty
  };
}

async function clear() {
  await prisma.whatsappTemplate.deleteMany({ where: { shop: SHOP } });
  await prisma.whatsappAccount.deleteMany({ where: { shop: SHOP } });
  await prisma.shopSettings.deleteMany({ where: { shop: SHOP } });
}

test.beforeEach(async () => { await clear(); fakeMeta(); });
test.after(async () => { globalThis.fetch = realFetch; await clear(); await prisma.$disconnect(); });

const registerCalls = () => calls.filter((c) => c.url.includes("/register"));

test("a coexistence number is stored as such and is sendable without registering", async () => {
  const res = await provisionWhatsappAccount({
    shop: SHOP, accessToken: "tok", wabaId: "WABA1", connectionType: "coexistence",
  });
  assert.equal(res.ok, true);

  const account = await prisma.whatsappAccount.findUnique({ where: { shop: SHOP } });
  assert.equal(account.connectionType, "coexistence");
  // Stamped, so the page shows no PIN prompt and campaigns aren't held for one.
  assert.ok(account.registeredAt);
  assert.equal(registerCalls().length, 0);
});

test("registering a coexistence number is refused before Meta is asked", async () => {
  await provisionWhatsappAccount({ shop: SHOP, accessToken: "tok", wabaId: "WABA1", connectionType: "coexistence" });
  calls = [];

  const res = await registerWhatsappNumber(SHOP, "123456");
  assert.equal(res.ok, false);
  assert.match(res.error, /WhatsApp Business app/);
  assert.equal(calls.length, 0);
});

test("the ordinary flow is unchanged: cloud_api, and registration left to the merchant", async () => {
  await provisionWhatsappAccount({ shop: SHOP, accessToken: "tok", wabaId: "WABA1" });

  const account = await prisma.whatsappAccount.findUnique({ where: { shop: SHOP } });
  assert.equal(account.connectionType, "cloud_api");
  assert.equal(account.registeredAt, null);
});

test("moving from coexistence to a new number drops the old number's stamp", async () => {
  await provisionWhatsappAccount({ shop: SHOP, accessToken: "tok", wabaId: "WABA1", connectionType: "coexistence" });
  await provisionWhatsappAccount({ shop: SHOP, accessToken: "tok", wabaId: "WABA2", connectionType: "cloud_api" });

  const account = await prisma.whatsappAccount.findUnique({ where: { shop: SHOP } });
  assert.equal(account.connectionType, "cloud_api");
  assert.equal(account.registeredAt, null);
});
