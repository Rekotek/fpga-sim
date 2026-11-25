// The text of a server or core refusal in the interface language (decision 183). The server and the core send
// a Russian text for their logs and, where one code has several causes, the field args: args.reason picks
// the string refusal.<reason>, the other fields are substituted into it. Without args the string comes by
// the code (error.<code>); a code unknown to the dictionary shows as "code: text".
import { fill, lookupText, tOr } from "./index";

export type RefusalArgs = { reason: string } & Record<string, string | number | boolean>;

// The args field of a reply, if it has the expected shape.
export function refusalArgs(value: unknown): RefusalArgs | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const reason = (value as Record<string, unknown>).reason;
  return typeof reason === "string" ? (value as RefusalArgs) : null;
}

export function refusalText(code: string, args: RefusalArgs | null, original: string): string {
  const template = args ? lookupText(`refusal.${args.reason}`) : undefined;
  if (template !== undefined) return fill(template, args ?? {});
  return tOr(`error.${code}`, "error.UNKNOWN", { code, text: original });
}

// A core notice by its code (notice.<code>); a code unknown to the dictionary shows the core text.
export function noticeText(code: string, original: string): string {
  return lookupText(`notice.${code}`) ?? original;
}

// The text of a failure for display: a refusal with a code (ServerError, CoreError) by refusalText,
// any other error by its message.
export function failureText(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const { code, args } = e as Error & { code?: unknown; args?: unknown };
  return typeof code === "string" ? refusalText(code, refusalArgs(args), e.message) : e.message;
}
