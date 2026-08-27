/**
 * File upload endpoint.
 *
 * Two storage backends behind one endpoint. A Shopify workspace pushes bytes to
 * Shopify Files and gets a CDN URL; a direct workspace stores them on our own
 * disk and serves them from /media. Callers — the email editor's image block,
 * the brand-kit logo picker, the content library — see the same response shape
 * either way and never learn which one ran.
 */
import { requireAccount } from "../lib/auth/require.server.js";
import { uploadImageToShopifyFiles } from "../lib/shopify/files.server.js";
import { ALLOWED_TYPES, MAX_BYTES, recordAsset } from "../lib/media/media.server.js";
import { LOCAL_PREFIX, deleteLocal, localUrl, newToken, putLocal } from "../lib/media/storage.server.js";
import prisma from "../db.server.js";
import { randomBytes } from "node:crypto";

export const action = async ({ request }) => {
  const { admin, shop } = await requireAccount(request);

  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ ok: false, error: "invalid_form" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return Response.json({ ok: false, error: "missing_file" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return Response.json(
      { ok: false, error: "unsupported_type", message: "Use a JPG, PNG, GIF, WebP, SVG or PDF.", type: file.type },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      {
        ok: false,
        error: "too_large",
        message: `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit is ${MAX_BYTES / 1024 / 1024}MB.`,
        size: file.size,
        max: MAX_BYTES,
      },
      { status: 400 },
    );
  }

  const alt = String(formData.get("alt") || "").slice(0, 300);
  // Where the upload came from, so the library can distinguish a one-off image
  // block upload from something deliberately added to the library.
  const source = String(formData.get("source") || "library");
  const arrayBuf = await file.arrayBuffer();

  try {
    if (admin) {
      const result = await uploadImageToShopifyFiles(
        { admin },
        {
          filename: file.name || "upload.png",
          mimeType: file.type,
          fileSize: file.size,
          bytes: new Uint8Array(arrayBuf),
          alt,
        },
      );

      // Index for the library. Non-fatal if it fails — the merchant already has
      // a working URL, and losing the index entry is the lesser problem.
      const asset = await recordAsset(shop, {
        url: result.url,
        shopifyGid: result.fileId || "",
        filename: file.name || "",
        mimeType: file.type,
        byteSize: file.size,
        width: result.width,
        height: result.height,
        alt,
        source,
      });

      return Response.json({ ok: true, ...result, assetId: asset?.id || null });
    }

    // ── Local storage ────────────────────────────────────────────────────
    // The id is generated here rather than by the database default, because the
    // public URL embeds it — knowing it up front turns this into one insert
    // instead of an insert-then-update, and removes the window where a row
    // exists with no usable URL.
    const id = randomBytes(16).toString("hex");
    const token = newToken();
    const url = localUrl(id, token, file.name || "file");

    // Bytes first: a file on disk that no row points at is invisible garbage we
    // can sweep later, whereas a row whose bytes are missing is a broken image
    // in someone's email.
    const written = await putLocal(id, Buffer.from(arrayBuf));
    if (!written.ok) {
      return Response.json(
        { ok: false, error: "upload_failed", message: "Could not save the file." },
        { status: 500 },
      );
    }

    let asset;
    try {
      asset = await prisma.mediaAsset.create({
        data: {
          id,
          shop,
          url,
          shopifyGid: `${LOCAL_PREFIX}${token}`,
          filename: file.name || "",
          mimeType: file.type,
          byteSize: file.size,
          alt,
          source,
        },
      });
    } catch (err) {
      await deleteLocal(id);
      console.error("[upload] could not index local upload:", err.message);
      return Response.json(
        { ok: false, error: "upload_failed", message: "Could not index the file." },
        { status: 500 },
      );
    }

    return Response.json({ ok: true, url, fileId: "", assetId: asset.id });
  } catch (err) {
    console.error("[upload] failed:", err.message);
    return Response.json({ ok: false, error: "upload_failed", message: err.message }, { status: 500 });
  }
};

export const loader = () => Response.json({ ok: false, error: "use_POST" }, { status: 405 });
