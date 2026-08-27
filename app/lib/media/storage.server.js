/**
 * Where uploaded files actually live.
 *
 * A Shopify workspace pushes bytes to Shopify Files and gets a CDN URL for
 * free. A direct workspace has no Shopify to push to, so we store the bytes on
 * disk and serve them from our own domain.
 *
 * Local files are content-addressed by the MediaAsset row id — the row is the
 * index, so the on-disk name carries no meaning and no user input. That is
 * deliberate: a filename from a form is the classic path-traversal vector, and
 * here it never reaches the filesystem at all.
 *
 * MEDIA_DIR must be on a volume that survives deploys. The default sits inside
 * the project so a fresh clone works, but production should point it at a
 * mounted disk (or, later, S3 — this module is the single seam to swap).
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { appBaseUrl } from "../auth/mail.server.js";

const MEDIA_DIR = process.env.MEDIA_DIR || path.join(process.cwd(), "data", "uploads");

/** Two-level fan-out, so no single directory accumulates every file ever uploaded. */
function shardFor(id) {
  const h = createHash("sha256").update(id).digest("hex");
  return path.join(h.slice(0, 2), h.slice(2, 4));
}

function pathFor(id) {
  return path.join(MEDIA_DIR, shardFor(id), id);
}

/**
 * Write bytes for an asset id.
 * @returns {Promise<{ok: true} | {ok: false, error: string}>}
 */
export async function putLocal(id, bytes) {
  try {
    const target = pathFor(id);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    return { ok: true };
  } catch (err) {
    console.error("[media] local write failed:", err.message);
    return { ok: false, error: err.message };
  }
}

/** Read bytes back, or null if the file is gone. */
export async function getLocal(id) {
  try {
    return await readFile(pathFor(id));
  } catch {
    return null;
  }
}

export async function deleteLocal(id) {
  try {
    await unlink(pathFor(id));
  } catch {
    // Already gone is the desired end state.
  }
}

/**
 * The public URL for a locally stored asset.
 *
 * Absolute, not relative: these URLs end up inside email HTML, where a relative
 * path resolves against the mail client and loads nothing.
 *
 * The `token` is a short random string stored in MediaAsset.shopifyGid (which
 * is otherwise unused for local files). It makes the URL unguessable, so one
 * shared link doesn't make every other asset id enumerable.
 */
export function localUrl(id, token, filename) {
  return `${appBaseUrl()}/media/${id}/${token}/${sanitizeName(filename)}`;
}

/** How a local asset is tagged in MediaAsset.shopifyGid. */
export const LOCAL_PREFIX = "local:";

export function localToken(asset) {
  const gid = String(asset?.shopifyGid || "");
  return gid.startsWith(LOCAL_PREFIX) ? gid.slice(LOCAL_PREFIX.length) : "";
}

export function newToken() {
  return randomBytes(9).toString("base64url");
}

/**
 * Filename as it appears in the URL and the Content-Disposition header.
 * Purely cosmetic — nothing on disk is derived from it.
 */
export function sanitizeName(raw) {
  const base = path.basename(String(raw || "file"));
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "").slice(0, 120);
  return cleaned || "file";
}

/**
 * True when this asset's bytes are ours rather than Shopify's.
 *
 * Keyed on shopifyGid rather than the URL, because the stored URL is absolute
 * and the app's public origin can change (a custom domain, a staging host) —
 * which would silently reclassify every existing asset.
 */
export function isLocalAsset(asset) {
  return String(asset?.shopifyGid || "").startsWith(LOCAL_PREFIX);
}
