/**
 * Copy the popup kit (app/lib/popup-templates/kit.js) into the storefront
 * script, between the rt-kit markers. The storefront file is a standalone
 * IIFE served by the theme extension and by /embed/popup.js, so it cannot
 * import the module — it carries a copy, and kit-sync.test.js fails if the
 * copy is stale.
 *
 *   npm run popup:kit
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
export const KIT_PATH = path.join(root, "app/lib/popup-templates/kit.js");
export const STOREFRONT_PATH = path.join(root, "extensions/cart-rescue-popup/assets/cart-rescue-popup.js");
const START = "/* rt-kit:start */";
const END = "/* rt-kit:end */";

export function kitBody(kitSource) {
  const m = kitSource.match(/\/\/ <rt-kit>\n([\s\S]*?)\/\/ <\/rt-kit>/);
  if (!m) throw new Error("kit.js is missing its // <rt-kit> markers");
  return m[1].replace(/^(?=.)/gm, "  ");
}

export function withKit(storefront, kitSource) {
  const a = storefront.indexOf(START);
  const b = storefront.indexOf(END);
  if (a === -1 || b === -1 || b < a) throw new Error("storefront script is missing the rt-kit markers");
  return storefront.slice(0, a + START.length) + "\n" + kitBody(kitSource) + "  " + storefront.slice(b);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const next = withKit(fs.readFileSync(STOREFRONT_PATH, "utf8"), fs.readFileSync(KIT_PATH, "utf8"));
  fs.writeFileSync(STOREFRONT_PATH, next);
  console.log("popup kit synced into", path.relative(root, STOREFRONT_PATH));
}
