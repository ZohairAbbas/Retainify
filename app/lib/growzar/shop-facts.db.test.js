/**
 * The shop's country comes from its primary location, never its billing
 * address, and a token that cannot read locations makes it unknown (null)
 * rather than leaving a stale value or guessing.
 */
import "../../test-support/db-guard.js";
import test from "node:test";
import assert from "node:assert/strict";

const { default: prisma } = await import("../../db.server.js");
const { getShopFacts, readShopFacts, isMissingScope } = await import("./shop-facts.server.js");

const SHOP = "retainify-test-g5facts.myshopify.com";

/** An Admin client stub answering the two queries by name. */
function admin({ shop = { currencyCode: "PKR", ianaTimezone: "Asia/Karachi" }, location }) {
  return {
    async graphql(q) {
      if (q.includes("GrowzarShopFacts")) return Response.json({ data: { shop } });
      if (location instanceof Error) throw location;
      return Response.json({ data: { location } });
    },
  };
}

const denied = () =>
  Object.assign(new Error("GraphQL Client: An error occurred while fetching from the API."), {
    body: { errors: { graphQLErrors: [{ message: "Access denied for location field. Required access: `read_locations` access scope" }] } },
  });

test.beforeEach(async () => {
  await prisma.shopSettings.deleteMany({ where: { shop: SHOP } });
  await prisma.shopSettings.create({ data: { shop: SHOP, shopifyCountry: "GB", shopifyFactsAt: new Date(0) } });
});
test.after(async () => {
  await prisma.shopSettings.deleteMany({ where: { shop: SHOP } });
  await prisma.$disconnect();
});

test("the country is the primary location's", async () => {
  const f = await readShopFacts(admin({ location: { address: { countryCode: "PK" } } }));
  assert.deepEqual(f, { currency: "PKR", timezone: "Asia/Karachi", country: "PK", countryStatus: "ok" });
});

test("without read_locations the country is unknown, and a cached one is dropped", async () => {
  assert.equal(isMissingScope(denied()), true);
  const facts = await getShopFacts(SHOP, { fetchFacts: () => readShopFacts(admin({ location: denied() })) });
  assert.deepEqual(facts, { country: null, currency: "PKR", timezone: "Asia/Karachi" });
  const row = await prisma.shopSettings.findUnique({ where: { shop: SHOP } });
  assert.equal(row.shopifyCountry, null);
});

test("a transient location failure keeps the cached country", async () => {
  await prisma.shopSettings.update({ where: { shop: SHOP }, data: { shopifyCountry: "PK" } });
  const facts = await getShopFacts(SHOP, { fetchFacts: () => readShopFacts(admin({ location: new Error("socket hang up") })) });
  assert.equal(facts.country, "PK");
});

test("a malformed country is null, not passed through", async () => {
  const facts = await getShopFacts(SHOP, { fetchFacts: () => readShopFacts(admin({ location: { address: { countryCode: "Pakistan" } } })) });
  assert.equal(facts.country, null);
});
