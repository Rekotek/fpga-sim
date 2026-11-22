import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "./state";
import { ProjectsScreen } from "./ProjectsScreen";
import { UsersScreen } from "./UsersScreen";
import { Workspace } from "./Workspace";

export function App() {
  const project = useApp((s) => s.project);
  // "Users" is for an administrator with a valid session only (accounts spec section 5.6, docs/tz-accounts.md).
  const users = useApp(
    (s) =>
      s.screen === "users" && s.authStatus === "ok" && s.access.kind === "session" && s.access.user.role === "admin",
  );
  return (
    <TooltipProvider>
      {project ? <Workspace project={project} /> : users ? <UsersScreen /> : <ProjectsScreen />}
    </TooltipProvider>
  );
}
