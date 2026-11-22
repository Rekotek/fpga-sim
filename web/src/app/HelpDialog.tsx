// Short help: the order of work with the simulator, step by step.
// The sections and the line count of each are set here; the texts are in the dictionary (help.<section>.title, help.<section>.N).
// Screenshots (decision 116) are in public/help/<name>-light.png and <name>-dark.png: the help shows
// the set for the current theme. e2e/tests/help-shots.spec.ts creates the screenshots and their sizes (helpShots.json).
import { CircleHelpIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { currentLanguage, t, type TextKey } from "../i18n";
import shotSizesEn from "./helpShots.en.json";
import shotSizesRu from "./helpShots.json";
import { IconButton } from "./kit";
import { DialogFrame } from "./Modal";
import { Rich } from "./Rich";
import { useTheme } from "./theme";

export type HelpShot = keyof typeof shotSizesRu;

// A section, its text line count, and the screenshots under the text. A screenshot caption is help.shot.<name> in the dictionary.
export const HELP_SECTIONS: [name: string, items: number, shots: HelpShot[]][] = [
  ["start", 4, ["projects"]],
  ["account", 6, []],
  ["build", 4, ["workspace"]],
  ["run", 4, []],
  ["board", 5, ["board", "binding", "terminal"]],
  ["debug", 5, ["signals", "waves", "testbench"]],
  ["folder", 3, []],
  ["limits", 2, []],
];
const SECTIONS = HELP_SECTIONS;
const SHOTS = SECTIONS.reduce((sum, [, , shots]) => sum + shots.length, 0);

// A screenshot with a caption. Width and height are set in advance: the text does not shift while the image loads.
// A click opens the screenshot at full size in a new tab.
function Shot({ name }: { name: HelpShot }) {
  const dark = useTheme((s) => s.dark);
  // Screenshots of the English interface have the -en suffix and their own sizes (decision 168).
  const en = currentLanguage() === "en";
  const [width, height] = (en ? shotSizesEn : shotSizesRu)[name];
  const suffix = en ? "-en" : "";
  const src = `${import.meta.env.BASE_URL}help/${name}-${dark ? "dark" : "light"}${suffix}.png`;
  const caption = t(`help.shot.${name}` as TextKey);
  return (
    <figure className="mt-3">
      <a href={src} target="_blank" rel="noreferrer" title={t("help.shot.open")} className="block cursor-zoom-in">
        <img
          src={src}
          alt={caption}
          width={width}
          height={height}
          className="h-auto max-w-full rounded-md border"
          data-testid="help-shot"
          data-shot={name}
        />
      </a>
      <figcaption className="mt-1 text-xs text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}

let helpOpen = false;

// Help state for window.__fpgasim (spec section 9.7): whether it is open, how many sections and screenshots it has.
export const helpState = (): { open: boolean; sections: number; shots: number } => ({
  open: helpOpen,
  sections: SECTIONS.length,
  shots: SHOTS,
});

export function HelpButton() {
  const [current, setCurrent] = useState(SECTIONS[0]?.[0] ?? "");
  const body = useRef<HTMLDivElement>(null);
  return (
    <Dialog
      onOpenChange={(open) => {
        helpOpen = open;
      }}
    >
      <DialogTrigger asChild>
        <IconButton label={t("help.button")} data-testid="help-open">
          <CircleHelpIcon />
        </IconButton>
      </DialogTrigger>
      <DialogFrame testid="help" title={t("help.title")} wide closeTestid="help-close" bodyClassName="flex p-0">
        {/* On the left, the section list: a click scrolls the text to the section. */}
        <nav className="hidden w-52 shrink-0 flex-col gap-px overflow-y-auto border-r bg-panel p-2 sm:flex">
          {SECTIONS.map(([name]) => (
            <button
              key={name}
              type="button"
              className={cn(
                "rounded-sm px-2 py-1 text-left text-muted-foreground hover:bg-accent hover:text-foreground",
                name === current && "bg-selected font-medium text-foreground",
              )}
              onClick={() => {
                setCurrent(name);
                body.current?.querySelector(`[data-section="${name}"]`)?.scrollIntoView({ block: "start" });
              }}
            >
              {t(`help.${name}.title` as TextKey)}
            </button>
          ))}
        </nav>
        <div ref={body} className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
          {SECTIONS.map(([name, items, shots]) => (
            <section key={name} className="mb-5 last:mb-0" data-section={name} data-testid="help-section">
              <h3 className="mb-1.5 text-sm font-semibold">{t(`help.${name}.title` as TextKey)}</h3>
              <ol className="list-decimal space-y-1.5 pl-5 leading-relaxed marker:text-muted-foreground">
                {Array.from({ length: items }, (_, i) => (
                  <li key={i}>
                    <Rich text={t(`help.${name}.${String(i + 1)}` as TextKey)} />
                  </li>
                ))}
              </ol>
              {shots.map((shot) => (
                <Shot key={shot} name={shot} />
              ))}
            </section>
          ))}
        </div>
      </DialogFrame>
    </Dialog>
  );
}
