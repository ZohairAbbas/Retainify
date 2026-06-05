import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import { runJourneyWorker } from "./lib/journey/journey-worker.server.js";
import { runPushWorker } from "./lib/push/push-worker.server.js";
import { runSegmentEnrollmentWorker } from "./lib/segments/segmentEnrollmentWorker.server.js";
import { runSegmentSnapshotWorker } from "./lib/segments/segmentSnapshotWorker.server.js";

// Poll all job queues every 60 seconds.
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    runJourneyWorker().catch((err) => console.error("[journey-worker] poll error:", err));
    runPushWorker().catch((err) => console.error("[push-worker] poll error:", err));
    // Bounded per-tick budget keeps these next to journey/push without
    // blowing up DB load. See segmentEnrollmentWorker comment for details.
    runSegmentEnrollmentWorker().catch((err) => console.error("[segment-enrollment] poll error:", err));
    runSegmentSnapshotWorker().catch((err) => console.error("[segment-snapshot] poll error:", err));
  }, 60_000);
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
