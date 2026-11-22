// Account menu at the top right of the projects screen (accounts spec section 5.3, docs/tz-accounts.md): a button
// with the user name; "Change password", "Users" (administrator only), "Sign out".
// In access-key mode the button shows the key owner's name, and the menu holds only "Sign out".
import { ChevronDownIcon, KeyRoundIcon, LogOutIcon, UserIcon, UsersIcon } from "lucide-react";
import { useState, type SyntheticEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "../i18n";
import { changeOwnPassword, requestSignOut, showUsers } from "./actions";
import { Problem } from "./kit";
import { DialogFrame } from "./Modal";
import { useApp } from "./state";
import { ExitDialog } from "./SyncUi";

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

// A dialog field with a label above it.
export function Field(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  hint?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete ?? "off"}
        autoFocus={props.autoFocus}
        spellCheck={false}
        className="h-8"
        value={props.value}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
        data-testid={props.id}
      />
      {props.hint && <p className="text-xs text-muted-foreground">{props.hint}</p>}
    </div>
  );
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (next.length < MIN_PASSWORD || next.length > MAX_PASSWORD) setProblem(t("password.length"));
    else if (next !== repeat) setProblem(t("password.mismatch"));
    else {
      setBusy(true);
      void changeOwnPassword(current, next).then((error) => {
        setBusy(false);
        setProblem(error);
        setDone(error === null);
      });
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogFrame testid="password-dialog" title={t("password.title")}>
        {done ? (
          <div className="flex flex-col gap-3">
            <p data-testid="password-done">{t("password.done")}</p>
            <div className="flex justify-end">
              <Button type="button" onClick={onClose} data-testid="password-close">
                {t("dialog.close")}
              </Button>
            </div>
          </div>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <Field
              id="password-current"
              type="password"
              autoComplete="current-password"
              label={t("password.current")}
              value={current}
              onChange={setCurrent}
              autoFocus
            />
            <Field
              id="password-new"
              type="password"
              autoComplete="new-password"
              label={t("password.new")}
              value={next}
              onChange={setNext}
            />
            <Field
              id="password-repeat"
              type="password"
              autoComplete="new-password"
              label={t("password.repeat")}
              value={repeat}
              onChange={setRepeat}
            />
            {problem && <Problem data-testid="password-problem">{problem}</Problem>}
            <div className="flex justify-end">
              <Button type="submit" disabled={busy || !current || !next || !repeat} data-testid="password-submit">
                {t("password.submit")}
              </Button>
            </div>
          </form>
        )}
      </DialogFrame>
    </Dialog>
  );
}

export function AccountMenu() {
  const access = useApp((s) => s.access);
  const ok = useApp((s) => s.authStatus === "ok");
  const [password, setPassword] = useState(false);
  if (!ok || access.kind === "none") return null;
  const session = access.kind === "session" ? access.user : null;
  const shown = session ? session.name : t("key.ok", { owner: access.kind === "key" ? access.owner : "" });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" aria-label={t("account.menu")} data-testid="account-menu">
            {session ? <UserIcon /> : <KeyRoundIcon />}
            <span data-testid="account-name">{shown}</span>
            <ChevronDownIcon className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {session && (
            <>
              <DropdownMenuLabel className="font-mono text-xs text-muted-foreground">{session.login}</DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={() => {
                  setPassword(true);
                }}
                data-testid="account-password"
              >
                <KeyRoundIcon />
                {t("account.password")}
              </DropdownMenuItem>
              {session.role === "admin" && (
                <DropdownMenuItem onSelect={() => void showUsers()} data-testid="account-users">
                  <UsersIcon />
                  {t("account.users")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onSelect={() => void requestSignOut()} data-testid="account-logout">
            <LogOutIcon />
            {t("account.logout")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ExitDialog />
      {password && (
        <PasswordDialog
          onClose={() => {
            setPassword(false);
          }}
        />
      )}
    </>
  );
}
