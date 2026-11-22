// Screen 3, "Users" (accounts spec section 5.6, docs/tz-accounts.md): administrator only. A table
// of accounts, "+ User", row menu: "New password", "Edit", "Disable" /
// "Enable", "Delete", "Projects" (the user's project list).
import {
  ChevronLeftIcon,
  EllipsisIcon,
  FolderKanbanIcon,
  KeyRoundIcon,
  PencilIcon,
  PlusIcon,
  PowerIcon,
  PowerOffIcon,
  Trash2Icon,
} from "lucide-react";
import { useState, type ReactNode, type SyntheticEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Account } from "../build/types";
import { t } from "../i18n";
import { addUser, deleteUser, resetUserPassword, showProjects, showUserProjects, updateUser } from "./actions";
import { Field } from "./AccountMenu";
import { forbidReason, formatWhen } from "./accounts";
import { Choice, Problem, Tip } from "./kit";
import { DialogFrame } from "./Modal";
import { Status } from "./ProjectsScreen";
import { useApp } from "./state";
import { UserProjectsDialog } from "./UserProjects";

type DialogKind =
  | { kind: "add" }
  | { kind: "edit"; user: Account }
  | { kind: "reset"; user: Account }
  | { kind: "delete"; user: Account }
  | { kind: "shown"; login: string; password: string };

function Frame(props: { testid: string; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogFrame testid={props.testid} title={props.title}>
        {props.children}
      </DialogFrame>
    </Dialog>
  );
}

function Buttons({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2">{children}</div>;
}

function roleOptions(demoteForbidden: string | null) {
  return [
    { value: "user", label: t("users.role.user"), disabled: demoteForbidden !== null },
    { value: "admin", label: t("users.role.admin") },
  ];
}

// New user: login, name, role. After creation, the password is shown.
function AddDialog({ onClose, onShown }: { onClose: () => void; onShown: (login: string, password: string) => void }) {
  const [login, setLogin] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("user");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    setBusy(true);
    void addUser({ login: login.trim(), name: name.trim(), role }).then((result) => {
      setBusy(false);
      if ("error" in result) setProblem(result.error);
      else onShown(result.ok.user.login, result.ok.password);
    });
  };
  return (
    <Frame testid="user-add-dialog" title={t("users.addTitle")} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <Field
          id="user-add-login"
          label={t("users.column.login")}
          value={login}
          onChange={setLogin}
          hint={t("users.loginHint")}
          autoFocus
        />
        <Field id="user-add-name" label={t("users.column.name")} value={name} onChange={setName} />
        <div className="flex flex-col gap-1.5">
          <Label>{t("users.column.role")}</Label>
          <Choice
            value={role}
            onChange={setRole}
            options={roleOptions(null)}
            label={t("users.column.role")}
            testid="user-add-role"
            className="w-56"
          />
        </div>
        {problem && <Problem data-testid="user-problem">{problem}</Problem>}
        <Buttons>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("users.cancel")}
          </Button>
          <Button type="submit" disabled={busy || !login.trim() || !name.trim()} data-testid="user-add-submit">
            {t("users.create")}
          </Button>
        </Buttons>
      </form>
    </Frame>
  );
}

// "Edit": name and role. Demoting a protected account is disabled in the role list, with an explanation.
function EditDialog({ user, forbidden, onClose }: { user: Account; forbidden: string | null; onClose: () => void }) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<string>(user.role);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const change: { name?: string; role?: string } = {};
    if (name.trim() !== user.name) change.name = name.trim();
    if (role !== user.role) change.role = role;
    if (Object.keys(change).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    void updateUser(user.login, change).then((result) => {
      setBusy(false);
      if ("error" in result) setProblem(result.error);
      else onClose();
    });
  };
  const demote = user.role === "admin" ? forbidden : null;
  return (
    <Frame testid="user-edit-dialog" title={t("users.editTitle", { login: user.login })} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <Field id="user-edit-name" label={t("users.column.name")} value={name} onChange={setName} autoFocus />
        <div className="flex flex-col gap-1.5">
          <Label>{t("users.column.role")}</Label>
          <Choice
            value={role}
            onChange={setRole}
            options={roleOptions(demote)}
            label={t("users.column.role")}
            testid="user-edit-role"
            className="w-56"
          />
          {demote && <p className="text-xs text-muted-foreground">{demote}</p>}
        </div>
        {problem && <Problem data-testid="user-problem">{problem}</Problem>}
        <Buttons>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("users.cancel")}
          </Button>
          <Button type="submit" disabled={busy || !name.trim()} data-testid="user-edit-submit">
            {t("dialog.save")}
          </Button>
        </Buttons>
      </form>
    </Frame>
  );
}

