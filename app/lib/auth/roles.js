/**
 * Roles, shared by the server (authorization) and the client (the team page's
 * role picker). Client-safe: no prisma, no node builtins.
 */
export const ROLES = ["owner", "admin", "member"];

/** Roles allowed to change billing, invite people, or delete the workspace. */
export function canManage(role) {
  return role === "owner" || role === "admin";
}

/** Shown under the invite form, so nobody has to guess what a role grants. */
export const ROLE_HELP = {
  owner: "Full access, including billing and deleting the workspace.",
  admin: "Everything except deleting the workspace.",
  member: "Can build and send, but can't manage people or billing.",
};

export function roleLabel(role) {
  return role ? role[0].toUpperCase() + role.slice(1) : "";
}
