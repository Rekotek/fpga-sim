// The "Board" area (spec section 9.3): a Canvas with the board drawing, a hover tooltip, a color legend
// and a list of board devices without a model. Drawing runs on every screen frame, outside React.
import { ChevronRightIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { bindPartPin, currentScene, currentSimulation, openDialog, partCommand } from "../app/actions";
import { IconButton } from "../app/kit";
import { useApp } from "../app/state";
import { useTheme } from "../app/theme";
import { formatHz } from "../app/format";
import { useFrame } from "../app/useFrame";
import { localized, t, tOr } from "../i18n";
import { boardById, partDescription } from "../project/assets";
import { projectParts } from "../project/config";
import type { HintLine } from "../parts/types";
import type { SendPart } from "./scene";

const LEGEND = ["busy", "free", "onboard", "clock", "forbidden"] as const;
// Legend swatches repeat the pin colors of the drawing (PIN_COLORS in scene.ts): they do not depend on the theme.
const SWATCH = "size-2.5 shrink-0 border-2 bg-[#2f343c]";
const LEGEND_COLOR: Record<(typeof LEGEND)[number], string> = {
  busy: "border-[#3d8bff]",
  free: "border-[#3fae5a]",
  onboard: "border-[#9aa3ad]",
  clock: "border-[#b07cff]",
  forbidden: "border-[#e5484d]",
};
// Header of a collapsible block: same as an area header.
const SECTION =
  "group flex h-7 w-full items-center gap-1 px-1.5 text-left text-[11px] font-semibold tracking-wider text-muted-foreground uppercase hover:text-foreground";

// A part command goes to the core; before a build there is no core, and a press only shows on the drawing.
const sendPart: SendPart = (part, cmd, args) => {
  partCommand(part, cmd, args);
};

// Button keys work when focus is not in the editor or an input field (spec section 9.4).
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest("input, textarea, select, dialog, [role=dialog], [role=listbox], .cm-editor") !== null
  );
}

function hintText(lines: HintLine[]): string {
  return lines
    .map((line) => {
      const args = { ...line.args };
      if (typeof args.hz === "number") args.hz = formatHz(args.hz);
      return tOr(line.key, "hint.unknown", args);
    })
    .join("\n");
}