// "New password" with confirmation; the result is the password display.
function ResetDialog(props: {
  user: Account;
  onClose: () => void;
  onShown: (login: string, password: string) => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = () => {
    setBusy(true);
    void resetUserPassword(props.user.login).then((result) => {
      setBusy(false);
      if ("error" in result) setProblem(result.error);
      else props.onShown(props.user.login, result.ok);
    });
  };
  return (
    <Frame
      testid="user-reset-dialog"
      title={t("users.resetTitle", { login: props.user.login })}
      onClose={props.onClose}
    >
      <div className="flex flex-col gap-3">
        <p>{t("users.resetText")}</p>
        {problem && <Problem data-testid="user-problem">{problem}</Problem>}
        <Buttons>
          <Button type="button" variant="outline" onClick={props.onClose}>
            {t("users.cancel")}
          </Button>
          <Button type="button" disabled={busy} onClick={confirm} data-testid="user-reset-confirm">
            {t("users.resetConfirm")}
          </Button>
        </Buttons>
      </div>
    </Frame>
  );
}

// "Delete": confirmation by typing the login; the text names the number of projects that will be erased.
function DeleteDialog({ user, onClose }: { user: Account; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (typed.trim() !== user.login) return;
    setBusy(true);
    void deleteUser(user.login).then((result) => {
      setBusy(false);
      if ("error" in result) setProblem(result.error);
      else onClose();
    });
  };
  return (
    <Frame testid="user-delete-dialog" title={t("users.deleteTitle", { login: user.login })} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <p data-testid="user-delete-text">{t("users.deleteText", { login: user.login, count: user.projects })}</p>
        <Field id="user-delete-input" label={t("users.column.login")} value={typed} onChange={setTyped} autoFocus />
        {problem && <Problem data-testid="user-problem">{problem}</Problem>}
        <Buttons>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("users.cancel")}
          </Button>
          <Button
            type="submit"
            variant="destructive"
            disabled={busy || typed.trim() !== user.login}
            data-testid="user-delete-confirm"
          >
            {t("users.deleteConfirm")}
          </Button>
        </Buttons>
      </form>
    </Frame>
  );
}

// The login and password shown once, with a "Copy" button.
function ShownDialog({ login, password, onClose }: { login: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(`${login}\n${password}`).then(
      () => {
        setCopied(true);
      },
      () => undefined,
    );
  };
  return (
    <Frame testid="user-shown-dialog" title={t("users.shownTitle")} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border bg-panel px-4 py-3">
          <dt className="text-muted-foreground">{t("users.column.login")}</dt>
          <dd className="font-mono" data-testid="shown-login">
            {login}
          </dd>
          <dt className="text-muted-foreground">{t("login.password")}</dt>
          <dd className="font-mono select-all" data-testid="shown-password">
            {password}
          </dd>
        </dl>
        <p className="text-muted-foreground">{t("users.shownText")}</p>
        <Buttons>
          <Button type="button" variant="outline" onClick={copy} data-testid="shown-copy">
            {t(copied ? "users.copied" : "users.copy")}
          </Button>
          <Button type="button" onClick={onClose} data-testid="shown-close">
            {t("dialog.close")}
          </Button>
        </Buttons>
      </div>
    </Frame>
  );
}

// A menu item that may be forbidden: disabled, the reason is a tooltip.
function MenuAction(props: {
  testid: string;
  icon: ReactNode;
  label: string;
  forbidden?: string | null;
  destructive?: boolean;
  onSelect: () => void;
}) {
  const item = (
    <DropdownMenuItem
      disabled={Boolean(props.forbidden)}
      variant={props.destructive ? "destructive" : "default"}
      onSelect={props.onSelect}
      data-testid={props.testid}
      title={props.forbidden ?? undefined}
    >
      {props.icon}
      {props.label}
    </DropdownMenuItem>
  );
  return props.forbidden ? (
    <Tip text={props.forbidden}>
      <div>{item}</div>
    </Tip>
  ) : (
    item
  );
}

const TH = "px-3 py-2 text-left text-[11px] font-semibold tracking-wider text-muted-foreground uppercase";
const TD = "px-3 py-1.5";

