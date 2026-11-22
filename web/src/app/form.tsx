// Dialog form: label on the left, field on the right; below the field, an explanation and the reason for a refusal.
import type { ComponentProps, ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Form grid. The form buttons sit in the bottom row of the dialog and refer to the form by the form attribute.
export function FormGrid({ className, ...props }: ComponentProps<"form">) {
  return (
    <form
      className={cn("grid grid-cols-[minmax(7rem,max-content)_minmax(0,1fr)] items-start gap-x-4 gap-y-3", className)}
      {...props}
    />
  );
}

// Form row. htmlFor links the label to the input; for a choice list, the list sets its own name.
export function FormRow(props: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <>
      <Label htmlFor={props.htmlFor} className="min-h-7 leading-tight font-normal text-muted-foreground">
        {props.label}
      </Label>
      <div className={cn("flex min-w-0 flex-col items-start gap-1", props.className)}>
        {props.children}
        {props.hint && <p className="text-xs text-muted-foreground">{props.hint}</p>}
      </div>
    </>
  );
}

// A message across the whole form width: an explanation, a warning or a refusal.
export function FormNote({
  tone = "muted",
  className,
  ...props
}: ComponentProps<"p"> & { tone?: "muted" | "warning" | "problem" }) {
  return (
    <p
      className={cn(
        "col-span-full text-xs",
        tone === "muted" && "text-muted-foreground",
        tone === "warning" && "rounded-md bg-warning-soft px-2.5 py-1.5 text-warning",
        tone === "problem" && "text-destructive",
        className,
      )}
      {...props}
    />
  );
}

// The reason for a refusal below the field.
export function FieldProblem({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-xs text-destructive", className)} {...props} />;
}
