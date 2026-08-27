/**
 * Sign out.
 *
 * POST does the work; the GET exists only so a stale bookmark or an email link
 * lands somewhere sensible instead of 405-ing. Both revoke the session server
 * side — a logout that only drops the cookie leaves a usable token behind.
 */
import { redirect } from "react-router";
import { destroySession } from "../lib/auth/session.server.js";

async function signOut(request) {
  const { cookie } = await destroySession(request);
  return redirect("/login?notice=signed-out", { headers: { "Set-Cookie": cookie } });
}

export const action = ({ request }) => signOut(request);
export const loader = ({ request }) => signOut(request);
