// A strip above the workspace when the session ended while a project was open (accounts spec section 5.2,
// docs/tz-accounts.md): editing and saving in the browser work, the "Sign in" button opens the sign-in.
import { TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { t } from "../i18n";
import { LoginDialog } from "./LoginForm";
import { useApp } from "./state";

export function SessionBanner() {
  const expired = useApp((s) => s.sessionExpired);
  const [open, setOpen] = useState(false);
  if (!expired) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-3 border-b bg-warning-soft px-3 py-1.5 text-warning"
      role="status"
      data-testid="session-banner"
    >
      <TriangleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{t("session.expired")}</span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
        data-testid="session-login"
      >
        {t("session.login")}
      </Button>
      {open && (
        <LoginDialog
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
