/**
 * The email editor's block palette.
 *
 * Kept apart from EmailEditor.jsx because which blocks a workspace may use is a
 * rule rather than a rendering detail, and the rule is worth testing on its own.
 */

export const BLOCK_LIBRARY = [
  { group: "Basic", items: [
    { type: "heading",   icon: "Heading1",     label: "Heading"   },
    { type: "paragraph", icon: "Type",         label: "Paragraph" },
    { type: "button",    icon: "Button",       label: "Button"    },
    { type: "image",     icon: "Image",        label: "Image"     },
    { type: "logo",      icon: "Logo",         label: "Logo"      },
  ]},
  { group: "Layout", items: [
    { type: "spacer",  icon: "Spacer",  label: "Spacer"  },
    { type: "divider", icon: "Divider", label: "Divider" },
  ]},
  { group: "Commerce", items: [
    { type: "product",  icon: "ProductGrid", label: "Product grid"   },
    { type: "discount", icon: "Discount",    label: "Discount code"  },
  ]},
  { group: "Structure", items: [
    { type: "footer", icon: "Footer", label: "Footer" },
  ]},
];

/**
 * The blocks a given workspace can actually use.
 *
 * The Commerce group needs a store behind it: a product grid has no catalogue to
 * draw from, and a discount block makes the email worker call
 * createDiscountCode(shop) against the Shopify Admin API before it will send. On
 * a workspace with no store that second one is not a degraded email — it is a
 * permanently failed job, because the worker deliberately refuses to send rather
 * than deliver a subject line promising an offer the body cannot carry.
 *
 * Offering a block that can only fail is worse than not offering it, so the
 * group is hidden rather than shown-and-disabled.
 *
 * @param {boolean} isShopify
 */
export function blocksFor(isShopify) {
  if (isShopify) return BLOCK_LIBRARY;
  return BLOCK_LIBRARY.filter((g) => g.group !== "Commerce");
}
