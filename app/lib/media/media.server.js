/**
 * Content library — the shop's uploaded files.
 *
 * Bytes live in Shopify Files (lib/shopify/files.server.js); this module is the
 * local index of them.
 *
 * ── Why index locally ───────────────────────────────────────────────────────
 * The Files API can list a shop's files but cannot tell us which ones this app
 * uploaded, so a library built on it alone would show the merchant every
 * product photo in their store. A local row also gives alt text and a source
 * label somewhere to live, and makes the library searchable without a network
 * round trip on every keystroke.
 *
 * The CDN URL is the shareable link. It is public and unguessable, which is
 * exactly what an <img src> in an email needs — mail clients fetch images
 * anonymously, so anything requiring auth simply renders broken.
 */
import prisma from "../../db.server.js";

export const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

/** Types the library accepts. Images for email; PDFs for lead magnets. */
export const ALLOWED_TYPES = new Set([...IMAGE_TYPES, "application/pdf"]);

export const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Record an upload.
 *
 * Never throws: an upload that succeeded at Shopify but failed to index here
 * has still given the merchant a working URL, and losing the library row is a
 * far smaller problem than surfacing an error for a file that actually uploaded.
 */
export async function recordAsset(shop, { url, shopifyGid, filename, mimeType, byteSize, width, height, alt, source }) {
  if (!shop || !url) return null;
  try {
    return await prisma.mediaAsset.create({
      data: {
        shop,
        url,
        shopifyGid: shopifyGid || "",
        filename: filename || "",
        mimeType: mimeType || "",
        byteSize: Number(byteSize) || 0,
        width: Number.isFinite(width) ? width : null,
        height: Number.isFinite(height) ? height : null,
        alt: alt || "",
        source: source || "library",
      },
    });
  } catch (err) {
    console.error("[media] could not index upload:", err.message);
    return null;
  }
}

/**
 * List assets, newest first.
 *
 * @param {object} args
 * @param {"all"|"image"|"document"} [args.kind]
 * @param {string} [args.search] matches filename or alt text
 */
export async function listAssets({ shop, kind = "all", search = "", cursor = null, limit = 40 }) {
  // Soft-deleted assets stay in the table so their URLs keep resolving, but
  // they must never appear in the picker again.
  const where = { shop, deletedAt: null };

  if (kind === "image") where.mimeType = { startsWith: "image/" };
  else if (kind === "document") where.mimeType = { not: { startsWith: "image/" } };

  if (search) {
    const q = String(search).trim();
    where.OR = [
      { filename: { contains: q, mode: "insensitive" } },
      { alt: { contains: q, mode: "insensitive" } },
    ];
  }

  const rows = await prisma.mediaAsset.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  let nextCursor = null;
  if (rows.length > limit) {
    rows.pop();
    nextCursor = rows[rows.length - 1].id;
  }

  const total = await prisma.mediaAsset.count({ where });
  return { rows, nextCursor, total };
}

export async function updateAsset(shop, id, { alt }) {
  await prisma.mediaAsset.updateMany({
    where: { id, shop },
    data: { ...(alt !== undefined ? { alt: String(alt).slice(0, 300) } : {}) },
  });
  return { ok: true };
}

/**
 * Remove an asset from the library.
 *
 * A soft delete, and deliberately so: the bytes stay where they are — on
 * Shopify Files or on our disk — because an email already sitting in someone's
 * inbox references that URL directly and is not re-renderable. Hard-deleting
 * would turn every past send into a broken image. This hides it from the
 * picker; the link keeps working.
 */
export async function removeAsset(shop, id) {
  await prisma.mediaAsset.updateMany({
    where: { id, shop, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return { ok: true };
}

/** Human-readable size for the library UI. */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
