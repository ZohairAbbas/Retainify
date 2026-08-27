/**
 * Caller IP, for rate-limit keys.
 *
 * The app sits behind a reverse proxy, so the socket address is always the
 * proxy's. `x-forwarded-for` is the only source available; it is trivially
 * spoofable by a client if the proxy passes it through unchanged, so this is
 * good enough for throttling abuse but must never be used for authorization.
 */
export function clientIp(request) {
  const xff = request.headers.get("x-forwarded-for") || "";
  const first = xff.split(",")[0].trim();
  if (first) return first.slice(0, 64);
  return request.headers.get("x-real-ip")?.slice(0, 64) || "unknown";
}
