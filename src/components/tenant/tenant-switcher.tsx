import { ROLES } from "@/db/permissions";

export type Workspace = { id: string; slug: string; name: string };

export function TenantSwitcher({
  workspaces,
  activeWorkspace,
  onWorkspaceChange,
  role,
  onRoleChange,
}: {
  workspaces: Workspace[];
  activeWorkspace: string;
  onWorkspaceChange: (slug: string) => void;
  role: (typeof ROLES)[number];
  onRoleChange: (role: (typeof ROLES)[number]) => void;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <label className="flex items-center gap-1.5">
        <span className="text-gray-500">Workspace</span>
        <select
          className="rounded border border-gray-300 px-2 py-1 text-sm"
          value={activeWorkspace}
          onChange={(e) => onWorkspaceChange(e.target.value)}
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.slug}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5">
        <span className="text-gray-500">Role</span>
        <select
          className="rounded border border-gray-300 px-2 py-1 text-sm"
          value={role}
          onChange={(e) => onRoleChange(e.target.value as (typeof ROLES)[number])}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
