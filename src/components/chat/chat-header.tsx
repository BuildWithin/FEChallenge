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
    <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
      <div>
        <h1 className="text-lg font-semibold">ATS Analytics Copilot</h1>
        <p className="text-xs text-gray-500">
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
