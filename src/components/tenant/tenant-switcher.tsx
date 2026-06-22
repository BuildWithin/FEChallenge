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
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-foreground-muted">Workspace</span>
        <select
          className="w-full rounded-lg border border-line-strong bg-surface px-2 p-4 py-1.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-ring"
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
      <label className="flex flex-col gap-1">
        <span className="text-xs text-foreground-muted">Role</span>
        <select
          className="w-full rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-ring"
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
