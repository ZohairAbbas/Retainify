/**
 * The trunk-zero repair script: what it fixes, and what it must never touch.
 *
 * Run: npm test   (or: node --test app/lib/whatsapp/phone-repair.db.test.js)
 *
 * The script rewrites stored phones and reverses suppressions, which makes it
 * the most dangerous thing in this fix pack: run wrong, it messages people who
 * asked not to be messaged. The properties pinned here are the ones where a
 * mistake is not recoverable and not visible.
 *
 *   1. Dry run is the default and writes nothing.
 *   2. A genuine opt-out is never re-subscribed — not via the subscription, not
 *      via a STOP suppression, not via the contact flag.
 *   3. A suppression that was only ever OUR formatting error is removed.
 *   4. A collision on [shop, phoneNumber] merges, never duplicates or throws.
 *
 * The script is executed as a real child process rather than imported, because
 * "dry run writes nothing" is a claim about the actual entry point — including
 * its argv handling — and importing a function would test something else.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const run = promisify(execFile);
const { default: prisma } = await import("../../db.server.js");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, "../../../scripts/repair-pk-trunk-zero-phones.mjs");

const SHOP = "__test__phone-repair";
const BROKEN = "9203001234567";
const FIXED = "923001234567";

/** The other broken number, used for the collision case. */
const BROKEN_2 = "9203009999999";
const FIXED_2 = "923009999999";

async function repairScript(...args) {
  const { stdout } = await run(process.execPath, [SCRIPT, ...args], {
    cwd: path.resolve(HERE, "../../.."),
    env: process.env,
  });
  return stdout;
}

async function cleanup() {
  await prisma.whatsappSuppression.deleteMany({ where: { shop: SHOP } });
  await prisma.whatsappSubscription.deleteMany({ where: { shop: SHOP } });
  await prisma.contact.deleteMany({ where: { shop: SHOP } });
}

test.beforeEach(cleanup);
test.after(cleanup);

test("dry run is the default and writes nothing", async () => {
  await prisma.whatsappSubscription.create({
    data: { shop: SHOP, phoneNumber: BROKEN, contactEmail: "a@example.test", status: "invalid" },
  });
  await prisma.whatsappSuppression.create({
    data: { shop: SHOP, phoneNumber: BROKEN, reason: "invalid" },
  });

  const out = await repairScript();
  assert.match(out, /DRY RUN/);

  // Every row is exactly as it was.
  const sub = await prisma.whatsappSubscription.findFirst({ where: { shop: SHOP } });
  assert.equal(sub.phoneNumber, BROKEN, "dry run must not rewrite the phone");
  assert.equal(sub.status, "invalid", "dry run must not change status");
  assert.equal(
    await prisma.whatsappSuppression.count({ where: { shop: SHOP } }),
    1,
    "dry run must not delete suppressions",
  );

  // It still reports what it WOULD do, and reports it without phone numbers.
  assert.match(out, /subs_restored=1/);
  assert.match(out, /supp_invalid_removed=1/);
  assert.doesNotMatch(out, /\d{10}/, "no phone number may appear in the output");
});

test("--apply repairs a formatting-only invalid: phone corrected, subscriber restored", async () => {
  await prisma.whatsappSubscription.create({
    data: { shop: SHOP, phoneNumber: BROKEN, contactEmail: "a@example.test", status: "invalid" },
  });
  await prisma.whatsappSuppression.create({
    data: { shop: SHOP, phoneNumber: BROKEN, reason: "invalid" },
  });
  await prisma.contact.create({
    data: { shop: SHOP, email: "a@example.test", phone: BROKEN, whatsappStatus: "invalid" },
  });

  await repairScript("--apply");

  const sub = await prisma.whatsappSubscription.findFirst({ where: { shop: SHOP } });
  assert.equal(sub.phoneNumber, FIXED);
  assert.equal(sub.status, "subscribed", "an invalid caused by our formatting is reversible");

  assert.equal(
    await prisma.whatsappSuppression.count({ where: { shop: SHOP } }),
    0,
    "the invalid suppression was never the buyer's decision",
  );

  const contact = await prisma.contact.findUnique({
    where: { shop_email: { shop: SHOP, email: "a@example.test" } },
  });
  assert.equal(contact.phone, FIXED);
  assert.equal(contact.whatsappStatus, "subscribed");
});

