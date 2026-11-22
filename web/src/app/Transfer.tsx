// Report on moving files into a project (spec section 9.2): a refusal of everything or the list of files
// that were not taken, with the reason.
import { Button } from "@/components/ui/button";
import { t } from "../i18n";
import { dropTransfer } from "./actions";
import { Problem } from "./kit";
import { useApp } from "./state";

export function TransferReport() {
  const transfer = useApp((s) => s.transfer);
  if (!transfer || (transfer.error === null && transfer.skipped.length === 0)) return null;
  return (
    <div
      className="m-1.5 flex flex-col items-start gap-1.5 rounded-md border border-warning/40 bg-warning-soft/50 p-2.5 text-xs"
      data-testid="transfer"
    >
      {transfer.error !== null && <Problem data-testid="transfer-error">{transfer.error}</Problem>}
      {transfer.skipped.length > 0 && (
        <>
          <p>{t("transfer.skipped")}</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {transfer.skipped.map((s) => (
              <li key={s.path} data-testid="transfer-skipped">
                <code>{s.path}</code> — {t(`transfer.reason.${s.reason}`)}
              </li>
            ))}
          </ul>
        </>
      )}
      <Button type="button" variant="outline" size="sm" onClick={dropTransfer} data-testid="transfer-close">
        {t("transfer.close")}
      </Button>
    </div>
  );
}
