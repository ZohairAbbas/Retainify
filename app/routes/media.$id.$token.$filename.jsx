/**
 * Serves a locally stored upload.
 *
 * Public by design — these URLs go into email HTML, and a mail client fetching
 * an image carries no session. The unguessable token in the path is what stands
 * in for authorization: without it, sequential asset ids would let anyone who
 * received one shared image walk the whole library.
 *
 * Shopify workspaces never reach this route; their assets live on Shopify's CDN.
 */
import prisma from "../db.server.js";
import { getLocal, localToken, isLocalAsset, sanitizeName } from "../lib/media/storage.server.js";

// A year. The token is part of the path and the bytes at a given id never
// change, so the URL is genuinely immutable.
const CACHE_CONTROL = "public, max-age=31536000, immutable";

export const loader = async ({ params }) => {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: params.id } });

  // One 404 for "no such asset", "wrong token", and "not a local asset". Three
  // distinct responses would be an oracle for which ids exist.
  if (!asset || !isLocalAsset(asset) || localToken(asset) !== params.token) {
    throw new Response("Not found", { status: 404 });
  }

  const bytes = await getLocal(asset.id);
  if (!bytes) throw new Response("Not found", { status: 404 });

  const filename = sanitizeName(asset.filename || params.filename);
  const type = asset.mimeType || "application/octet-stream";

  return new Response(bytes, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(bytes.length),
      "Cache-Control": CACHE_CONTROL,
      // SVG is the one allowed type that can carry script. Forcing a download
      // for it means a malicious upload can't execute on our origin and reach
      // the session cookie. Everything else renders inline as intended.
      "Content-Disposition": `${type === "image/svg+xml" ? "attachment" : "inline"}; filename="${filename}"`,
      // Defence in depth for the same reason.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
};
