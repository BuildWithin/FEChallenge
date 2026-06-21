import { ROLES } from "@/db/permissions";
import { TenantSwitcher, type Workspace } from "@/components/tenant/tenant-switcher";

export function ChatHeader({
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
    <header className="flex flex-col gap-4 rounded-xl border border-line shadow-sm bg-surface p-4">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[1.375rem] font-bold leading-tight tracking-[-0.02em]">
          ATS Analytics Copilot
        </h1>
        <p className="text-xs leading-snug text-foreground-muted">
          Chat with this workspace&rsquo;s recruiting data.
        </p>
      </div>
      <TenantSwitcher
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        onWorkspaceChange={onWorkspaceChange}
        role={role}
        onRoleChange={onRoleChange}
      />
    </header>
  );
}