test("an opted-out subscription is corrected but NEVER re-subscribed", async () => {
  // The buyer said stop. The number is still fixed so future lookups match,
  // but consent does not come back.
  await prisma.whatsappSubscription.create({
    data: {
      shop: SHOP,
      phoneNumber: BROKEN,
      contactEmail: "out@example.test",
      status: "unsubscribed",
      optOutAt: new Date(),
    },
  });
  await prisma.contact.create({
    data: { shop: SHOP, email: "out@example.test", phone: BROKEN, whatsappStatus: "unsubscribed" },
  });

  await repairScript("--apply");

  const sub = await prisma.whatsappSubscription.findFirst({ where: { shop: SHOP } });
  assert.equal(sub.phoneNumber, FIXED, "the number is still corrected");
  assert.equal(sub.status, "unsubscribed", "an opt-out survives the repair");
  assert.ok(sub.optOutAt, "the opt-out timestamp is preserved");

  const contact = await prisma.contact.findUnique({
    where: { shop_email: { shop: SHOP, email: "out@example.test" } },
  });
  assert.equal(contact.whatsappStatus, "unsubscribed");
});

test("a STOP suppression is carried across, not removed", async () => {
  // reason "opt_out" is Meta/the buyer talking, unlike "invalid" which is us.
  await prisma.whatsappSuppression.create({
    data: { shop: SHOP, phoneNumber: BROKEN, reason: "opt_out" },
  });
  await prisma.contact.create({
    data: { shop: SHOP, email: "stop@example.test", phone: BROKEN, whatsappStatus: "invalid" },
  });

  await repairScript("--apply");

  const supp = await prisma.whatsappSuppression.findFirst({ where: { shop: SHOP } });
  assert.ok(supp, "a real opt-out suppression must survive");
  assert.equal(supp.phoneNumber, FIXED, "and must follow the corrected number");
  assert.equal(supp.reason, "opt_out");

  // The contact was "invalid", but the surviving suppression outranks a restore:
  // restoring here would message someone holding an active STOP.
  const contact = await prisma.contact.findUnique({
    where: { shop_email: { shop: SHOP, email: "stop@example.test" } },
  });
  assert.equal(contact.phone, FIXED);
  assert.notEqual(contact.whatsappStatus, "subscribed", "a STOP blocks the restore");
});

test("a collision on the corrected number merges instead of duplicating", async () => {
  // Both spellings of the same person exist. [shop, phoneNumber] is unique, so a
  // naive rewrite would throw; the rows must fold together.
  await prisma.whatsappSubscription.create({
    data: {
      shop: SHOP,
      phoneNumber: BROKEN_2,
      contactEmail: "dup@example.test",
      status: "invalid",
      optInAt: new Date("2026-01-01"),
    },
  });
  await prisma.whatsappSubscription.create({
    data: {
      shop: SHOP,
      phoneNumber: FIXED_2,
      contactEmail: "dup@example.test",
      status: "subscribed",
      confirmedAt: new Date("2026-02-01"),
      optInAt: new Date("2026-02-01"),
    },
  });

  await repairScript("--apply");

  const rows = await prisma.whatsappSubscription.findMany({ where: { shop: SHOP } });
  assert.equal(rows.length, 1, "exactly one row survives — merged, not duplicated");
  assert.equal(rows[0].phoneNumber, FIXED_2);
  assert.equal(rows[0].status, "subscribed");
  assert.ok(rows[0].confirmedAt, "the real confirmation is kept");
  assert.equal(
    rows[0].optInAt.toISOString().slice(0, 10),
    "2026-01-01",
    "the earlier evidenced opt-in wins",
  );
});

test("a collision where either side opted out stays opted out", async () => {
  await prisma.whatsappSubscription.create({
    data: { shop: SHOP, phoneNumber: BROKEN_2, contactEmail: "m@example.test", status: "invalid" },
  });
  await prisma.whatsappSubscription.create({
    data: {
      shop: SHOP,
      phoneNumber: FIXED_2,
      contactEmail: "m@example.test",
      status: "unsubscribed",
      optOutAt: new Date("2026-03-01"),
    },
  });

  await repairScript("--apply");

  const rows = await prisma.whatsappSubscription.findMany({ where: { shop: SHOP } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "unsubscribed", "merging must not launder an opt-out");
  assert.ok(rows[0].optOutAt);
});

test("a correctly-stored number is not touched at all", async () => {
  await prisma.whatsappSubscription.create({
    data: { shop: SHOP, phoneNumber: FIXED, contactEmail: "ok@example.test", status: "invalid" },
  });

  const out = await repairScript("--apply");

  const sub = await prisma.whatsappSubscription.findFirst({ where: { shop: SHOP } });
  assert.equal(sub.phoneNumber, FIXED);
  assert.equal(
    sub.status,
    "invalid",
    "a genuine invalid on a well-formed number is a real dead recipient",
  );
  assert.match(out, /No rows match|nothing to do/i);
});
