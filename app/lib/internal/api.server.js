/**
 * Request/response plumbing shared by the internal API routes.
 *
 * Every response says plainly what happened. A lifecycle API that answers 200
 * to a misspelled journeyKey is indistinguishable from one that works — the
 * calling team ships it, sees no error, and finds out weeks later that nobody
 * was ever enrolled. So "matched nothing" is a distinct, visible outcome here,
 * never a silent success.
 */

/** @param {unknown} body @param {number} [status] */
export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Shorthand for a failed call. `error` is safe to show the caller. */
export function errorResponse(status, error, extra = {}) {
  return jsonResponse({ ok: false, error, ...extra }, status);
}

/**
 * Parse a JSON request body without throwing.
 *
 * @param {Request} request
 * @returns {Promise<{ ok: true, body: object } | { ok: false, error: string }>}
 */
export async function readJsonBody(request) {
  if (request.method !== "POST") {
    return { ok: false, error: "Use POST." };
  }
  let raw;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, error: "Could not read the request body." };
  }
  if (!raw.trim()) return { ok: false, error: "Request body is empty." };

  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { ok: false, error: "Request body must be a JSON object." };
    }
    return { ok: true, body };
  } catch {
    return { ok: false, error: "Request body is not valid JSON." };
  }
}

/**
 * Parse the optional `payload` object callers attach to an enrollment.
 *
 * Stored as-is on the enrollment and read back by the email renderer's merge
 * tags, so it must be a plain object — an array or a scalar would serialise
 * into something no merge tag can address.
 */
export function readPayload(value) {
  if (value === undefined || value === null) return { ok: true, payload: {} };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "payload must be a JSON object." };
  }
  return { ok: true, payload: value };
}
