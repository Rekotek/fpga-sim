// The "Messages" tab (spec sections 7.6 and 9.3): errors and important warnings as a list, notices
// under a collapsed header, simulator notices with the simulation time. A message has an explanation.
import { CheckIcon, ChevronRightIcon, CircleHelpIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Diagnostic } from "../build/types";
import { t } from "../i18n";
import { noticeText } from "../i18n/refusal";
import { chooseTop, gotoDiagnostic } from "./actions";
import { diagnosticExplain, diagnosticLevel, diagnosticText, visibleDiagnostics } from "./diagnostics";
import { simSeconds } from "./format";
import { EmptyState, IconButton, Tip } from "./kit";
import { Rich } from "./Rich";
import { useApp } from "./state";

// Color of the level label: error, important warning, notice.
const LEVEL_CLASS = {
  error: "text-destructive",
  important: "text-warning",
  note: "text-muted-foreground",
} as const;

const SEVERITY = "shrink-0 text-xs font-semibold";
const CODE = "shrink-0 font-mono text-xs text-muted-foreground";

export function Message({ diagnostic }: { diagnostic: Diagnostic }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rawLevel = diagnosticLevel(diagnostic);
  const level = rawLevel === "hidden" ? "note" : rawLevel;
  const explain = diagnosticExplain(diagnostic);
  const translated = diagnosticText(diagnostic) !== diagnostic.original;
  // Several top module candidates: the choice is written to design.top (spec section 2.5).
  const found = diagnostic.code === "TOP_AMBIGUOUS" ? diagnostic.args?.candidates : undefined;
  const candidates = Array.isArray(found) ? found.map(String) : [];
  return (
    <li className="border-b border-border/60" data-level={level} data-code={diagnostic.code}>
      <div className="flex items-start gap-1 pr-1.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 px-2 py-1 text-left outline-none hover:bg-accent focus-visible:bg-accent"
          onClick={() => {
            gotoDiagnostic(diagnostic);
          }}
          data-testid="message"
        >
          <span className={cn(SEVERITY, LEVEL_CLASS[level])}>{t(`messages.severity.${level}`)}</span>
          {diagnostic.file && (
            <span className="shrink-0 font-mono text-xs text-primary tabular-nums underline underline-offset-2">
              {diagnostic.line ? `${diagnostic.file}:${String(diagnostic.line)}` : diagnostic.file}
            </span>
          )}
          <span className={CODE}>{diagnostic.code}</span>
          <span className="min-w-0 break-words">
            <Rich text={diagnosticText(diagnostic)} />
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1 py-0.5">
          {candidates.map((name) => (
            <Tip key={name} text={t("messages.chooseTopHint")}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void chooseTop(name);
                }}
                data-testid="choose-top"
              >
                {t("messages.chooseTop", { name })}
              </Button>
            </Tip>
          ))}
          {diagnostic.code === "TOOLCHAIN_FAILED" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(diagnostic.original).then(() => {
                  setCopied(true);
                });
              }}
              data-testid="message-copy"
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              {t(copied ? "messages.copied" : "messages.copy")}
            </Button>
          )}
          {(explain !== null || translated) && (
            <IconButton
              label={t("messages.explain")}
              size="icon-sm"
              variant={open ? "secondary" : "ghost"}
              aria-expanded={open}
              onClick={() => {
                setOpen(!open);
              }}
              data-testid="message-explain"
            >
              <CircleHelpIcon />
            </IconButton>
          )}
        </div>
      </div>
      {open && (
        <div
          className="mx-2 mb-1.5 space-y-1 rounded-r-sm border-l-2 border-input bg-muted px-3 py-1.5"
          data-testid="message-explanation"
        >
          {explain !== null && (
            <p>
              <Rich text={explain} />
            </p>
          )}
          {translated && (
            <p className="font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground">
              {t("messages.original", { text: diagnostic.original })}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function MessagesPanel() {
  const diagnostics = useApp((s) => s.diagnostics);
  const notices = useApp((s) => s.notices);
  const shown = visibleDiagnostics(diagnostics);
  const main = shown.filter((d) => diagnosticLevel(d) !== "note");
  const notes = shown.filter((d) => diagnosticLevel(d) === "note");
  const key = (d: Diagnostic, i: number): string => `${d.code}:${d.file ?? ""}:${String(d.line ?? 0)}:${String(i)}`;
  return (
    <section className="flex min-h-0 flex-col overflow-auto" data-testid="messages">
      {shown.length + notices.length === 0 && <EmptyState>{t("messages.empty")}</EmptyState>}
      {main.length > 0 && (
        <ul>
          {main.map((d, i) => (
            <Message key={key(d, i)} diagnostic={d} />
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <details className="group border-b border-border/60" data-testid="notes">
          <summary className="flex cursor-pointer list-none items-center gap-1 bg-panel px-2 py-1 text-xs font-medium text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon className="size-3.5 transition-transform group-open:rotate-90" />
            {t("messages.notes", { count: notes.length })}
          </summary>
          <ul className="border-t border-border/60">
            {notes.map((d, i) => (
              <Message key={key(d, i)} diagnostic={d} />
            ))}
          </ul>
        </details>
      )}
      {notices.length > 0 && (
        <ul>
          {notices.map((n, i) => (
            <li
              key={`n${String(i)}`}
              className="flex flex-wrap items-baseline gap-x-2 border-b border-border/60 px-2 py-1"
              data-testid="notice"
            >
              <span className={cn(SEVERITY, "text-muted-foreground tabular-nums")}>
                {t("messages.notice", { seconds: simSeconds(n.time) })}
              </span>
              <span className={CODE}>{n.code}</span>
              <span className="min-w-0 break-words">{noticeText(n.code, n.text)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
