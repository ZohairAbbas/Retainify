/**
 * GET /api/v1/growzar/checkouts — Growzar read feed (Phase 5, API-CONTRACT §6).
 * Row shape and what moves updatedAt: app/lib/growzar/feeds/checkouts.server.js.
 */
import { serveFeed } from "../lib/growzar/feed.server.js";
import { growzarError } from "../lib/growzar/platform-auth.js";
import { readCheckouts } from "../lib/growzar/feeds/checkouts.server.js";

export const loader = ({ request }) => serveFeed(request, readCheckouts);

export const action = () => growzarError(405, "bad_request", "Use GET.");
