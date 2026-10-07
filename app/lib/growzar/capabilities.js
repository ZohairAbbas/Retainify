/**
 * What this build serves to Growzar, reported by GET /api/v1/growzar/status
 * (API-CONTRACT §11). One verb per read feed, added as each one ships.
 *
 *   messages:read     /api/v1/growzar/messages
 *   journeys:read     /api/v1/growzar/journeys
 *   enrollments:read  /api/v1/growzar/enrollments
 *   checkouts:read    /api/v1/growzar/checkouts
 *   consent:read      /api/v1/growzar/consent and /consent-events
 */
export const GROWZAR_CAPABILITIES = Object.freeze([
  "messages:read",
  "journeys:read",
  "enrollments:read",
  "checkouts:read",
  "consent:read",
]);
