import { redirect } from "react-router";
import prisma from "../db.server.js";

// Public route — no auth. Records click, redirects to destination.
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const abandonedCartId = url.searchParams.get("cart");
  const emailNumber = parseInt(url.searchParams.get("em") || "1", 10);
  const destination = url.searchParams.get("dest");

  if (!destination) {
    return new Response("Missing destination", { status: 400 });
  }

  // Record click asynchronously — don't block the redirect
  if (shop && abandonedCartId) {
    prisma.cartRescueEmail
      .updateMany({
        where: { shop, abandonedCartId, emailNumber, clickedAt: null },
        data: { clickedAt: new Date() },
      })
      .catch(() => {});
  }

  return redirect(destination);
};
