import { authenticate } from "../shopify.server.js";
import { uploadImageToShopifyFiles } from "../lib/shopify/files.server.js";

const MAX_BYTES = 4 * 1024 * 1024; // 4MB
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"]);

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

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
    return Response.json({ ok: false, error: "unsupported_type", type: file.type }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ ok: false, error: "too_large", size: file.size, max: MAX_BYTES }, { status: 400 });
  }

  const alt = String(formData.get("alt") || "").slice(0, 200);
  const arrayBuf = await file.arrayBuffer();

  try {
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
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("[upload] failed:", err.message);
    return Response.json({ ok: false, error: "upload_failed", message: err.message }, { status: 500 });
  }
};

export const loader = () => Response.json({ ok: false, error: "use_POST" }, { status: 405 });