export function BoardView() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  // Theme change: themeColor returns the new colors, and the next frame redraws the drawing.
  useTheme((s) => s.revision);

  useFrame(() => {
    const element = canvas.current;
    const scene = currentScene();
    const ctx = element?.getContext("2d");
    if (!element || !scene || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const width = element.clientWidth;
    const height = element.clientHeight;
    if (width === 0 || height === 0) return;
    if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) {
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
    }
    const live = currentSimulation()?.live ?? null;
    const now = performance.now();
    const at = pointer.current;
    const found = at ? scene.hover(at.x, at.y, live, now) : null;
    if (!at) scene.leave();
    scene.draw(ctx, width, height, ratio, live, now);
    element.style.cursor = found?.clickable ? "pointer" : "default";
    const box = hint.current;
    if (box) {
      box.hidden = !found || !at;
      if (found && at) {
        const text = hintText(found.lines);
        if (box.textContent !== text) box.textContent = text;
        box.style.left = `${String(Math.min(at.x + 14, Math.max(0, width - 220)))}px`;
        box.style.top = `${String(at.y + 16)}px`;
      }
    }
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // A release is always accepted, from an input field and with a modifier held: otherwise a key
      // pressed earlier gets stuck. A press works only outside input fields and without Ctrl, Cmd, Alt.
      if (event.type === "keydown" && (event.ctrlKey || event.metaKey || event.altKey || typing(event.target))) return;
      currentScene()?.key(event, sendPart);
    };
    const onUp = (event: PointerEvent): void => {
      const kind = event.type === "pointercancel" ? "cancel" : "up";
      const bind = currentScene()?.pointerUp(kind, event.shiftKey, sendPart);
      if (bind) bindPartPin(bind.part, bind.role, bind.pin);
    };
    const onBlur = (): void => {
      currentScene()?.drop(sendPart);
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const place = (event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const devices = currentScene()?.board.devices ?? [];
  const config = useApp((s) => s.config);
  const board = useApp((s) => boardById(s.project?.board ?? ""));
  const parts = board ? projectParts(board, config) : [];
  const extra = parts.filter((p) => p.origin === "breadboard");
  const changed = parts.filter((p) => p.origin === "board" && config?.boardParts?.[p.id] !== undefined);
  // In the list, breadboard parts come first: there are fewer of them and they are used more often.
  const listed = [...extra, ...parts.filter((p) => p.origin === "board")];
  // Until the list is touched, it is open if the project has its own parts or edits of built-in ones.
  const [partsChoice, setPartsChoice] = useState<boolean | null>(null);
  const partsOpen = partsChoice ?? extra.length + changed.length > 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-col bg-panel">
      <div className="relative min-h-0 flex-1">
        <canvas
          ref={canvas}
          className="absolute inset-0 size-full touch-none"
          data-testid="board"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const at = place(event);
            const opens = currentScene()?.tabAt(at.x, at.y);
            if (opens) useApp.setState({ bottomTab: `${opens.tab}:${opens.part}` });
            if (currentScene()?.pointerDown(at.x, at.y, event.shiftKey, sendPart)) event.preventDefault();
          }}
          onPointerMove={(event) => {
            pointer.current = place(event);
            currentScene()?.pointerMove(pointer.current.x, pointer.current.y);
          }}
          onPointerLeave={() => {
            pointer.current = null;
          }}
        />
        {/* The tooltip is shown and moved by the frame drawing, outside React. */}
        <div
          className="board-hint pointer-events-none absolute z-10 max-w-[220px] rounded-md bg-foreground px-2 py-1 text-xs whitespace-pre-line text-background shadow-md"
          ref={hint}
          hidden
        />
      </div>
      <ul className="flex shrink-0 flex-wrap gap-x-3 gap-y-0.5 border-t px-2.5 py-1.5 text-xs text-muted-foreground">
        {LEGEND.map((state) => (
          <li key={state} className="flex items-center gap-1.5">
            <i className={cn(SWATCH, LEGEND_COLOR[state])} />
            {t(`board.legend.${state}`)}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <i className={cn(SWATCH, "border-[#3d8bff] bg-[#ffd84a]")} />
          {t("board.legend.high")}
        </li>
      </ul>
      <Collapsible open={partsOpen} onOpenChange={setPartsChoice} className="shrink-0 border-t">
        <CollapsibleTrigger className={SECTION} data-testid="parts-summary">
          <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
          <span className="truncate">{t("board.parts", { count: extra.length, changed: changed.length })}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="max-h-32 overflow-y-auto pr-1 pb-1 pl-1.5 text-xs">
            {listed.map((part) => (
              <li key={part.id} className={cn("flex items-center gap-1", !part.enabled && "opacity-60")}>
                <IconButton
                  label={t("part.editHint")}
                  size="icon-xs"
                  onClick={() => {
                    openDialog({ kind: "part", part: part.id });
                  }}
                  data-testid={`part-edit-${part.id}`}
                >
                  <PencilIcon />
                </IconButton>
                <span className="min-w-0 truncate">
                  {t(part.origin === "board" ? "board.part.onBoard" : "board.part.onBreadboard", {
                    label: part.label,
                    type: localized(partDescription(part.type)?.name) || part.type,
                    pins: Object.values(part.pins),
                  })}
                  {!part.enabled && t("board.part.off")}
                </span>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
      <Collapsible className="shrink-0 border-t">
        <CollapsibleTrigger className={SECTION} data-testid="devices-summary">
          <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
          <span className="truncate">{t("board.devices", { count: devices.length })}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="max-h-32 overflow-y-auto px-2.5 pb-1.5 text-xs text-muted-foreground">
            {devices.map((device) => (
              <li key={device.id} className="flex gap-2 py-0.5">
                <span className="text-foreground">{localized(device.label)}</span>
                <span>
                  {device.since === null ? t("board.device.never") : t("board.device.since", { version: device.since })}
                </span>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// Actions of the "Board" area for its header: pin binding and a new part on the breadboard.
export function BoardActions() {
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          openDialog({ kind: "binding" });
        }}
        data-testid="binding-open"
      >
        {t("board.binding")}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          openDialog({ kind: "part", part: null });
        }}
        data-testid="part-add"
      >
        <PlusIcon />
        {t("board.addPart")}
      </Button>
    </>
  );
}
