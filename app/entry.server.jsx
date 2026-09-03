import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import { runJourneyWorker } from "./lib/journey/journey-worker.server.js";
import { runBroadcastWorker } from "./lib/journey/broadcast.server.js";
import { runPushWorker } from "./lib/push/push-worker.server.js";
import { runWhatsappWorker } from "./lib/whatsapp/whatsapp-worker.server.js";
import { runSegmentEnrollmentWorker } from "./lib/segments/segmentEnrollmentWorker.server.js";
import { runSegmentSnapshotWorker } from "./lib/segments/segmentSnapshotWorker.server.js";
import { runEngagementRollupWorker } from "./lib/segments/engagementRollupWorker.server.js";
import { pruneExpiredSessions } from "./lib/auth/session.server.js";
import { runStuckJobReaper, runEnrollmentStallReaper } from "./lib/journey/stuck-jobs.server.js";
import { runEnrollmentAdvanceWorker } from "./lib/journey/advance.server.js";

// Poll all job queues every 60 seconds.
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    // Walks lazy enrollments to their next node. Runs BEFORE the send workers
    // so a job created this tick is picked up in the same one rather than
    // waiting another minute — over a six-step flow that is five minutes of
    // pure latency saved for nothing.
    runEnrollmentAdvanceWorker().catch((err) => console.error("[advance] poll error:", err));
    runJourneyWorker().catch((err) => console.error("[journey-worker] poll error:", err));
    // Dispatches scheduled broadcasts. Enrolment only — the journey worker
    // above does the actual sending on the next tick.
    runBroadcastWorker().catch((err) => console.error("[broadcast] poll error:", err));
    runPushWorker().catch((err) => console.error("[push-worker] poll error:", err));
    runWhatsappWorker().catch((err) => console.error("[whatsapp-worker] poll error:", err));
    // Bounded per-tick budget keeps these next to journey/push without
    // blowing up DB load. See segmentEnrollmentWorker comment for details.
    runSegmentEnrollmentWorker().catch((err) => console.error("[segment-enrollment] poll error:", err));
    runSegmentSnapshotWorker().catch((err) => console.error("[segment-snapshot] poll error:", err));
    // Repairs engagement columns the send path and webhooks failed to roll up.
    // Self-throttling: no-ops for a shop swept within the last 15 minutes.
    runEngagementRollupWorker().catch((err) => console.error("[engagement-rollup] poll error:", err));
    // Recovers work abandoned mid-flight when the process died — every deploy
    // is a chance to strand whatever was being sent at that moment, and a row
    // stuck in "processing" is invisible to every claim query.
    runStuckJobReaper().catch((err) => console.error("[stuck-jobs] poll error:", err));
  }, 60_000);

  // Enrollments that lost their wake-up. Five-minutely rather than per-minute:
  // a stall is a standing condition, not an event, and this reads across every
  // open enrollment rather than a claim window. It only reports — and logs its
  // own findings at error level with a sample — see runEnrollmentStallReaper
  // for why it must not quietly re-wake anything.
  setInterval(() => {
    runEnrollmentStallReaper().catch((err) =>
      console.error("[stall-reaper] poll error:", err),
    );
  }, 5 * 60_000);

  // Housekeeping for the standalone auth tables. Hourly, not per-minute: an
  // expired session is already rejected on read, so deleting the row is purely
  // about not growing the table forever.
  setInterval(() => {
    pruneExpiredSessions().catch((err) => console.error("[auth] session prune error:", err));
  }, 60 * 60_000);
}

export const streamTimeout = 5000;

export default async function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  reactRouterContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={reactRouterContext} url={request.url} />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        },
      },
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
