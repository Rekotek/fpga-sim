// Format check: schemas in spec/, samples in spec/tests/, board files, part descriptions,
// fpgasim.json of the examples and the message table. Run: make check-spec.
//
// Sample file spec/tests/**/<name>.json:
//   { "schema": "<schema path from spec/>",
//     "valid":   [ { "name", "data" | "file" } ],
//     "invalid": [ { "name", "at", "data" | ("from" + "set" / "remove") } ] }
// "file" and "from" are paths from the repository root. "set" (JSON pointer -> value) and "remove"
// (list of pointers) edit a copy of the "from" file. "at" is the place in the document that at
// least one error must point to: this way a sample cannot be rejected for an unrelated reason.
// For a missing required field, an extra field and a wrong field name the place is the field itself
// ("/unit", not ""), or two different omissions in one object cannot be told apart.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { encodeVector, loadVectors, vectorPath } from "./vectors.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SPEC = join(ROOT, "spec");
const MIN_INVALID = 3;

const problems = [];
const fail = (where, text) => problems.push(`${where}: ${text}`);
const rel = (path) => relative(ROOT, path);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    fail(rel(path), `не читается как JSON: ${e.message}`);
    return undefined;
  }
}

function walk(dir, suffix) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(suffix))
    .map((e) => join(e.parentPath, e.name))
    .sort();
}

