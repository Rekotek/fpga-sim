// The "Signals" tab (spec section 9.3): on the left a signal tree with search, on the right the watch list
// (name, value, number base). Values are read from the last frame on every screen frame,
// bypassing React state.
import { ActivityIcon, ChevronDownIcon, ChevronRightIcon, EyeIcon, XIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t, tOr } from "../i18n";
import { recordSettings, watchItems, MAX_RECORD_SIGNALS } from "../wave/config";
import { RADIXES, formatValue, isRadix } from "../wave/format";
import { treeRows, type TreeRow } from "../wave/tree";
import { addRecordSignal, addWatch, removeWatch, setWatchRadix, showInternalSignals, watchRows } from "./actions";
import { Choice, EmptyState, IconButton } from "./kit";
import { BuildButton, TABLE_CELL, TABLE_HEAD } from "./NetsTable";
import { useApp } from "./state";
import { useFrame } from "./useFrame";

const MAX_TREE_ROWS = 400; // tree rows on screen; search finds the rest

function rowInfo(row: TreeRow): string {
  if (row.pin) return row.pin.port ?? "";
  const signal = row.signal;
  if (!signal) return "";
  const kind = tOr(`signals.kind.${signal.kind}`, "signals.kind.wire", { depth: signal.depth ?? 0 });
  return signal.width > 1 ? `${kind}, ${t("signals.width", { width: signal.width })}` : kind;
}

function Tree() {
  const signals = useApp((s) => s.signals);
  const nets = useApp((s) => s.nets);
  const config = useApp((s) => s.config);
  const visibility = useApp((s) => s.resolved?.visibility);
  const [search, setSearch] = useState("");
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const rows = useMemo(
    () => treeRows(signals, nets, search, closed, t("signals.pins")),
    [signals, nets, search, closed],
  );
  const watched = new Set(watchItems(config).map((i) => i.signal));
  const recorded = recordSettings(config).signals;
  const toggle = (key: string): void => {
    const next = new Set(closed);
    if (!next.delete(key)) next.add(key);
    setClosed(next);
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="shrink-0 border-b p-1.5">
        <Input
          type="search"
          value={search}
          placeholder={t("signals.search")}
          aria-label={t("signals.search")}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          data-testid="signals-search"
        />
      </div>
      {visibility === "ports" && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-warning-soft px-2 py-1.5">
          <p className="min-w-0 flex-1 basis-64">{t("signals.portsOnly")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void showInternalSignals();
            }}
            data-testid="signals-show-internal"
          >
            {t("signals.showInternal")}
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <ul className="py-0.5" data-testid="signals-tree">
          {rows.slice(0, MAX_TREE_ROWS).map((row) => {
            const name = row.name;
            return (
              <li key={row.key} style={{ paddingLeft: `${String(4 + row.depth * 14)}px` }}>
                {name === null ? (
                  <button
                    type="button"
                    className="flex h-6 w-full items-center gap-1 rounded-sm px-1 text-left font-mono text-xs font-semibold outline-none hover:bg-accent focus-visible:bg-accent"
                    aria-expanded={row.open}
                    onClick={() => {
                      toggle(row.key);
                    }}
                    data-testid="signal-group"
                    data-name={row.key}
                  >
                    {row.open ? (
                      <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate">{row.label}</span>
                  </button>
                ) : (
                  <div
                    className="flex h-6 items-center gap-2 rounded-sm pr-1 pl-5.5 hover:bg-accent/60"
                    data-testid="signal-row"
                    data-name={name}
                  >
                    <span className="shrink-0 font-mono text-xs" title={name}>
                      {row.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums">
                      {rowInfo(row)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-5.5"
                      disabled={watched.has(name) || row.signal?.kind === "memory"}
                      onClick={() => {
                        void addWatch(name);
                      }}
                      data-testid="signal-watch"
                    >
                      <EyeIcon />
                      {t("signals.toWatch")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-5.5"
                      disabled={
                        recorded.includes(name) ||
                        recorded.length >= MAX_RECORD_SIGNALS ||
                        row.signal?.kind === "memory"
                      }
                      onClick={() => {
                        void addRecordSignal(name);
                      }}
                      data-testid="signal-record"
                    >
                      <ActivityIcon />
                      {t("signals.toRecord")}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {rows.length > MAX_TREE_ROWS && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {t("signals.more", { shown: MAX_TREE_ROWS, total: rows.length })}
          </p>
        )}
      </div>
    </div>
  );
}

function WatchList() {
  const config = useApp((s) => s.config);
  const items = watchItems(config);
  const body = useRef<HTMLTableSectionElement>(null);
  useFrame(() => {
    const rows = body.current?.rows;
    if (!rows) return;
    watchRows().forEach((row, i) => {
      const cell = rows[i]?.cells[1];
      if (!cell) return;
      const text = row.value === null ? t("signals.noValue") : formatValue(row.value, row.width, row.radix);
      if (cell.textContent !== text) cell.textContent = text;
    });
  });
  return (
    <div className="flex min-h-0 min-w-0 flex-col border-l">
      <h3 className="shrink-0 border-b bg-panel px-2 py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {t("signals.watch.title")}
      </h3>
      {items.length === 0 ? (
        <EmptyState>{t("signals.watch.empty")}</EmptyState>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-xs" data-testid="watch">
            <thead>
              <tr>
                <th className={TABLE_HEAD}>{t("signals.column.name")}</th>
                <th className={TABLE_HEAD}>{t("signals.column.value")}</th>
                <th className={TABLE_HEAD}>{t("signals.column.radix")}</th>
                <th className={`${TABLE_HEAD} w-8`} />
              </tr>
            </thead>
            <tbody ref={body}>
              {items.map((item) => (
                <tr key={item.signal} className="hover:bg-accent/60" data-testid="watch-row" data-name={item.signal}>
                  <td className={`${TABLE_CELL} font-mono break-all`}>{item.signal}</td>
                  <td className={`${TABLE_CELL} font-mono break-all tabular-nums`} data-testid="watch-value" />
                  <td className={TABLE_CELL}>
                    <Choice
                      size="sm"
                      value={item.radix}
                      label={t("signals.column.radix")}
                      onChange={(value) => {
                        if (isRadix(value)) void setWatchRadix(item.signal, value);
                      }}
                      options={RADIXES.map((radix) => ({ value: radix, label: t(`radix.${radix}`) }))}
                      testid="watch-radix"
                    />
                  </td>
                  <td className={TABLE_CELL}>
                    <IconButton
                      label={t("signals.remove")}
                      size="icon-xs"
                      onClick={() => {
                        void removeWatch(item.signal);
                      }}
                      data-testid="watch-remove"
                    >
                      <XIcon />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function SignalsPanel() {
  const loaded = useApp((s) => s.sim.loaded);
  return (
    <section className="grid min-h-0 grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" data-testid="signals">
      {loaded ? (
        <Tree />
      ) : (
        <div className="flex min-h-0 min-w-0 flex-col">
          <EmptyState action={<BuildButton />}>{t("signals.empty")}</EmptyState>
        </div>
      )}
      <WatchList />
    </section>
  );
}
