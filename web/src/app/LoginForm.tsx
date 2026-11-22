// Login and password form (accounts spec section 5.1, docs/tz-accounts.md): on the projects screen without a key
// or session, and in a dialog when the session ended while a project was open (section 5.2).
import { LogInIcon } from "lucide-react";
import { useState, type SyntheticEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { t } from "../i18n";
import { retryAuth, signIn } from "./actions";
import { Problem } from "./kit";
import { DialogFrame } from "./Modal";
import { useApp, type AuthProblem } from "./state";

const PROBLEM: Record<Exclude<AuthProblem, null | "failed">, Parameters<typeof t>[0]> = {
  badCredentials: "login.bad",
  locked: "login.locked",
  keyRejected: "login.keyRejected",
  unreachable: "login.unreachable",
};

function LoginFields({ onDone, framed }: { onDone?: () => void; framed: boolean }) {
  const status = useApp((s) => s.authStatus);
  const problem = useApp((s) => s.authProblem);
  const serverText = useApp((s) => s.authText);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = name.trim() !== "" && password !== "";
  const submit = (event?: SyntheticEvent) => {
    event?.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    void signIn(name, password).then((ok) => {
      setBusy(false);
      if (ok) onDone?.();
    });
  };
  // The server did not answer while checking the saved sign-in data: "Retry" checks it again;
  // otherwise it repeats the sign-in with the login and password entered.
  const retry = () => {
    if (status === "unreachable") void retryAuth();
    else submit();
  };
  return (
    <form
      className={cn("flex flex-col gap-3", framed && "w-full max-w-sm rounded-lg border bg-background p-6")}
      onSubmit={submit}
      data-testid="login-form"
    >
      {framed && (
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <LogInIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          {t("login.title")}
        </h2>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login-name">{t("login.name")}</Label>
        <Input
          id="login-name"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          className="h-8"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          data-testid="login-name"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login-password">{t("login.password")}</Label>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          className="h-8"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          data-testid="login-password"
        />
      </div>
      {problem === "failed" && serverText && <Problem data-testid="login-problem">{serverText}</Problem>}
      {problem !== null && problem !== "failed" && problem !== "unreachable" && (
        <Problem data-testid="login-problem" data-problem={problem}>
          {t(PROBLEM[problem])}
        </Problem>
      )}
      {problem === "unreachable" && (
        <Problem className="flex flex-wrap items-center gap-2" data-testid="login-problem" data-problem={problem}>
          {t("login.unreachable")}
          <Button type="button" variant="outline" size="sm" onClick={retry} data-testid="login-retry">
            {t("login.retry")}
          </Button>
        </Problem>
      )}
      <div className="flex items-center justify-end gap-3">
        {(busy || status === "checking") && <span className="text-muted-foreground">{t("login.checking")}</span>}
        <Button type="submit" size="lg" disabled={busy || status === "checking" || !ready} data-testid="login-submit">
          {t("login.submit")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("login.hint")}</p>
    </form>
  );
}

export function LoginForm() {
  return (
    <div className="flex justify-center pt-6">
      <LoginFields framed />
    </div>
  );
}

// Sign-in in a dialog while a project is open (section 5.2).
export function LoginDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogFrame testid="login-dialog" title={t("login.title")}>
        <LoginFields framed={false} onDone={onClose} />
      </DialogFrame>
    </Dialog>
  );
}