function UserRow({
  user,
  me,
  users,
  open,
}: {
  user: Account;
  me: string;
  users: Account[];
  open: (d: DialogKind) => void;
}) {
  const forbidden = forbidReason(user, me, users);
  const [problem, setProblem] = useState<string | null>(null);
  const toggle = () => {
    void updateUser(user.login, { enabled: !user.enabled }).then((result) => {
      setProblem("error" in result ? result.error : null);
    });
  };
  return (
    <tr
      className={cn("border-b last:border-b-0", !user.enabled && "text-muted-foreground")}
      data-testid="user-row"
      data-login={user.login}
      data-enabled={String(user.enabled)}
    >
      <td className={cn(TD, "font-mono")}>{user.login}</td>
      <td className={TD}>
        {user.name}
        {problem && <Problem className="text-xs">{problem}</Problem>}
      </td>
      <td className={cn(TD, "text-muted-foreground")}>{t(`users.role.${user.role}`)}</td>
      <td className={cn(TD, !user.enabled && "text-destructive")}>
        {t(user.enabled ? "users.enabled" : "users.disabled")}
      </td>
      <td className={cn(TD, "text-muted-foreground tabular-nums")}>{formatWhen(user.lastLogin)}</td>
      <td className={cn(TD, "text-muted-foreground tabular-nums")}>{formatWhen(user.lastBuild)}</td>
      <td className={cn(TD, "text-right tabular-nums")}>{user.projects}</td>
      <td className="w-px px-2 py-1 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("users.menu", { login: user.login })}
              data-testid="user-menu"
            >
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <MenuAction
              testid="user-projects"
              icon={<FolderKanbanIcon />}
              label={t("users.projects")}
              onSelect={() => void showUserProjects(user.login)}
            />
            <DropdownMenuSeparator />
            <MenuAction
              testid="user-reset"
              icon={<KeyRoundIcon />}
              label={t("users.reset")}
              onSelect={() => {
                open({ kind: "reset", user });
              }}
            />
            <MenuAction
              testid="user-edit"
              icon={<PencilIcon />}
              label={t("users.edit")}
              onSelect={() => {
                open({ kind: "edit", user });
              }}
            />
            {user.enabled ? (
              <MenuAction
                testid="user-disable"
                icon={<PowerOffIcon />}
                label={t("users.disable")}
                forbidden={forbidden}
                onSelect={toggle}
              />
            ) : (
              <MenuAction testid="user-enable" icon={<PowerIcon />} label={t("users.enable")} onSelect={toggle} />
            )}
            <DropdownMenuSeparator />
            <MenuAction
              testid="user-delete"
              icon={<Trash2Icon />}
              label={t("users.delete")}
              forbidden={forbidden}
              destructive
              onSelect={() => {
                open({ kind: "delete", user });
              }}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

export function UsersScreen() {
  const users = useApp((s) => s.users);
  const error = useApp((s) => s.usersError);
  const access = useApp((s) => s.access);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const me = access.kind === "session" ? access.user.login : "";
  const close = () => {
    setDialog(null);
  };
  const shown = (login: string, password: string) => {
    setDialog({ kind: "shown", login, password });
  };
  return (
    <main className="min-h-full bg-panel" data-testid="users-page">
      <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button type="button" variant="ghost" size="sm" onClick={showProjects} data-testid="users-back">
              <ChevronLeftIcon />
              {t("users.back")}
            </Button>
            <h1 className="text-xl font-semibold">{t("users.title")}</h1>
          </div>
          <Status />
        </header>
        <div className="flex justify-end">
          <Button
            type="button"
            size="lg"
            onClick={() => {
              setDialog({ kind: "add" });
            }}
            data-testid="user-add"
          >
            <PlusIcon />
            {t("users.add")}
          </Button>
        </div>
        {error && <Problem data-testid="users-problem">{error}</Problem>}
        {users === null ? (
          !error && <p className="text-muted-foreground">{t("users.loading")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-background">
            <table className="w-full border-collapse" data-testid="user-list">
              <thead className="border-b bg-panel">
                <tr>
                  <th className={TH}>{t("users.column.login")}</th>
                  <th className={TH}>{t("users.column.name")}</th>
                  <th className={TH}>{t("users.column.role")}</th>
                  <th className={TH}>{t("users.column.state")}</th>
                  <th className={TH}>{t("users.column.lastLogin")}</th>
                  <th className={TH}>{t("users.column.lastBuild")}</th>
                  <th className={cn(TH, "text-right")}>{t("users.column.projects")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <UserRow key={user.login} user={user} me={me} users={users} open={setDialog} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {dialog?.kind === "add" && <AddDialog onClose={close} onShown={shown} />}
      {dialog?.kind === "edit" && (
        <EditDialog user={dialog.user} forbidden={forbidReason(dialog.user, me, users ?? [])} onClose={close} />
      )}
      {dialog?.kind === "reset" && <ResetDialog user={dialog.user} onClose={close} onShown={shown} />}
      {dialog?.kind === "delete" && <DeleteDialog user={dialog.user} onClose={close} />}
      {dialog?.kind === "shown" && <ShownDialog login={dialog.login} password={dialog.password} onClose={close} />}
      <UserProjectsDialog />
    </main>
  );
}
