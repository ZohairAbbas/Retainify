import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import { startWorkers } from "./lib/workers/tick.server.js";

/**
 * Should this web process also run the job queues?
 *
 * They used to run here unconditionally, which is what pinned the app to a
 * single instance: a second web process ran every worker a second time. The
 * schedule now lives in lib/workers/tick.server.js and can be run by a
 * dedicated process instead (workers/main.js, `npm run worker`).
 *
 * The default is on, because the alternative is an app that silently stops
 * sending the moment someone deploys it without reading this. A single-
 * container deploy and `shopify app dev` both want the tick here. Set
 * RUN_WORKERS_IN_WEB=0 on the web process once a worker process exists —
 * ecosystem.config.cjs does exactly that.
 *
 * Running it in both places is not a correctness problem, only a wasteful one:
 * the send workers claim per row and the periodic workers now hold leases.
 */
const runWorkersHere = (process.env.RUN_WORKERS_IN_WEB ?? "1") !== "0";

if (typeof setInterval !== "undefined" && runWorkersHere) {
  startWorkers({ label: "workers:web" });
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
