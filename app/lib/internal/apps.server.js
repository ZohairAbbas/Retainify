/**
 * Which Growzar apps are wired up to send events.
 *
 * The source of truth is the set of INTERNAL_APP_SECRET_<APP> variables: an app
 * with no secret cannot authenticate, so it cannot send an event, so a flow
 * subscribed to it would never fire. Deriving the list from the same place the
 * auth check reads keeps the two from drifting — there is no second registry to
 * forget to update.
 *
 * Only the variable NAMES are read here. The values are secrets and never leave
 * auth.server.js.
 */
import { validateExternalKey } from "../triggerConfig.js";
import { secretEnvName } from "./auth.server.js";

const PREFIX = "INTERNAL_APP_SECRET_";

/**
 * Lowercase app names with a secret configured, sorted for a stable dropdown.
 * Names that the external-key grammar would reject are skipped rather than
 * repaired: a variable like INTERNAL_APP_SECRET_MY-APP could never be called
 * with a valid `app` field anyway.
 *
 * @param {Record<string, string|undefined>} [env] injectable for tests
 * @returns {string[]}
 */
export function configuredApps(env = process.env) {
  const apps = [];
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(PREFIX) || !value) continue;
    const app = name.slice(PREFIX.length).toLowerCase();
    if (validateExternalKey(app).ok) apps.push(app);
  }
  return apps.sort();
}

/** Is this app able to send events right now? */
export function isConfiguredApp(app, env = process.env) {
  return Boolean(app) && Boolean(env[secretEnvName(app)]);
}
