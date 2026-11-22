// The "Simulator limits" dialog (spec section 9.3): a short list of what the simulator does not model.
import { InfoIcon } from "lucide-react";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { t } from "../i18n";
import { IconButton } from "./kit";
import { DialogFrame } from "./Modal";

const ITEMS = ["states", "initial", "timing", "noise", "inout", "guarantee"] as const;

export function LimitsButton() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <IconButton label={t("limits.title")} size="icon-xs" data-testid="limits-open">
          <InfoIcon />
        </IconButton>
      </DialogTrigger>
      <DialogFrame testid="limits" title={t("limits.title")} closeTestid="limits-close">
        <ul className="list-disc space-y-1.5 pl-5 leading-relaxed marker:text-muted-foreground">
          {ITEMS.map((item) => (
            <li key={item}>{t(`limits.${item}`)}</li>
          ))}
        </ul>
      </DialogFrame>
    </Dialog>
  );
}
