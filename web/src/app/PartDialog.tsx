// The part dialog (spec section 9.3, "Add part"): type from parts/, pins for roles, and settings.
// The settings form is built from the settings field of the part description. The same dialog edits a breadboard
// part and an onboard part (the boardParts field: whether it is enabled, and its settings).
import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { localized, t } from "../i18n";
import { boardById, partDescription, partTypes, type PartDescription, type SettingField } from "../project/assets";
import {
  nextPartId,
  partIdProblem,
  projectParts,
  settingFromText,
  settingProblem,
  settingValue,
  withDefaults,
  type PartItem,
} from "../project/config";
import { createWidget } from "../parts";
import { openDialog, removePart, saveBoardPart, savePart } from "./actions";
import { FieldProblem, FormGrid, FormNote, FormRow } from "./form";
import { Choice } from "./kit";
import { Modal, pinLabel } from "./Modal";
import { useApp } from "./state";

const FORM = "part-form";

function SettingInput(props: {
  id: string;
  name: string;
  label: string;
  field: SettingField;
  value: unknown;
  invalid: boolean;
  set: (value: unknown) => void;
}) {
  const { name, field, value, set } = props;
  const testid = `setting-${name}`;
  if (field.type === "boolean") {
    return (
      <span className="flex min-h-7 items-center">
        <Checkbox
          id={props.id}
          checked={value === true}
          onCheckedChange={(checked) => {
            set(checked === true);
          }}
          data-testid={testid}
        />
      </span>
    );
  }
  if (field.enum) {
    return (
      <Choice
        value={String(value)}
        label={props.label}
        className="font-mono"
        onChange={(text) => {
          set(settingFromText(field, text));
        }}
        options={field.enum.map((item) => ({ value: String(item), label: String(item) }))}
        testid={testid}
      />
    );
  }
  const numeric = field.type !== "string";
  return (
    <Input
      id={props.id}
      className={cn("font-mono", field.maxLength === 1 ? "w-14" : numeric && "w-32")}
      value={String(value)}
      inputMode={numeric ? "decimal" : undefined}
      maxLength={field.maxLength}
      aria-invalid={props.invalid}
      onChange={(event) => {
        // The number is stored as text while it is typed; it becomes a setting at validation.
        set(event.target.value);
      }}
      data-testid={testid}
    />
  );
}

// Only the differences from the base: the part description defaults, and for an onboard part also the board file's.
function changedSettings(values: Record<string, unknown>, base: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([name, value]) => value !== base[name]));
}

