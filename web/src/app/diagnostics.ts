// Display of build messages (spec section 7.6): the translation and the level come from spec/diagnostics.json.
import type { Diagnostic } from "../build/types";
import { fill, localized } from "../i18n";
import { diagnosticEntry, type DiagnosticLevel } from "../project/assets";

// Short text from the table with substitutions from args; for an unknown code, the original text.
export function diagnosticText(diagnostic: Diagnostic): string {
  const template = localized(diagnosticEntry(diagnostic.code)?.text);
  return template ? fill(template, diagnostic.args) : diagnostic.original;
}

// Explanation of a message: two or three sentences with a fix example; not every code has one.
export function diagnosticExplain(diagnostic: Diagnostic): string | null {
  const template = localized(diagnosticEntry(diagnostic.code)?.explain);
  return template ? fill(template, diagnostic.args) : null;
}

// Errors always show; a warning with an unknown code is a notice.
export function diagnosticLevel(diagnostic: Diagnostic): DiagnosticLevel | "error" {
  if (diagnostic.severity === "error") return "error";
  return diagnosticEntry(diagnostic.code)?.level ?? "note";
}

const ORDER: Record<DiagnosticLevel | "error", number> = { error: 0, important: 1, note: 2, hidden: 3 };

// List for the "Messages" tab: without hidden ones, errors first.
export function visibleDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics
    .filter((d) => diagnosticLevel(d) !== "hidden")
    .sort((a, b) => ORDER[diagnosticLevel(a)] - ORDER[diagnosticLevel(b)]);
}
