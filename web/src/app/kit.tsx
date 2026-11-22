// Shared interface elements on top of the shadcn components: an icon button with a tooltip, a choice list,
// a panel empty state. Screens take elements from here so that look and behavior are uniform.
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Hover tooltip. Empty text means an element without a tooltip.
export function Tip({ text, children }: { text: string | undefined; children: ReactNode }) {
  if (!text) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-72">{text}</TooltipContent>
    </Tooltip>
  );
}

// A button with a single icon: the tooltip and assistive technology give its name.
// A disabled button receives no mouse events, so a wrapper holds the tooltip.
export function IconButton({
  label,
  size = "icon",
  variant = "ghost",
  ...props
}: Omit<ComponentProps<typeof Button>, "aria-label"> & { label: string }) {
  return (
    <Tip text={label}>
      <span className="inline-flex">
        <Button type="button" variant={variant} size={size} aria-label={label} {...props} />
      </span>
    </Tip>
  );
}

export interface ChoiceOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface ChoiceGroup {
  group: string;
  options: readonly ChoiceOption[];
}

// Radix does not accept an empty string as an item value: it is replaced while shown.
const EMPTY = "__empty__";
const toItem = (value: string): string => (value === "" ? EMPTY : value);
const fromItem = (value: string): string => (value === EMPTY ? "" : value);

// Single-value choice list. End-to-end tests read the choice from the data-value of the list button,
// and find an item by role=option and data-value.
export function Choice(props: {
  value: string;
  onChange: (value: string) => void;
  options: readonly (ChoiceOption | ChoiceGroup)[];
  label?: string | undefined; // name for assistive technology, if there is no label beside it
  testid?: string | undefined;
  size?: "sm" | "default";
  disabled?: boolean | undefined;
  className?: string | undefined;
  // A button without the chosen item's text: only an arrow (the second half of a compound button).
  bare?: boolean;
}) {
  const item = (o: ChoiceOption) => (
    <SelectItem key={o.value} value={toItem(o.value)} disabled={o.disabled} data-value={o.value}>
      {o.label}
    </SelectItem>
  );
  return (
    <Select
      value={toItem(props.value)}
      onValueChange={(value) => {
        props.onChange(fromItem(value));
      }}
      {...(props.disabled === undefined ? {} : { disabled: props.disabled })}
    >
      <SelectTrigger
        size={props.size ?? "default"}
        aria-label={props.label}
        className={cn("max-w-full min-w-0", props.className)}
        data-testid={props.testid}
        data-value={props.value}
      >
        {!props.bare && <SelectValue />}
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-80">
        {props.options.map((o) =>
          "group" in o ? (
            <SelectGroup key={o.group}>
              <SelectLabel>{o.group}</SelectLabel>
              {o.options.map(item)}
            </SelectGroup>
          ) : (
            item(o)
          ),
        )}
      </SelectContent>
    </Select>
  );
}

// An empty panel: what will appear here, and the button for the next step.
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
      <p className="max-w-prose">{children}</p>
      {action}
    </div>
  );
}

// A panel control row: buttons and fields in one row under the tabs or the header.
export function Toolbar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-2 py-1.5", className)} {...props} />
  );
}

// Label of a field in the control row.
export function FieldLabel({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("flex items-center gap-1.5 text-muted-foreground", className)} {...props} />;
}

// A refusal message or a warning below the field.
export function Problem({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-destructive", className)} {...props} />;
}