// Error place: for errors about an object field (missing required, extra, wrong name) it is the path of the field itself.
function errorPath(e) {
  const key = e.params?.missingProperty ?? e.params?.additionalProperty ?? e.params?.propertyName;
  if (key === undefined) return e.instancePath;
  return `${e.instancePath}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

function formatErrors(errors) {
  return (errors ?? []).map((e) => `${errorPath(e) || "/"} ${e.message}`).join("; ");
}

// JSON pointer (RFC 6901) without support for "-".
function pointerParts(pointer) {
  if (pointer === "") return [];
  return pointer
    .slice(1)
    .split("/")
    .map((p) => p.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function mutate(doc, sample, where) {
  const copy = structuredClone(doc);
  const locate = (pointer) => {
    if (!pointer.startsWith("/")) {
      fail(where, `указатель обязан начинаться с «/»: "${pointer}"`);
      return undefined;
    }
    const parts = pointerParts(pointer);
    let node = copy;
    for (const part of parts.slice(0, -1)) {
      node = node?.[part];
      if (node === null || typeof node !== "object") {
        fail(where, `указатель ${pointer} не находит место в исходном файле`);
        return undefined;
      }
    }
    return [node, parts.at(-1)];
  };
  for (const [pointer, value] of Object.entries(sample.set ?? {})) {
    const found = locate(pointer);
    if (found) found[0][found[1]] = value;
  }
  for (const pointer of sample.remove ?? []) {
    const found = locate(pointer);
    if (!found) continue;
    const [node, key] = found;
    if (!(key in node)) fail(where, `удалять нечего: ${pointer}`);
    else if (Array.isArray(node)) node.splice(Number(key), 1);
    else delete node[key];
  }
  return copy;
}

// --- Schemas -----------------------------------------------------------------

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
const schemas = new Map(); // path from spec/ -> schema
for (const path of walk(SPEC, ".schema.json")) {
  const schema = readJson(path);
  if (!schema) continue;
  const name = relative(SPEC, path);
  // $id is the path inside spec/: references between schemas resolve without a host name.
  if (schema.$id !== name) fail(rel(path), `"$id" должен быть равен ${name}`);
  schemas.set(name, schema);
  ajv.addSchema(schema);
}
const validators = new Map();
for (const [name, schema] of schemas) {
  try {
    validators.set(name, ajv.getSchema(schema.$id) ?? ajv.compile(schema));
  } catch (e) {
    fail(`spec/${name}`, `схема не собирается: ${e.message}`);
  }
}
// Composition by the spec: a schema that vanished together with its samples would go unnoticed.
const DOCUMENTS = ["fpgasim", "board", "part"];
const COMMANDS =
  "hello configure signals run pause step speed reset watch part partSettings recordStart recordStop recordFetch";
const FROM_CORE = "ready ok error state partEvent notice recordState recordEnd"; // sections 4.2 and 4.3
const PART_TYPES = ["led", "button", "switch", "uart", "ws2812", "probe"]; // section 6
{
  const expected = [
    ...DOCUMENTS.map((n) => `${n}.schema.json`),
    ...`common ${COMMANDS} ${FROM_CORE}`.split(" ").map((n) => `protocol/${n}.schema.json`),
  ];
  for (const name of expected) if (!schemas.has(name)) fail(`spec/${name}`, "схемы нет");
  for (const name of schemas.keys()) if (!expected.includes(name)) fail(`spec/${name}`, "схемы нет в списке check.mjs");
  for (const t of `${COMMANDS} ${FROM_CORE}`.split(" ")) {
    const schema = schemas.get(`protocol/${t}.schema.json`);
    if (schema && schema.properties?.t?.const !== t)
      fail(`spec/protocol/${t}.schema.json`, `поле "t" должно быть равно "${t}"`);
  }
}
// The shared definitions file is not a message and has no samples.
const isDocumentSchema = (name) => "type" in schemas.get(name);

function check(schemaName, doc, where) {
  const validate = validators.get(schemaName);
  if (!validate) return false;
  if (validate(doc)) return true;
  fail(where, `не проходит spec/${schemaName}: ${formatErrors(validate.errors)}`);
  return false;
}

// --- Samples ---------------------------------------------------------------

const covered = new Map(); // schema -> number of invalid samples
const NO_DOC = Symbol("образец не загружен");
const validProjects = []; // valid fpgasim.json samples: [document, label]
let sampleCount = 0;
for (const path of walk(join(SPEC, "tests"), ".json")) {
  const file = readJson(path);
  if (!file) continue;
  const where = rel(path);
  const validate = validators.get(file.schema);
  if (!validate) {
    fail(where, `нет схемы spec/${file.schema}`);
    continue;
  }
  if (covered.has(file.schema)) fail(where, `у схемы ${file.schema} уже есть файл образцов`);
  covered.set(file.schema, (file.invalid ?? []).length);
  if (!(file.valid ?? []).length) fail(where, "нет ни одного верного образца");

  const names = new Set();
  const load = (sample, label) => {
    if (!sample.name || names.has(sample.name)) fail(where, `у образца нет имени или оно повторяется: ${sample.name}`);
    names.add(sample.name);
    sampleCount += 1;
    const source = sample.file ?? sample.from;
    const kinds = ["data", "file", "from"].filter((k) => k in sample);
    if (kinds.length !== 1) {
      fail(
        label,
        `у образца должно быть ровно одно из полей "data", "file", "from"; есть: ${kinds.join(", ") || "ни одного"}`,
      );
      return NO_DOC;
    }
    if (sample.from && !("set" in sample) && !("remove" in sample)) fail(label, 'у "from" нет ни "set", ни "remove"');
    if (source === undefined) return sample.data;
    const doc = readJson(join(ROOT, source));
    if (doc === undefined) return NO_DOC;
    return sample.from ? mutate(doc, sample, label) : doc;
  };

  for (const sample of file.valid ?? []) {
    const label = `${where} [верный: ${sample.name}]`;
    const doc = load(sample, label);
    if (doc === NO_DOC) continue;
    if (check(file.schema, doc, label) && file.schema === "fpgasim.schema.json") validProjects.push([doc, label]);
  }
  for (const sample of file.invalid ?? []) {
    const label = `${where} [неверный: ${sample.name}]`;
    const doc = load(sample, label);
    if (doc === NO_DOC) continue;
    if (typeof sample.at !== "string") {
      fail(label, 'нет поля "at" с местом ожидаемой ошибки');
      continue;
    }
    if (validate(doc)) {
      fail(label, "схема приняла неверный образец");
      continue;
    }
    if (!validate.errors.some((e) => errorPath(e) === sample.at)) {
      fail(label, `отклонён не там: ждали ${sample.at || "/"}, получили ${formatErrors(validate.errors)}`);
    }
  }
}
for (const name of schemas.keys()) {
  if (!isDocumentSchema(name)) continue;
  const count = covered.get(name);
  if (count === undefined) fail(`spec/${name}`, "нет файла образцов в spec/tests/");
  else if (count < MIN_INVALID) fail(`spec/${name}`, `неверных образцов ${count}, нужно не меньше ${MIN_INVALID}`);
}

// --- Part descriptions ------------------------------------------------------

const parts = new Map(); // type -> description
const partsDir = join(ROOT, "parts");
for (const entry of existsSync(partsDir) ? readdirSync(partsDir, { withFileTypes: true }) : []) {
  if (!entry.isDirectory()) continue;
  const path = join(partsDir, entry.name, "part.json");
  const where = rel(path);
  if (!existsSync(path)) {
    fail(where, "файла нет");
    continue;
  }
  const doc = readJson(path);
  if (!doc || !check("part.schema.json", doc, where)) continue;
  if (doc.type !== entry.name) fail(where, `"type" (${doc.type}) не совпадает с именем папки`);
  const roles = doc.pins.map((p) => p.role);
  if (new Set(roles).size !== roles.length) fail(where, "роли выводов повторяются");
  for (const list of [doc.commands, doc.events]) {
    const names = list.map((x) => x.name);
    if (new Set(names).size !== names.length) fail(where, "имена команд или событий повторяются");
  }
  // The default of each setting must pass the constraints of that same setting.
  const settings = settingsValidator(doc);
  const defaults = Object.fromEntries(Object.entries(doc.settings).map(([k, v]) => [k, v.default]));
  if (!settings(defaults))
    fail(where, `умолчания настроек не проходят свои ограничения: ${formatErrors(settings.errors)}`);
  parts.set(doc.type, { doc, settings });
}

for (const type of PART_TYPES)
  if (!parts.has(type)) fail(`parts/${type}/part.json`, "описания детали версии 1 нет или оно не прошло проверку");

// Part settings are described by a subset of JSON Schema; the settings object schema is built from it.
function settingsValidator(part) {
  const properties = {};
  for (const [name, spec] of Object.entries(part.settings)) {
    const { default: _default, label: _label, ...rest } = spec;
    properties[name] = rest;
  }
  return new Ajv2020({ allErrors: true, strict: true }).compile({
    type: "object",
    additionalProperties: false,
    properties,
  });
}

// A part in a board or project file: type, roles and settings are checked against the part description.
function checkPartUse(use, where, knownPins) {
  const part = parts.get(use.type);
  if (!part) {
    fail(where, `деталь ${use.id}: нет описания типа ${use.type} в parts/`);
    return;
  }
  const roles = new Set(part.doc.pins.map((p) => p.role));
  for (const [role, pin] of Object.entries(use.pins)) {
    if (!roles.has(role)) fail(where, `деталь ${use.id}: у типа ${use.type} нет роли ${role}`);
    if (knownPins && !knownPins.has(String(pin))) fail(where, `деталь ${use.id}: вывода ${pin} нет в "pins" платы`);
  }
  if (!part.settings(use.settings ?? {})) {
    fail(where, `деталь ${use.id}: настройки не подходят к описанию: ${formatErrors(part.settings.errors)}`);
  }
}

function unique(list, where, what) {
  if (new Set(list).size !== list.length) fail(where, `${what} повторяются`);
}

// --- Board files ------------------------------------------------------------

const boards = new Map();
for (const path of walk(join(ROOT, "boards"), ".json")) {
  const doc = readJson(path);
  const where = rel(path);
  if (!doc || !check("board.schema.json", doc, where)) continue;
  boards.set(doc.id, doc);
  if (`${doc.id}.json` !== relative(join(ROOT, "boards"), path))
    fail(where, `"id" (${doc.id}) не совпадает с именем файла`);
  const pins = new Set(Object.keys(doc.pins));
  const known = (pin, what) => {
    if (!pins.has(String(pin))) fail(where, `${what}: вывода ${pin} нет в "pins"`);
  };
  for (const clock of doc.clocks) {
    known(clock.pin, `такт ${clock.id}`);
    if (doc.pins[clock.pin]?.status !== "clock")
      fail(where, `такт ${clock.id}: у вывода ${clock.pin} состояние не "clock"`);
  }
  for (const [pin, info] of Object.entries(doc.pins)) {
    if (info.status === "clock" && !doc.clocks.some((c) => String(c.pin) === pin)) {
      fail(where, `вывод ${pin} помечен "clock", но в "clocks" его нет`);
    }
  }
  const contacts = doc.headers.flatMap((h) => h.contacts.filter((c) => "pin" in c).map((c) => c.pin));
  contacts.forEach((pin) => known(pin, "гребёнка"));
  unique(contacts, where, "выводы на гребёнках");
  unique(
    doc.headers.map((h) => h.id),
    where,
    "идентификаторы гребёнок",
  );
  unique(
    [...doc.parts, ...doc.devices].map((x) => x.id),
    where,
    "идентификаторы деталей и устройств",
  );
  unique(
    doc.clocks.map((c) => c.id),
    where,
    "идентификаторы тактов",
  );
  for (const part of doc.parts) checkPartUse(part, where, pins);
  for (const device of doc.devices) device.pins.forEach((pin) => known(pin, `устройство ${device.id}`));
  for (const group of doc.shared) group.pins.forEach((pin) => known(pin, "общая группа"));
}

// --- fpgasim.json of the examples --------------------------------------------------

function checkProject(doc, where) {
  if (!check("fpgasim.schema.json", doc, where)) return;
  const board = boards.get(doc.board ?? "tang-nano-20k");
  if (!board) fail(where, `нет файла платы ${doc.board}`);
  unique(
    (doc.parts ?? []).map((p) => p.id),
    where,
    "идентификаторы деталей",
  );
  for (const part of doc.parts ?? []) checkPartUse(part, where, null);
  for (const [id, change] of Object.entries(doc.boardParts ?? {})) {
    const builtin = board?.parts.find((p) => p.id === id);
    if (board && !builtin) fail(where, `"boardParts": у платы нет детали ${id}`);
    else if (builtin) checkPartUse({ ...builtin, settings: { ...builtin.settings, ...change.settings } }, where, null);
  }
}

let exampleProjects = 0;
for (const path of walk(join(ROOT, "examples"), ".json")) {
  if (!path.endsWith("/fpgasim.json")) continue;
  const doc = readJson(path);
  exampleProjects += 1;
  if (doc) checkProject(doc, rel(path));
}
// Valid fpgasim.json samples are also checked by meaning: part types, roles, settings.
for (const [doc, label] of validProjects) checkProject(doc, label);

// --- Compiler message table ------------------------------------------

{
  const path = join(SPEC, "diagnostics.json");
  const doc = readJson(path);
  const validate = ajv.compile({
    type: "object",
    required: ["format", "codes"],
    additionalProperties: false,
    properties: {
      format: { const: 1 },
      codes: {
        type: "object",
        propertyNames: { pattern: "^[A-Z][A-Z0-9_]*$" },
        additionalProperties: {
          type: "object",
          required: ["level"],
          additionalProperties: false,
          properties: {
            level: { enum: ["important", "note", "hidden"] },
            text: { $ref: "part.schema.json#/$defs/text" },
            explain: { $ref: "part.schema.json#/$defs/text" },
          },
          // A short text and an explanation are required for everything that is shown (spec section 7.6).
          if: { properties: { level: { const: "hidden" } } },
          else: { required: ["text", "explain"] },
        },
      },
    },
  });
  if (doc && !validate(doc)) fail(rel(path), formatErrors(validate.errors));
}

// --- Reference binary messages ---------------------------------------------

// The files spec/protocol/vectors/*.bin must match the description in vectors.json.
let vectorCount = 0;
{
  const seen = new Set();
  for (const vector of loadVectors()) {
    const path = vectorPath(vector);
    vectorCount += 1;
    seen.add(vector.kind);
    if (!existsSync(path)) fail(rel(path), "файла нет: node tools/spec/vectors.mjs --write");
    else if (!readFileSync(path).equals(encodeVector(vector)))
      fail(rel(path), "байты не совпадают с описанием в vectors.json");
  }
  for (const kind of ["FRAME", "TRACE", "PART_DATA"]) {
    if (!seen.has(kind)) fail("spec/protocol/vectors/vectors.json", `нет примера вида ${kind}`);
  }
  for (const path of walk(join(SPEC, "protocol", "vectors"), ".bin")) {
    if (!loadVectors().some((v) => vectorPath(v) === path)) fail(rel(path), "файла нет в vectors.json");
  }
}

// --- Core messages from the tests ---------------------------------------------------

// node tools/spec/check.mjs --transcript <file>: each line of the file is a control message
// that the core sent in the tests (make test-core). All of them must pass their schemas,
// and every core message type must appear at least once.
let transcriptCount = null;
{
  const at = process.argv.indexOf("--transcript");
  if (at >= 0) {
    const path = process.argv[at + 1];
    const where = path ?? "--transcript";
    const lines = path && existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : null;
    if (!lines) fail(where, "файла с сообщениями ядра нет");
    const seen = new Set();
    transcriptCount = 0;
    for (const [i, line] of (lines ?? []).entries()) {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        fail(`${where}:${i + 1}`, `не читается как JSON: ${e.message}`);
        continue;
      }
      transcriptCount += 1;
      if (!FROM_CORE.split(" ").includes(msg?.t))
        fail(`${where}:${i + 1}`, `ядро отправило сообщение неизвестного типа: ${line}`);
      else if (check(`protocol/${msg.t}.schema.json`, msg, `${where}:${i + 1}`)) seen.add(msg.t);
    }
    for (const t of FROM_CORE.split(" ")) {
      if (lines && !seen.has(t)) fail(where, `тесты ядра ни разу не отправили сообщение ${t}`);
    }
  }
}

// --- Summary ------------------------------------------------------------------

if (problems.length) {
  for (const line of problems) console.error(line);
  console.error(`\nФорматы: ошибок ${problems.length}`);
  process.exit(1);
}
console.log(
  `Форматы: схем ${schemas.size}, образцов ${sampleCount}, плат ${boards.size}, деталей ${parts.size}, ` +
    `эталонных сообщений ${vectorCount}, fpgasim.json в примерах ${exampleProjects}` +
    (transcriptCount === null ? "" : `, сообщений ядра из тестов ${transcriptCount}`) +
    " — всё проходит",
);
