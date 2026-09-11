/**
 * Request/response plumbing shared by the internal API routes.
 *
 * Every response says plainly what happened. A lifecycle API that answers a bare
 * 200 to a misspelled event is indistinguishable from one that works — the
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

/** Limits on an event's `data`. Generous for lifecycle facts, fatal for a dump. */
export const DATA_MAX_KEYS = 50;
export const DATA_MAX_BYTES = 8 * 1024;
const DATA_KEY_RE = /^[a-z0-9_]{1,64}$/;

/**
 * Validate the optional `data` object an event carries.
 *
 * Its fields become merge tags — {data.plan}, {data.setup_url} — so the shape is
 * held to what a merge tag can address: a flat object of named scalars. Nested
 * objects and arrays are refused rather than stringified, because
 * "[object Object]" in a customer's inbox is worse than a 400 in a log.
 *
 * Rejects, never trims. A caller whose data is silently cut down would see
 * emails missing fields with nothing to explain why.
 *
 * @param {unknown} value
 * @returns {{ ok: true, data: Record<string, string|number|boolean> } | { ok: false, error: string }}
 */
export function readEventData(value) {
  if (value === undefined || value === null) return { ok: true, data: {} };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "data must be a JSON object." };
  }

  const entries = Object.entries(value);
  if (entries.length > DATA_MAX_KEYS) {
    return { ok: false, error: `data can have at most ${DATA_MAX_KEYS} fields.` };
  }
  for (const [key, v] of entries) {
    if (!DATA_KEY_RE.test(key)) {
      return {
        ok: false,
        error: `data field "${key}" must be lowercase letters, numbers and underscores (it is used as {data.${key}}).`,
      };
    }
    const type = typeof v;
    if (v === null || (type !== "string" && type !== "number" && type !== "boolean")) {
      return { ok: false, error: `data.${key} must be a string, number or boolean.` };
    }
    if (type === "number" && !Number.isFinite(v)) {
      return { ok: false, error: `data.${key} must be a finite number.` };
    }
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > DATA_MAX_BYTES) {
    return { ok: false, error: `data is larger than ${DATA_MAX_BYTES / 1024} KB.` };
  }
  return { ok: true, data: value };
}
