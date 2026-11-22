// The "UART terminal" tab (spec section 6.3): output, input line, view as text or
// as hexadecimal codes, clear, save the log to a file. The log is read on every screen
// frame, bypassing React state.
import { DownloadIcon, EraserIcon, SendHorizontalIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { t } from "../i18n";
import { uartCounters } from "../parts/uart";
import { boardById, partDescription } from "../project/assets";
import { projectParts, withDefaults } from "../project/config";
import { inputBytes, terminalHex, terminalText, type LineEnding, type Terminal } from "../sim/terminal";
import { currentSimulation, partCommand } from "./actions";
import { formatInteger } from "./format";
import { useApp } from "./state";
import { useFrame } from "./useFrame";

const INFO = "text-xs whitespace-nowrap text-muted-foreground tabular-nums";
const SHOWN_BYTES = 64 * 1024; // the screen shows the log tail; the whole log goes to the file

function saveLog(part: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${part}.log`;
  link.click();
  URL.revokeObjectURL(url);
}

export function TerminalPanel({ part }: { part: string }) {
  const [hex, setHex] = useState(false);
  const [text, setText] = useState("");
  const loaded = useApp((s) => s.sim.loaded);
  const config = useApp((s) => s.config);
  const board = useApp((s) => boardById(s.project?.board ?? ""));
  const item = board ? projectParts(board, config).find((p) => p.id === part) : undefined;
  const settings = withDefaults(partDescription("uart"), item?.settings);
  const ending = (typeof settings.lineEnding === "string" ? settings.lineEnding : "none") as LineEnding;
  const output = useRef<HTMLPreElement>(null);
  const counters = useRef<HTMLSpanElement>(null);
  const seen = useRef<{ log: Terminal | null; version: number; hex: boolean }>({ log: null, version: -1, hex });

  useFrame(() => {
    const live = currentSimulation()?.live;
    const log = live?.terminals.get(part) ?? null;
    const element = output.current;
    if (
      element &&
      (seen.current.log !== log || seen.current.version !== (log?.version ?? -1) || seen.current.hex !== hex)
    ) {
      seen.current = { log, version: log?.version ?? -1, hex };
      const bytes = log?.bytes() ?? new Uint8Array();
      const tail = bytes.subarray(Math.max(0, bytes.length - SHOWN_BYTES));
      // The output follows the log end until the user scrolls up.
      const follow = element.scrollHeight - element.scrollTop - element.clientHeight < 8;
      // A continuation of the previous text is appended: a mouse selection stays.
      const next = hex ? terminalHex(tail) : terminalText(tail);
      const shown = element.textContent;
      if (shown !== "" && next.startsWith(shown)) element.append(next.slice(shown.length));
      else element.textContent = next;
      if (follow) element.scrollTop = element.scrollHeight;
    }
    if (counters.current) {
      const { received, sent, queued } = uartCounters(live?.parts.get(part));
      const line = t("terminal.counters", {
        received: formatInteger(received),
        sent: formatInteger(sent),
        queued: formatInteger(queued),
      });
      if (counters.current.textContent !== line) counters.current.textContent = line;
    }
  });

  const send = (): void => {
    const bytes = inputBytes(text, ending);
    if (bytes.length === 0) return;
    partCommand(part, "send", { bytes });
    setText("");
  };

  return (
    <section className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]" data-testid={`terminal-${part}`}>
      <pre
        ref={output}
        className="m-0 min-h-0 overflow-auto bg-terminal px-2 py-1.5 font-mono text-xs leading-[1.4] break-all whitespace-pre-wrap text-terminal-foreground"
        data-testid="terminal-output"
      />
      <form
        className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t px-2 py-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <Input
          className="min-w-40 flex-1 font-mono text-xs"
          value={text}
          disabled={!loaded}
          placeholder={t(loaded ? "terminal.placeholder" : "terminal.noCore")}
          aria-label={t("terminal.placeholder")}
          onChange={(event) => {
            setText(event.target.value);
          }}
          data-testid="terminal-text"
        />
        <Button type="submit" size="sm" disabled={!loaded} data-testid="terminal-send">
          <SendHorizontalIcon />
          {t("terminal.send")}
        </Button>
        <span className={INFO}>
          {t("terminal.settings", { baud: settings.baud, ending: t(`terminal.ending.${ending}`) })}
        </span>
        <span className={INFO} ref={counters} data-testid="terminal-counters" />
        <label className="flex items-center gap-1.5">
          <Checkbox
            checked={hex}
            onCheckedChange={(checked) => {
              setHex(checked === true);
            }}
            data-testid="terminal-hex"
          />
          {t("terminal.hex")}
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            currentSimulation()?.live.terminals.get(part)?.clear();
          }}
          data-testid="terminal-clear"
        >
          <EraserIcon />
          {t("terminal.clear")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            saveLog(part, currentSimulation()?.live.terminals.get(part)?.bytes() ?? new Uint8Array());
          }}
          data-testid="terminal-save"
        >
          <DownloadIcon />
          {t("terminal.save")}
        </Button>
      </form>
    </section>
  );
}
