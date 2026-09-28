/**
 * The version Retainify reports to Growzar (`appVersion`, §11).
 *
 * The package has no version field and deploys are `git pull` + build, so the
 * deployed commit is the honest version. Read once at startup from .git —
 * every deploy restarts the process, so it cannot go stale. APP_VERSION in the
 * environment wins if set.
 */
import fs from "node:fs";
import path from "node:path";

function gitCommit() {
  try {
    const gitDir = path.join(process.cwd(), ".git");
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (!head.startsWith("ref: ")) return head.slice(0, 12);
    const ref = head.slice(5);
    const loose = path.join(gitDir, ref);
    if (fs.existsSync(loose)) return fs.readFileSync(loose, "utf8").trim().slice(0, 12);
    const packed = fs.readFileSync(path.join(gitDir, "packed-refs"), "utf8");
    const line = packed.split("\n").find((l) => l.endsWith(` ${ref}`));
    return line ? line.slice(0, 12) : null;
  } catch {
    return null;
  }
}

export const APP_VERSION = process.env.APP_VERSION?.trim() || gitCommit() || "unknown";
