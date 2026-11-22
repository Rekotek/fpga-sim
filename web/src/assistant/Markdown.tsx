// The assistant's answers (decision 175): a small Markdown subset built as React nodes, never as HTML.
// Headings (#–###), lists (- and 1.), **bold**, `inline code` and fenced code blocks; the rest is plain text.
import type { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined)
      nodes.push(
        <code key={m.index} className="rounded-sm bg-muted px-1 font-mono text-[0.92em]">
          {m[1]}
        </code>,
      );
    else nodes.push(<strong key={m.index}>{m[2]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

type Block =
  | { kind: "code"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "text"; lines: string[] };

const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;

export function blocks(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trimStart().startsWith("```")) {
      const body: string[] = [];
      for (i++; i < lines.length && !(lines[i] ?? "").trimStart().startsWith("```"); i++) body.push(lines[i] ?? "");
      out.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      out.push({ kind: "heading", text: heading[1] ?? "" });
      continue;
    }
    const item = BULLET.exec(line) ?? NUMBER.exec(line);
    if (item) {
      const ordered = NUMBER.test(line);
      const prev = out.at(-1);
      if (prev?.kind === "list" && prev.ordered === ordered) prev.items.push(item[1] ?? "");
      else out.push({ kind: "list", ordered, items: [item[1] ?? ""] });
      continue;
    }
    if (!line.trim()) {
      out.push({ kind: "text", lines: [] });
      continue;
    }
    const prev = out.at(-1);
    if (prev?.kind === "text" && prev.lines.length > 0) prev.lines.push(line);
    else out.push({ kind: "text", lines: [line] });
  }
  return out.filter((b) => b.kind !== "text" || b.lines.length > 0);
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2 leading-relaxed">
      {blocks(text).map((block, i) => {
        if (block.kind === "code")
          return (
            <pre
              key={i}
              className="m-0 overflow-x-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs leading-[1.4]"
            >
              {block.text}
            </pre>
          );
        if (block.kind === "heading")
          return (
            <p key={i} className="font-semibold">
              {inline(block.text)}
            </p>
          );
        if (block.kind === "list") {
          const items = block.items.map((item, j) => <li key={j}>{inline(item)}</li>);
          return block.ordered ? (
            <ol key={i} className="list-decimal space-y-0.5 pl-5">
              {items}
            </ol>
          ) : (
            <ul key={i} className="list-disc space-y-0.5 pl-5">
              {items}
            </ul>
          );
        }
        return (
          <p key={i}>
            {block.lines.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {inline(line)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
