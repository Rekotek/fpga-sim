// The "Nets" tab of the bottom panel: the pins of the active configure and their levels as numbers.
// React sets the rows from the net list; the cell values update from the last frame
// on every screen frame.
import { HammerIcon } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { t } from "../i18n";
import { boardById } from "../project/assets";
import { build, currentSimulation } from "./actions";
import { formatInteger, formatRatio } from "./format";
import { EmptyState } from "./kit";
import { useApp } from "./state";
import { useFrame } from "./useFrame";

// Styling of the bottom panel tables: pinned header, dense rows.
export const TABLE_HEAD =
  "sticky top-0 z-10 bg-panel px-2 py-1 text-left text-[11px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase shadow-[inset_0_-1px_0_var(--border)]";
export const TABLE_CELL = "border-b border-border/60 px-2 py-0.5";

// Empty-state button: build the project. Disabled without a key and during a build.
export function BuildButton() {
  const building = useApp((s) => s.build.status === "building");
  const hasKey = useApp((s) => s.authStatus === "ok");
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={building || !hasKey}
      onClick={() => {
        void build();
      }}
      data-testid="empty-build"
    >
      <HammerIcon />
      {t("workspace.build")}
    </Button>
  );
}

export function NetsTable() {
  const nets = useApp((s) => s.nets);
  const board = useApp((s) => boardById(s.project?.board ?? ""));
  const body = useRef<HTMLTableSectionElement>(null);
  useFrame(() => {
    const live = currentSimulation()?.live;
    const rows = body.current?.rows;
    if (!live || !rows) return;
    for (let i = 0; i < rows.length; i += 1) {
      const net = live.nets[i];
      const cells = rows[i]?.cells;
      if (!net || !cells?.[3] || !cells[4] || !cells[5]) continue;
      cells[3].textContent = String(net.level);
      cells[4].textContent = formatInteger(net.toggles);
      cells[5].textContent = formatRatio(net.duty);
    }
  });
  const number = `${TABLE_CELL} text-right`;
  return (
    <section className="flex min-h-0 flex-col overflow-auto">
      {nets.length === 0 ? (
        <EmptyState action={<BuildButton />}>{t("nets.empty")}</EmptyState>
      ) : (
        <table className="w-full border-separate border-spacing-0 font-mono text-xs tabular-nums" data-testid="nets">
          <thead className="font-sans">
            <tr>
              <th className={`${TABLE_HEAD} w-16 text-right`}>{t("nets.column.pin")}</th>
              <th className={TABLE_HEAD}>{t("nets.column.name")}</th>
              <th className={TABLE_HEAD}>{t("nets.column.port")}</th>
              <th className={`${TABLE_HEAD} w-24 text-right`}>{t("nets.column.level")}</th>
              <th className={`${TABLE_HEAD} w-36 text-right`}>{t("nets.column.toggles")}</th>
              <th className={`${TABLE_HEAD} w-36 text-right`}>{t("nets.column.duty")}</th>
            </tr>
          </thead>
          <tbody ref={body}>
            {nets.map((net) => (
              <tr key={net.pin} className="hover:bg-accent/60">
                <td className={number}>{net.pin}</td>
                <td className={TABLE_CELL}>{board?.pins[String(net.pin)]?.name ?? ""}</td>
                <td className={TABLE_CELL}>{net.port ?? ""}</td>
                <td className={number} />
                <td className={number} />
                <td className={number} />
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
