export const ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "stores:read",
  "stores:write",
  "ai:read",
  "ai:write",
  "blog:read",
  "blog:write",
  "blog:publish",
  "languages:read",
  "languages:write",
  "logs:read"
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const rolePermissions: Record<Role, Permission[]> = {
  owner: [...PERMISSIONS],
  admin: [
    "stores:read",
    "stores:write",
    "ai:read",
    "ai:write",
    "blog:read",
    "blog:write",
    "blog:publish",
    "languages:read",
    "languages:write",
    "logs:read"
  ],
  editor: ["stores:read", "ai:read", "blog:read", "blog:write", "blog:publish", "languages:read"],
  viewer: ["stores:read", "ai:read", "blog:read", "languages:read", "logs:read"]
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return rolePermissions[role].includes(permission);
}
