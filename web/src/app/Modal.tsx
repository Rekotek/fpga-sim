// The workspace modal dialog (spec section 9.3): open while its kind is in the state.
// The header and the bottom row are pinned; only the content scrolls.
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { t } from "../i18n";
import { openDialog } from "./actions";

// Stateless dialog frame: the help and "Simulator limits" use it too.
export function DialogFrame(props: {
  testid: string;
  title: string;
  wide?: boolean | undefined;
  closeTestid?: string;
  footer?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <DialogContent
      showCloseButton={false}
      aria-describedby={undefined}
      className={cn("flex max-h-[86vh] flex-col gap-0 p-0", props.wide ? "sm:max-w-3xl" : "sm:max-w-xl")}
      data-testid={props.testid}
    >
      <header className="flex shrink-0 items-center gap-3 border-b py-2.5 pr-2.5 pl-5">
        <DialogTitle className="flex-1 text-base">{props.title}</DialogTitle>
        <DialogClose asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("dialog.close")}
            data-testid={props.closeTestid ?? "dialog-close"}
          >
            <XIcon />
          </Button>
        </DialogClose>
      </header>
      <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", props.bodyClassName)}>{props.children}</div>
      {props.footer && <footer className="flex shrink-0 items-center gap-3 border-t px-5 py-3">{props.footer}</footer>}
    </DialogContent>
  );
}

export function Modal(props: {
  testid: string;
  title: string;
  wide?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) openDialog(null);
      }}
    >
      <DialogFrame testid={props.testid} title={props.title} wide={props.wide} footer={props.footer}>
        {props.children}
      </DialogFrame>
    </Dialog>
  );
}

// Board pin label in choice lists: number, name and state from the board file.
export function pinLabel(pin: string, info: { name: string; status: string }): string {
  return t("pin.option", { pin, name: info.name, status: t(`pin.status.${info.status}` as "pin.status.free") });
}
