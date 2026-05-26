import { authenticate } from "../shopify.server.js";
import { searchProducts, getProductsByIds } from "../lib/shopify/products.server.js";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const ids = url.searchParams.getAll("id");

  if (ids.length) {
    try {
      const products = await getProductsByIds({ admin }, ids);
      return Response.json({ ok: true, products });
    } catch (err) {
      console.error("[products.api] byIds failed:", err.message);
      return Response.json({ ok: false, error: "lookup_failed", message: err.message }, { status: 500 });
    }
  }

  const q = url.searchParams.get("q") || "";
  try {
    const products = await searchProducts({ admin }, q, 20);
    return Response.json({ ok: true, products });
  } catch (err) {
    console.error("[products.api] search failed:", err.message);
    return Response.json({ ok: false, error: "search_failed", message: err.message }, { status: 500 });
  }
};
