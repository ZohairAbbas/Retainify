/**
 * The dedicated worker process.
 *
 * Run with `npm run worker`, or as the `retainify-worker` app in
 * ecosystem.config.cjs. It runs exactly the schedule the web process used to
 * run inline (app/lib/workers/tick.server.js) and nothing else — no HTTP
 * listener, no request handling to compete with.
 *
 * ── No build step ──────────────────────────────────────────────────────────
 * This imports the app's source directly rather than the react-router bundle in
 * build/. The worker import graph is 41 plain-ESM .server.js files with no JSX
 * anywhere in it, so node runs it as-is. That keeps the worker independent of
 * the client build and means a worker restart does not need one.
 *
 * ── Shutdown ───────────────────────────────────────────────────────────────
 * SIGTERM stops the timers and then waits for whatever tick is in flight before
 * exiting, because a process killed mid-send leaves a job stuck in "processing"
 * for the stuck-job reaper to find and retry minutes later. pm2 sends SIGTERM
 * and waits `kill_timeout` before SIGKILL, so that window is configured to
 * match. A second SIGTERM exits immediately, for when waiting is not wanted.
 */
import prisma from "../app/db.server.js";
import {
  startWorkers,
  runFastTick,
  runSlowTick,
  runHourlyTick,
} from "../app/lib/workers/tick.server.js";

// How long to let an in-flight tick finish on shutdown before giving up on it.
// Kept below ecosystem.config.cjs's kill_timeout so this exits on its own terms
// rather than being SIGKILLed partway through the wait.
const DRAIN_TIMEOUT_MS = 25_000;

let stopWorkers = () => {};
let draining = false;
/** Whatever tick is running right now, so shutdown can wait for it. */
let currentTick = Promise.resolve();

function track(fn) {
  return async () => {
    if (draining) return;
    currentTick = fn();
    await currentTick;
  };
}

async function main() {
  console.log(`[worker] starting — pid ${process.pid}, node ${process.version}`);

  // Fail loudly and immediately on a bad DATABASE_URL rather than logging a
  // connection error every 60 seconds forever.
  await prisma.$queryRaw`SELECT 1`;

  stopWorkers = startWorkers({ label: "worker" });

  // The timers fire a minute from now; without this a restart is a minute of
  // dead air, and a deploy during a send is exactly when that is felt.
  await track(runFastTick)();
  await track(runSlowTick)();
  await track(runHourlyTick)();
}

async function shutdown(signal) {
  if (draining) {
    console.warn(`[worker] ${signal} again — exiting now`);
    process.exit(1);
  }
  draining = true;
  console.log(`[worker] ${signal} — stopping timers, draining in-flight work`);
  stopWorkers();

  const timeout = new Promise((resolve) => setTimeout(() => resolve("timeout"), DRAIN_TIMEOUT_MS));
  const outcome = await Promise.race([currentTick.then(() => "drained"), timeout]);
  if (outcome === "timeout") {
    console.warn(`[worker] tick still running after ${DRAIN_TIMEOUT_MS}ms — exiting anyway`);
  }

  await prisma.$disconnect().catch(() => {});
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// A worker that has lost its database or its provider client must die and be
// restarted, not keep ticking in a state nobody has reasoned about. pm2 brings
// it back; a process left running after an unhandled rejection just fails
// quietly every minute.
process.on("unhandledRejection", (err) => {
  console.error("[worker] unhandled rejection — exiting:", err);
  process.exit(1);
});

main().catch((err) => {
  console.error("[worker] failed to start:", err);
  process.exit(1);
});
