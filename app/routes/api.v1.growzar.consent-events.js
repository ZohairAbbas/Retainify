/**
 * GET /api/v1/growzar/consent-events — Growzar read feed (Phase 5, API-CONTRACT §6).
 * Row shape and what moves updatedAt: app/lib/growzar/feeds/consent.server.js.
 */
import { serveFeed } from "../lib/growzar/feed.server.js";
import { growzarError } from "../lib/growzar/platform-auth.js";
import { readConsentEvents } from "../lib/growzar/feeds/consent.server.js";

export const loader = ({ request }) => serveFeed(request, readConsentEvents);

export const action = () => growzarError(405, "bad_request", "Use GET.");