function Form(props: { title: string; item: PartItem | null; items: PartItem[]; types: string[] }) {
  const { item, items } = props;
  const board = useApp((s) => boardById(s.project?.board ?? ""));
  const taken = items.map((p) => p.id);
  const [type, setType] = useState(item?.type ?? props.types[0] ?? "led");
  const desc: PartDescription | undefined = partDescription(type);
  const [id, setId] = useState(item?.id ?? nextPartId(type, taken));
  const [idTouched, setIdTouched] = useState(false);
  const [pins, setPins] = useState<Record<string, number>>(item?.pins ?? {});
  const [values, setValues] = useState(() => withDefaults(desc, item?.settings));
  const [enabled, setEnabled] = useState(item?.enabled ?? true);
  const [failed, setFailed] = useState(false);
  const onBoard = item?.origin === "board";
  const boardPins = Object.entries(board?.pins ?? {}).sort(([a], [b]) => Number(a) - Number(b));
  const freePin = Number(boardPins.find(([, info]) => info.status === "free")?.[0] ?? boardPins[0]?.[0] ?? 0);

  const chooseType = (next: string): void => {
    setType(next);
    setPins({});
    setValues(withDefaults(partDescription(next), undefined));
    if (!idTouched) setId(nextPartId(next, taken));
  };

  const idProblem = item ? null : partIdProblem(id, taken);
  const fields = Object.entries(desc?.settings ?? {}).flatMap(([name, field]) => (field ? [{ name, field }] : []));
  const problems = new Map(
    fields.flatMap(({ name, field }) => {
      const found = settingProblem(field, settingValue(field, values[name]));
      return found ? [[name, found] as const] : [];
    }),
  );
  // A part with several pins may leave any of them unconnected (UART, spec section 6.3);
  // a new such part has its pins unconnected until they are chosen.
  const optional = (desc?.pins.length ?? 0) > 1;
  const pinOf = (role: string): number | undefined => pins[role] ?? (optional ? undefined : freePin);
  const connected = desc?.pins.some((pin) => pinOf(pin.role) !== undefined) ?? false;
  const valid = idProblem === null && problems.size === 0 && desc !== undefined && (onBoard || connected);

  const save = async (): Promise<void> => {
    if (!desc) return;
    const final = Object.fromEntries(fields.map(({ name, field }) => [name, settingValue(field, values[name])]));
    let done: boolean;
    if (onBoard) {
      const original = board?.parts.find((p) => p.id === item.id)?.settings;
      done = await saveBoardPart(item.id, { enabled, settings: changedSettings(final, withDefaults(desc, original)) });
    } else {
      const chosen = Object.fromEntries(
        desc.pins.flatMap((pin) => {
          const number = pinOf(pin.role);
          return number === undefined ? [] : [[pin.role, number] as const];
        }),
      );
      const settings = changedSettings(final, withDefaults(desc, undefined));
      done = await savePart({ id, type, pins: chosen, settings }, item?.id ?? null);
    }
    if (done) openDialog(null);
    else setFailed(true);
  };

  return (
    <Modal
      testid="part-dialog"
      title={props.title}
      footer={
        <>
          {item?.origin === "breadboard" && (
            <Button
              type="button"
              variant="outline"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                void removePart(item.id).then(() => {
                  openDialog(null);
                });
              }}
              data-testid="part-remove"
            >
              <Trash2Icon />
              {t("part.remove")}
            </Button>
          )}
          <Button type="submit" form={FORM} className="ml-auto" disabled={!valid} data-testid="part-save">
            {t(item ? "dialog.save" : "part.add")}
          </Button>
        </>
      }
    >
      <FormGrid
        id={FORM}
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) void save();
        }}
      >
        {!item && (
          <FormRow label={t("part.type")}>
            <Choice
              value={type}
              label={t("part.type")}
              onChange={chooseType}
              options={props.types.map((name) => ({
                value: name,
                label: localized(partDescription(name)?.name) || name,
              }))}
              testid="part-type"
            />
          </FormRow>
        )}
        <FormRow label={t("part.id")} htmlFor="part-id">
          <Input
            id="part-id"
            className="w-56 font-mono"
            value={id}
            disabled={item !== null}
            aria-invalid={idProblem !== null}
            onChange={(event) => {
              setId(event.target.value);
              setIdTouched(true);
            }}
            data-testid="part-id"
          />
          {idProblem && <FieldProblem data-testid="part-id-problem">{t(`part.idProblem.${idProblem}`)}</FieldProblem>}
        </FormRow>
        {onBoard && (
          <FormRow label={t("part.enabled")} htmlFor="part-enabled">
            <span className="flex min-h-7 items-center">
              <Checkbox
                id="part-enabled"
                checked={enabled}
                onCheckedChange={(checked) => {
                  setEnabled(checked === true);
                }}
                data-testid="part-enabled"
              />
            </span>
          </FormRow>
        )}
        {desc?.pins.map((pin) => {
          const label = t("part.pin", { role: localized(pin.label) || pin.role });
          return (
            <FormRow key={pin.role} label={label}>
              <Choice
                value={String(pinOf(pin.role) ?? "")}
                disabled={onBoard}
                label={label}
                className="font-mono"
                onChange={(value) => {
                  const next = { ...pins };
                  if (value === "") Reflect.deleteProperty(next, pin.role);
                  else next[pin.role] = Number(value);
                  setPins(next);
                }}
                options={[
                  ...(optional ? [{ value: "", label: t("part.pin.none") }] : []),
                  ...boardPins.map(([number, info]) => ({ value: number, label: pinLabel(number, info) })),
                ]}
                testid={`part-pin-${pin.role}`}
              />
            </FormRow>
          );
        })}
        {fields.map(({ name, field }) => {
          const label = localized(field.label) || name;
          return (
            <FormRow key={name} label={label} htmlFor={`setting-${name}`}>
              <SettingInput
                id={`setting-${name}`}
                name={name}
                label={label}
                field={field}
                value={values[name]}
                invalid={problems.has(name)}
                set={(value) => {
                  setValues({ ...values, [name]: value });
                }}
              />
              {problems.has(name) && (
                <FieldProblem data-testid={`setting-problem-${name}`}>
                  {t(`part.settingProblem.${problems.get(name) ?? "type"}`, {
                    minimum: field.minimum,
                    maximum: field.maximum,
                    maxLength: field.maxLength,
                  })}
                </FieldProblem>
              )}
            </FormRow>
          );
        })}
        {!onBoard && !connected && (
          <FormNote tone="problem" data-testid="part-pins-problem">
            {t("part.pinsProblem")}
          </FormNote>
        )}
        {failed && <FormNote tone="problem">{t("config.broken")}</FormNote>}
      </FormGrid>
    </Modal>
  );
}

export function PartDialog({ part }: { part: string | null }) {
  const config = useApp((s) => s.config);
  const board = useApp((s) => boardById(s.project?.board ?? ""));
  const known = useApp((s) => s.partTypes);
  const items = board ? projectParts(board, config) : [];
  const item = part === null ? null : (items.find((p) => p.id === part) ?? null);
  // The breadboard takes types that have a widget and, if the core is loaded, a model in it.
  const types = partTypes().filter((type) => !createWidget(type).plain && (known.length === 0 || known.includes(type)));
  const title = item ? t("part.edit", { label: item.label }) : t("part.addTitle");
  if (part !== null && !item) {
    return (
      <Modal testid="part-dialog" title={title}>
        <p className="text-muted-foreground">{t("part.missing")}</p>
      </Modal>
    );
  }
  // The form draws the dialog itself: its buttons sit in the bottom row of the dialog.
  return <Form title={title} item={item} items={items} types={types} />;
}
