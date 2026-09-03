/**
 * The WhatsApp click token — the whole basis of WhatsApp revenue attribution.
 *
 * Meta reports template button taps only as template-level aggregates, with no
 * wamid and no recipient, so a tap can only be tied to a person if it comes
 * back through our own redirect carrying an identifier we minted. clickToken
 * writes that identifier and w.$token.jsx parses it, and the two are in
 * separate files — so the round trip is exactly the kind of thing that breaks
 * silently, taking every WhatsApp order with it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { clickToken } from "./whatsapp-worker.server.js";

/** The parse in app/routes/w.$token.jsx, kept in step with it. */
function parseToken(token) {
  const dash = token.lastIndexOf("-");
  if (dash < 1) return null;
  const jobId = token.slice(0, dash);
  const index = Number(token.slice(dash + 1));
  if (!jobId || jobId.length > 64 || !Number.isInteger(index) || index < 0) return null;
  return { jobId, index };
}

test("a minted token parses back to the same job and button", () => {
  // A real cuid, which is the id shape WhatsappJob actually uses.
  const jobId = "clx3k9v2h0000qwer8asdf123";
  for (const index of [0, 1, 2]) {
    assert.deepEqual(parseToken(clickToken(jobId, index)), { jobId, index });
  }
});

test("splits on the LAST dash, so the index survives", () => {
  // The comment on clickToken rests on a cuid containing no dash. If an id
  // ever does, lastIndexOf is what keeps the button index recoverable.
  const jobId = "job-with-dashes-in-it";
  assert.deepEqual(parseToken(clickToken(jobId, 2)), { jobId, index: 2 });
});

test("malformed tokens are rejected rather than resolving to a wrong job", () => {
  assert.equal(parseToken("nodash"), null);
  assert.equal(parseToken("-0"), null);
  assert.equal(parseToken("job-notanumber"), null);
  // An oversized id can't reach the database lookup at all.
  assert.equal(parseToken(`${"x".repeat(80)}-0`), null);
});

test("a bogus job id parses but resolves to nothing", () => {
  // "job--1" splits on the LAST dash, so it is a well-formed token for a job
  // named "job-" — there is no way to write a negative index. That is the
  // safe outcome and worth pinning: the parse succeeding is harmless, because
  // w.$token.jsx reads the destination from the template row rather than the
  // token, so an id matching no job redirects to the fallback and records no
  // click. The token is never trusted for anything but lookup.
  assert.deepEqual(parseToken("job--1"), { jobId: "job-", index: 1 });
});
