// Made-up numbers only (pack rule 5). The UK ones avoid Ofcom's drama range,
// which full metadata correctly reports as not a real number.
import test from "node:test";
import assert from "node:assert/strict";
import { phoneToE164, phonePair } from "./e164.js";

test("a Pakistani number written locally and internationally is one buyer", () => {
  const forms = ["03001234567", "+923001234567", "+92 300 1234567", "0300-1234567", "923001234567", "00923001234567"];
  for (const f of forms) assert.equal(phoneToE164(f, "PK"), "+923001234567", f);
});

test("the trunk zero after +92 is repaired by the parser, not by us", () => {
  assert.equal(phoneToE164("+92 0300 1234567", "PK"), "+923001234567");
});

test("a number with + ignores the shop's country", () => {
  assert.equal(phoneToE164("+44 7911 123456", "PK"), "+447911123456");
  assert.equal(phoneToE164("+44 7911 123456", null), "+447911123456");
});

test("stored digits that lost their + are read as international when that is the only valid reading", () => {
  assert.equal(phoneToE164("447911123456", "PK"), "+447911123456");
});

test("a local number with no known country is null, never a guess", () => {
  assert.equal(phoneToE164("03001234567", null), null);
  assert.equal(phoneToE164("03001234567", "zz1"), null);
});

test("invalid, empty and junk input is null", () => {
  for (const v of ["", "   ", null, undefined, "12345", "abc", "+920000"]) {
    assert.equal(phoneToE164(v, "PK"), null, String(v));
  }
});

test("phonePair keeps the raw value beside a null", () => {
  assert.deepEqual(phonePair(null, "0300 12"), { phone: null, phoneRaw: "0300 12" });
  assert.deepEqual(phonePair("+923001234567", "03001234567"), { phone: "+923001234567", phoneRaw: "03001234567" });
  assert.deepEqual(phonePair(null, ""), { phone: null, phoneRaw: null });
});
