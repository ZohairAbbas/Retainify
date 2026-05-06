import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { renderCartRescueEmail } from "../lib/email/templates.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const style = url.searchParams.get("style") || "classic";
  const emailNumber = parseInt(url.searchParams.get("email") || "1", 10);
  const subject = url.searchParams.get("subject") || "";
  const discountPct = parseInt(url.searchParams.get("discountPct") || "10", 10);

  const settings = await prisma.shopSettings.findUnique({ where: { shop } });

  const html = renderCartRescueEmail({
    style,
    emailNumber,
    customerName: "Alex",
    lineItems: [
      {
        title: "Sample Product",
        variantTitle: "Default",
        quantity: 1,
        price: "$49.00",
        imageUrl: "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-1_medium.png",
        productUrl: "#",
      },
    ],
    totalPrice: "$49.00",
    currency: "USD",
    storeName: settings?.senderName || "Your Store",
    senderEmail: settings?.senderEmail || "noreply@yourstore.com",
    logoUrl: settings?.logoUrl || "",
    brandColor: settings?.brandColor || "#000000",
    recoveryUrl: "#",
    unsubscribeUrl: "#",
    merchantAddress: "123 Main St, Springfield",
    discountCode: emailNumber === 3 ? `RETAINIFY-PREVIEW (${discountPct}% off)` : undefined,
    customSubject: subject || undefined,
  });

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};
