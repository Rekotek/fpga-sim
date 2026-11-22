# FPGA SIM: specification for version 1

Revision 1 of 2026-11-18. Basis: the document "FPGA SIM: vision and architecture", version 3. The architecture decisions there are not revisited; the spec refines them to the level where code can be written.

## 0. Purpose of the document

### 0.1. Audience

The spec is read by the Claude Code agents that develop the application and by the author, who accepts the stages. An agent works on one stage from section 12 and consults the other sections as a reference.

### 0.2. Strength of requirements

- "Must", "is required", and the tables of formats and protocol: do not change without editing the spec.
- "By default": the value can change after measurements; the decision is recorded in `docs/decisions.md`.
- "Verify": an assumption that the agent must confirm at the stated stage. If it is wrong, the agent stops, describes the discrepancy in `docs/decisions.md` and proposes a replacement. All such items are collected in section 15.

### 0.3. Scope of version 1

Included: projects in the browser, editor, opening a folder, build on the server, the Tang Nano 20K board, one clock, breadboard, LED, button and switch, UART, WS2812, probe, time control, signal tree, watch, recording, waveforms, VCD export, running a testbench.

Not included: Gowin primitives (`rPLL` and others), several clocks, display, sound, seven-segment indicator, Tang Nano 9K, synthesis check, bidirectional pins, accounts, storing projects on the server. The code must not block adding them: the extension points are named in the text.

### 0.4. Terms

| Term | Meaning |
|---|---|
| Core | WebAssembly module: runtime, project model and shim |
| Runtime | The permanent C++ part of the core: scheduler, pin nets, parts, recording, protocol |
| Model | C++ code that Verilator creates from the user's design |
| Shim | A generated C++ file that connects the model to the runtime |
| Engine | The interface that hides the model (Verilator, later CXXRTL) |
| Part | A device model: LED, button, UART and so on |
| Net | A board pin together with everything connected to it |
| Half-cycle | The interval between adjacent clock edges; an even half-cycle starts with the rising edge |
| Chunk | A segment of simulation that the core computes in one tick (about 16 ms of real time) |
| Frame | A binary message with the results of a chunk |
| Host | TypeScript code in a Web Worker that loads the core and passes messages |

### 0.5. Source data

| What | Value |
|---|---|
| Application | `https://fpga-sim.scriptorium.cc` (Cloudflare Pages). The author's deployment: the code holds no host names, they come from the site settings (decision 173) |
| Build server | `https://fpga-build.scriptorium.cc` (Hetzner CX33: 4 x86-64 cores, 8 GB) |
| DNS | Cloudflare, zone `scriptorium.cc` |
| Interface language | Russian and English (decision 168); strings live in dictionaries, Latvian is added third |
| Students' browser | Chrome on laptops. Safari and Firefox must work, except for opening a folder |
| Development machine | Mac on Apple Silicon, Docker Desktop, the agent has SSH access to the VPS |
| Lesson code | Will appear in `~/fpga/lessonNN_*`; it can be copied into the repository |
| Speed threshold | Lesson 4 on the author's Mac: the goal is at least 1×; below 0.3× the work stops |

## 1. System composition

### 1.1. Components

| Component | Folder | Language | Where it runs |
|---|---|---|---|
| Runtime and parts | `core/` | C++20 | In the browser (WebAssembly), for tests also on a regular machine |
| Build server | `server/` | Python 3.12, FastAPI | VPS |
| Build image | `server/docker/` | `Dockerfile.tools`, `Dockerfile.build`, `Dockerfile.api` | VPS, one-shot containers |
| Interface and host | `web/` | TypeScript, React | Browser |
| Board and part descriptions, format schemas | `boards/`, `parts/`, `spec/` | JSON | Read by all components |

### 1.2. Data path

1. The user edits project files in the interface or in an opened folder.
2. The interface sends the files and `fpgasim.json` to the server (`POST /v1/build`).
3. The server detects the top module, parses the `.cst`, runs Verilator, creates the shim, compiles the model and links it with the prebuilt runtime. The response: the build description, the list of compiler messages and links to two files, `sim.wasm` and `sim.mjs`.
4. The interface creates a Web Worker. The host loads the core and passes it the configuration: which ports are on which pins, which parts are connected, what to watch.
5. The core computes in chunks and sends a frame after each. The interface draws the board and the panels from the frames and sends the user's actions (a button press, input to the terminal) to the core as commands.

### 1.3. What does not depend on what

Pin binding, parts and the watch list are not part of the build. The core receives them at startup in the `configure` message. So moving a part on the breadboard or changing the binding without a `.cst` needs no rebuild, and the build cache depends only on the design.

The server knows no more about parts and boards than it needs to parse the binding. The interface does not parse Verilog: it gets everything about the design from the server response and from the core.

## 2. Project and `fpgasim.json`

### 2.1. Project contents

A project is a flat or nested set of text files and an optional `fpgasim.json` in the root. If there is no settings file, the defaults and auto-detection apply; the interface creates the file on the first change of settings.

File types: design (`.v`, `.sv`, `.vh`, `.svh`), binding (`.cst`), memory data (`.hex`, `.mem`), other (shown and stored, not sent to the build). Paths are relative, the separator is `/`, no `..`, encoding UTF-8.

### 2.2. Fields of `fpgasim.json`

The full schema is `spec/fpgasim.schema.json` (JSON Schema 2020-12); stage 1 creates it from this table. The `$id` of every schema in `spec/` is its path inside `spec/` (for example `protocol/run.schema.json`), so references between schemas resolve without a host name (decision 173). All fields except `format` are optional. Unknown fields are kept on rewrite and cause a warning.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `format` | number | — | Format version, currently `1` |
| `name` | string | folder name | Project name |
| `board` | string | `"tang-nano-20k"` | Identifier of the board file. This field sets the project's board; the project record in the database keeps a copy of it for the project list (decision 161) |
| `design.files` | array of paths or `null` | `null` | Design files. `null`: all `.v` and `.sv` except testbenches |
| `design.top` | string or `null` | `null` | Top module. `null`: auto-detection |
| `design.parameters` | object | `{}` | Parameters of the top module: name → number or string |
| `design.defines` | object | `{}` | Preprocessor macros: name → string or `true` |
| `design.includeDirs` | array of paths | `["."]` | Folders for `` `include `` |
| `design.constraints` | path, `null` or `false` | `null` | The `.cst` file. `null`: the only `.cst` in the project. `false`: do not use |
| `design.visibility` | `"all"` or `"ports"` | `"ports"` | Whether internal signals are visible (section 7.3) |
| `pins` | object | `{}` | Binding without a `.cst`: port bit → `{ "pin": 15, "pull": "none" }` |
| `boardParts` | object | `{}` | Changes to the board's built-in parts: identifier → `{ "enabled": true, "settings": {…} }` |
| `parts` | array | `[]` | Parts on the breadboard (section 2.3) |
| `watch` | array | `[]` | Watched signals: `{ "signal": "top.cnt_a", "radix": "hex" }` |
| `record` | object | see 2.4 | Recording settings |
| `testbenches` | array of paths or `null` | `null` | Testbench files. `null`: auto-detection |
| `sim.speed` | number or `"max"` | `1` | Initial speed multiplier |

Binding source rule: if a `.cst` file is in effect, the `pins` field is not used, and when it is not empty the server issues the warning `PINS_IGNORED`. One source rules out a dispute between two. The interface command "Export as .cst" creates a file from `pins` and clears the field.

A port bit name is written as in the `.cst`: `clk`, `led[0]`. Values of `pull`: `"up"`, `"down"`, `"none"`. Values of `radix`: `"bin"`, `"hex"`, `"dec"`, `"sdec"`; without the field, `"dec"`. In `watch`, as in `record.signals`, a board pin name `pin:N` is allowed (decision 82).

### 2.3. A part on the breadboard

```json
{
  "id": "led_ext1",
  "type": "led",
  "pins": { "in": 73 },
  "settings": { "color": "green", "activeLevel": 1 },
  "position": { "x": 3, "y": 1 }
}
```

- `id`: a unique name in the project; Latin letters, digits and `_`.
- `type`: a folder in `parts/`.
- `pins`: part pin role → board pin number. The roles are defined in the part description (section 6).
- `settings`: settings according to the schema from the part description; missing ones take the defaults.
- `position`: a cell on the breadboard field; needed only for drawing.

### 2.4. Recording

```json
"record": {
  "signals": ["top.cnt_a", "pin:15"],
  "mode": "ring",
  "depth": 200000,
  "windowPs": 100000000000,
  "trigger": null
}
```

- `signals`: signal paths or `pin:N` for a board pin.
- `mode`: `"ring"` (the last `depth` changes are kept, recording runs until stop) or `"window"` (a recording of length `windowPs` from the start or from the moment a condition fires).
- `trigger`: `null` or `{ "signal": "top.q", "edge": "rise" }`; `edge`: `"rise"`, `"fall"`, `"change"`. For a multi-bit signal only `"change"` is allowed.
- Limit: `depth` is at most 2,000,000 changes, at most 64 signals.

### 2.5. Auto-detection

The server performs it; the result is returned in the `resolved` field of the response (section 8.3), and the interface shows it in the project settings.

**Modules.** The server strips comments and strings from the text and finds the declarations `module name`. A module counts as used if its name appears as a separate word outside its own header in any design file. A mention inside a testbench does not count (decision 35).

**Testbenches.** A module counts as a testbench if it has no ports or its name matches `tb_*` or `*_tb`. A file in which all modules are testbenches is excluded from the build and goes into `resolved.testbenches`. A file with a mix stays in the build, and the server issues the warning `TB_MIXED`.

**Top module.** This is an unused module that is not a testbench. If there are several, the server returns the error `TOP_AMBIGUOUS` with a list of candidates, and the interface offers a choice and writes it to `design.top`. If there are none, the error `TOP_NOT_FOUND`.

**Binding.** A single `.cst` is used as is. If there are several and `design.constraints` is not set, the error `CST_AMBIGUOUS`.

**Clock.** An input port bound to the board's clock pin (pin 4 for the 20K) counts as the clock. If there is no such port, the design counts as clockless and is recomputed when the inputs change. In version 1 there is one clock; ports on the other clock pins get the warning `CLOCK_EXTRA`.

### 2.6. Parsing the `.cst`

Two Gowin instructions are supported; keywords are case-insensitive, comments are `//` and `#` to the end of the line.

```
IO_LOC "led[0]" 15;
IO_PORT "led[0]" IO_TYPE=LVCMOS33 PULL_MODE=UP DRIVE=8;
```

- `IO_LOC "port" pin;` The name may be unquoted. An entry of the form `33,34` (a differential pair) is accepted: the first pin is taken and the warning `CST_DIFF_PAIR` is issued.
- `IO_PORT "port" key=value …;` Only `PULL_MODE` is used (`UP`, `DOWN`, `NONE`, `KEEPER`; the last is treated as `NONE` with a warning). The other keys are kept without interpretation.
- Other instructions are skipped with the warning `CST_UNKNOWN` and a line number.
- Errors: a port that the top module does not have (`CST_NO_PORT`); a pin that the board does not have (`CST_NO_PIN`); two ports on one pin (`CST_PIN_TWICE`); a pin from the forbidden ones (`PIN_FORBIDDEN`; this is a warning, the build proceeds).
- An `IO_TYPE` from `IO_PORT` that does not match the pin standard from the board file (letter case does not matter) is the warning `CST_IO_TYPE`; the build proceeds (decision 164).
- A port without a binding is not an error: the warning `PORT_UNBOUND`. A free input reads as 0, an output goes nowhere.
- Clarifications and additional codes (`CST_SYNTAX`, `CST_PORT_TWICE`, `CST_KEEPER`, the `PINS_*` codes for a binding from the `pins` field) are in decision 35.

Export to `.cst`: one `IO_LOC` and one `IO_PORT` pair per port bit, `PULL_MODE` from the binding, order by port name and bit number. `IO_TYPE` is the pin standard from the board file (the pin's `standard` field); without it, the board standard `io.standard`. For the 20K this is always `LVCMOS33`; on the 9K the buttons, LEDs and pins 79–86 get `LVCMOS18`.

### 2.7. The repository's own examples

While there are no lesson folders on disk, verification runs on the examples in `examples/`. They repeat the topics of lessons 0, 4 and 5, but are written anew for the repository. When `~/fpga/lessonNN_*` appears, the agent copies them into `examples/lessons/` and adds them to the set of checks (stage 11).

**`examples/blink3`** (the counterpart of lesson 4; the stage 0 measurement runs on it):

```verilog
// Ожидаемое поведение: led[0] мигает с частотой 1 Гц, led[1] — 2 Гц,
// led[2] — 4 Гц, led[3..5] погашены. Светодиоды горят при нуле.
module top (
    input  wire       clk,
    output wire [5:0] led
);
    localparam integer CLK_HZ = 27_000_000;

    reg [24:0] cnt_a = 0, cnt_b = 0, cnt_c = 0;
    reg [2:0]  q = 0;

    always @(posedge clk) begin
        if (cnt_a == CLK_HZ / 2 - 1) begin cnt_a <= 0; q[0] <= ~q[0]; end
        else cnt_a <= cnt_a + 1'b1;
        if (cnt_b == CLK_HZ / 4 - 1) begin cnt_b <= 0; q[1] <= ~q[1]; end
        else cnt_b <= cnt_b + 1'b1;
        if (cnt_c == CLK_HZ / 8 - 1) begin cnt_c <= 0; q[2] <= ~q[2]; end
        else cnt_c <= cnt_c + 1'b1;
    end

    assign led = {3'b111, ~q};
endmodule
```

```
IO_LOC "clk" 4;
IO_PORT "clk" IO_TYPE=LVCMOS33 PULL_MODE=NONE;
IO_LOC "led[0]" 15;
IO_LOC "led[1]" 16;
IO_LOC "led[2]" 17;
IO_LOC "led[3]" 18;
IO_LOC "led[4]" 19;
IO_LOC "led[5]" 20;
```

Check number: in 2.1 s of simulation time pin 15 toggles 4 times, pin 16 toggles 8 times, pin 17 toggles 16 times.

**`examples/buttons`** (the counterpart of lesson 0, a design without a clock): `assign led[0] = ~btn1; assign led[1] = ~btn2; assign led[2] = ~(btn1 & btn2);`, buttons on pins 88 and 87 with `PULL_MODE=DOWN`. The second variant, `buttons_nopull`, has no `PULL_MODE` and checks the warning about a floating input.

**`examples/buttons_9k`** (the Tang Nano 9K board, decision 161): in the example's `fpgasim.json` the `board` field is `"tang-nano-9k"`. A counter adds 1 every 0.25 s and drives six LEDs (pins 10, 11, 13–16); while S1 (pin 3) is pressed, counting stops; S2 (pin 4) resets the counter. The buttons and LEDs have `IO_TYPE=LVCMOS18`; `PULL_MODE=UP` is written for the buttons but is optional (decision 163). Check number: S1 is pressed from 1.1 to 1.6 s, S2 from 2.1 to 2.2 s; in 2.6 s pin 10 toggles 7 times, pin 11 toggles 4 times, pin 13 toggles 2 times.

**`examples/shift_chain`** (the counterpart of lesson 5): two modules with a chain of three flip-flops, one with `<=`, the other with `=` in the clocked `always`. It checks the `BLKSEQ` warning and the difference in behavior on a waveform.

`blink3` and `shift_chain` have a testbench `tb_top.v` (stage 9, decision 93). At the start of the file there is a comment with the expected output: `PASS: 8 checks` and `PASS: 6 checks`. The `blink3` testbench sets the counters two clock cycles before the boundary and checks the LED toggling; the `shift_chain` testbench feeds a one into both chains and compares their bits clock by clock.

**`examples/pwm_fade`** is created at stage 5 (smooth change of brightness with PWM).

**`examples/debounce`** (stage 6): button S1 with 5 ms bounce; the `bounceMs` setting of the built-in part `s1` is set by the `boardParts` field in the example's `fpgasim.json`. Two press counters: with debouncing (low bits on `led[2:0]`) and without it (`led[5:3]`). Check number: for one press with release, the first increases by exactly 1, the second by at least 3 (decision 70).

**`examples/uart_hello`**, **`examples/uart_echo`**, **`examples/ws2812_rainbow`**, **`examples/ws2812_badtiming`** (stage 7): each has a comment at the start of `top.v` with the expected behavior and check numbers. `uart_hello` sends a string to pin 69 once a second; `uart_echo` returns the received bytes (pins 70 and 69); `ws2812_rainbow` drives a strip of eight LEDs on pin 76 (a breadboard part in the example's `fpgasim.json`); `ws2812_badtiming` sends the built-in LED (pin 79) zero bits with a one of 519 ns and gets `timingError`.

## 3. Board file

### 3.1. Format

The file `boards/<id>.json`, schema `spec/board.schema.json`. The interface receives the board files together with the static files; the server reads them from the image.

| Field | Meaning |
|---|---|
| `format` | Format version, `1` |
| `id`, `name` | Identifier and name |
| `fpga` | Information about the chip (reference) |
| `io` | Pin standard and voltage (reference) |
| `clocks` | Clock sources: pin, frequency in hertz |
| `pins` | All known pins: number → name (`name`), status (`status`), explanation (`note`, text per language), standard (`standard`) |
| `headers` | Headers: contact order for drawing and for the breadboard |
| `parts` | Built-in parts: the same objects as in section 2.3, plus `label` and `geometry` |
| `devices` | Board devices with no model in this version (shown gray); the `label` caption is text per language |
| `shared` | Groups of pins shared by several devices |
| `geometry` | Board dimensions and element positions in millimeters |

Pin statuses (`status`): `clock` (clock), `onboard` (used by a built-in part but available to both code and the breadboard), `free` (free), `header` (brought out to a header, used by another connector on the board), `forbidden` (must not be used). A pin that is not in the file cannot be bound: the error `CST_NO_PIN` (binding from a `.cst`) or `PINS_NO_PIN` (binding from `fpgasim.json`).

Text per language is an object `{ "ru": …, "en": … }`, as in the part description (`$defs/text` in `spec/part.schema.json`, decision 168); `ru` is required. Clock labels (`clocks[].label`) and `shared` group labels are plain strings: neither the interface nor the server shows them.

Polarity is set in the settings of the built-in part (`activeLevel`), not in the code: on the 9K the buttons have the opposite polarity.

The pin standard (`standard`, optional): a string for `IO_TYPE` when the pin sits in a bank with a different voltage than the board. Without the field, `io.standard` applies. The export to `.cst` and the check of `IO_TYPE` from the project's `.cst` read this field (section 2.6, decision 164); it does not affect the simulation.

### 3.2. Full file for the Tang Nano 20K

Data source: the course reference site (the pinout page). The geometry is schematic: it is a drawing for recognizability, not a copy of the board. Dimensions and element positions are refined at stage 6 from the Sipeed drawing.

```json
{
  "format": 1,
  "id": "tang-nano-20k",
  "name": "Sipeed Tang Nano 20K",
  "fpga": {
    "vendor": "gowin",
    "device": "GW2AR-LV18QN88C8/I7",
    "ideName": "GW2AR-18C",
    "package": "QN88",
    "resources": { "lut4": 20736, "dff": 15552, "bsramBlocks": 46, "bsramKbit": 828, "mult18": 48, "pll": 2 }
  },
  "io": { "standard": "LVCMOS33", "voltage": 3.3 },
  "clocks": [
    { "id": "osc27", "pin": 4, "hz": 27000000, "label": "27 МГц" }
  ],
  "pins": {
    "4":  { "name": "CLK_27M", "status": "clock" },
    "10": { "name": "MS5351_CLK0", "status": "onboard", "note": { "ru": "Дополнительный такт, версия 2", "en": "Extra clock, board version 2" } },
    "11": { "name": "MS5351_CLK1", "status": "onboard", "note": { "ru": "Дополнительный такт, версия 2", "en": "Extra clock, board version 2" } },
    "13": { "name": "MS5351_CLK2", "status": "onboard", "note": { "ru": "Дополнительный такт, версия 2", "en": "Extra clock, board version 2" } },
    "15": { "name": "LED0", "status": "onboard" },
    "16": { "name": "LED1", "status": "onboard" },
    "17": { "name": "LED2", "status": "onboard", "note": { "ru": "Общий с джойстиком 2 (CLK)", "en": "Shared with joystick 2 (CLK)" } },
    "18": { "name": "LED3", "status": "onboard", "note": { "ru": "Общий с джойстиком 2 (ATTN)", "en": "Shared with joystick 2 (ATTN)" } },
    "19": { "name": "LED4", "status": "onboard", "note": { "ru": "Общий с джойстиком 2 (DATA)", "en": "Shared with joystick 2 (DATA)" } },
    "20": { "name": "LED5", "status": "onboard", "note": { "ru": "Общий с джойстиком 2 (CMD)", "en": "Shared with joystick 2 (CMD)" } },
    "25": { "name": "LCD_HS", "status": "header" },
    "26": { "name": "LCD_VS", "status": "header" },
    "27": { "name": "LCD_B7", "status": "header" },
    "28": { "name": "LCD_B6", "status": "header" },
    "29": { "name": "LCD_B5", "status": "header" },
    "30": { "name": "LCD_B4", "status": "header" },
    "31": { "name": "LCD_B3", "status": "header" },
    "33": { "name": "HDMI_CLK_P", "status": "onboard", "note": { "ru": "Общий с RGB LCD", "en": "Shared with RGB LCD" } },
    "34": { "name": "HDMI_CLK_N", "status": "onboard", "note": { "ru": "Общий с RGB LCD", "en": "Shared with RGB LCD" } },
    "35": { "name": "HDMI_D0_P", "status": "onboard", "note": { "ru": "Общий с RGB LCD", "en": "Shared with RGB LCD" } },
    "36": { "name": "HDMI_D0_N", "status": "onboard", "note": { "ru": "Общий с RGB LCD", "en": "Shared with RGB LCD" } },
    "37": { "name": "HDMI_D1_P", "status": "onboard", "note": { "ru": "Общий с RGB LCD", "en": "Shared with RGB LCD" } },
    "38": { "name": "HDMI_D1_N", "status": "onboard", "note": { "ru": "Общий с RGB LCD", "en": "Shared with RGB LCD" } },
    "39": { "name": "HDMI_D2_P", "status": "onboard", "note": { "ru": "Общий с RGB LCD", "en": "Shared with RGB LCD" } },
    "40": { "name": "HDMI_D2_N", "status": "onboard", "note": { "ru": "Общий с RGB LCD", "en": "Shared with RGB LCD" } },
    "41": { "name": "LCD_R4", "status": "header" },
    "42": { "name": "LCD_R3", "status": "header" },
    "48": { "name": "LCD_DE", "status": "header" },
    "49": { "name": "LCD_BL", "status": "header" },
    "51": { "name": "PA_EN", "status": "onboard", "note": { "ru": "Включение усилителя MAX98357A", "en": "MAX98357A amplifier enable" } },
    "52": { "name": "EDID_DAT", "status": "header", "note": { "ru": "EDID HDMI и джойстик 1 (CLK)", "en": "HDMI EDID and joystick 1 (CLK)" } },
    "53": { "name": "EDID_CLK", "status": "header", "note": { "ru": "EDID HDMI и джойстик 1 (CMD)", "en": "HDMI EDID and joystick 1 (CMD)" } },
    "54": { "name": "I2S_DIN", "status": "onboard" },
    "55": { "name": "I2S_LRCK", "status": "onboard" },
    "56": { "name": "I2S_BCLK", "status": "onboard" },
    "59": { "name": "FLASH", "status": "forbidden", "note": { "ru": "Флеш-память с прошивкой", "en": "Flash memory with the bitstream" } },
    "60": { "name": "FLASH", "status": "forbidden", "note": { "ru": "Флеш-память с прошивкой", "en": "Flash memory with the bitstream" } },
    "61": { "name": "FLASH", "status": "forbidden", "note": { "ru": "Флеш-память с прошивкой", "en": "Flash memory with the bitstream" } },
    "62": { "name": "FLASH", "status": "forbidden", "note": { "ru": "Флеш-память с прошивкой", "en": "Flash memory with the bitstream" } },
    "69": { "name": "UART_TX", "status": "onboard", "note": { "ru": "Выход из ПЛИС в BL616", "en": "Output from FPGA to BL616" } },
    "70": { "name": "UART_RX", "status": "onboard", "note": { "ru": "Вход в ПЛИС из BL616", "en": "Input to FPGA from BL616" } },
    "71": { "name": "JOY1_DATA", "status": "free", "note": { "ru": "Свободен без джойстика 1", "en": "Free without joystick 1" } },
    "72": { "name": "JOY1_ATTN", "status": "free", "note": { "ru": "Свободен без джойстика 1", "en": "Free without joystick 1" } },
    "73": { "name": "IO73", "status": "free" },
    "74": { "name": "IO74", "status": "free" },
    "75": { "name": "IO75", "status": "free" },
    "76": { "name": "IO76", "status": "free", "note": { "ru": "Вход глобального такта GCLKC_1", "en": "Global clock input GCLKC_1" } },
    "77": { "name": "LCD_CLK", "status": "header", "note": { "ru": "Вход глобального такта GCLKT_1", "en": "Global clock input GCLKT_1" } },
    "79": { "name": "WS2812_DIN", "status": "onboard", "note": { "ru": "Вход глобального такта GCLKC_0", "en": "Global clock input GCLKC_0" } },
    "80": { "name": "SDIO_D2", "status": "header" },
    "81": { "name": "TF_CS", "status": "onboard" },
    "82": { "name": "TF_MOSI", "status": "onboard" },
    "83": { "name": "TF_CLK", "status": "onboard" },
    "84": { "name": "TF_MISO", "status": "onboard" },
    "85": { "name": "SDIO_D1", "status": "header" },
    "86": { "name": "IO86", "status": "free" },
    "87": { "name": "S2", "status": "onboard" },
    "88": { "name": "S1", "status": "onboard" }
  },
  "headers": [
    {
      "id": "left",
      "contacts": [
        { "pin": 73 }, { "pin": 74 }, { "pin": 75 }, { "pin": 85 }, { "pin": 77 },
        { "pin": 15 }, { "pin": 16 }, { "pin": 27 }, { "pin": 28 }, { "pin": 25 },
        { "pin": 26 }, { "pin": 29 }, { "pin": 30 }, { "pin": 31 }, { "pin": 17 },
        { "pin": 20 }, { "pin": 19 }, { "pin": 18 }, { "power": "3V3" }, { "power": "GND" }
      ]
    },
    {
      "id": "right",
      "contacts": [
        { "power": "5V" }, { "power": "GND" }, { "pin": 76 }, { "pin": 80 }, { "pin": 42 },
        { "pin": 41 }, { "pin": 56 }, { "pin": 54 }, { "pin": 51 }, { "pin": 48 },
        { "pin": 55 }, { "pin": 49 }, { "pin": 86 }, { "pin": 79 }, { "power": "GND" },
        { "power": "3V3" }, { "pin": 72 }, { "pin": 71 }, { "pin": 53 }, { "pin": 52 }
      ]
    }
  ],
  "parts": [
    { "id": "led0", "type": "led", "label": "LED0", "pins": { "in": 15 }, "settings": { "activeLevel": 0, "color": "orange" }, "geometry": { "x": 6.0,  "y": 47.0 } },
    { "id": "led1", "type": "led", "label": "LED1", "pins": { "in": 16 }, "settings": { "activeLevel": 0, "color": "orange" }, "geometry": { "x": 8.2,  "y": 47.0 } },
    { "id": "led2", "type": "led", "label": "LED2", "pins": { "in": 17 }, "settings": { "activeLevel": 0, "color": "orange" }, "geometry": { "x": 10.4, "y": 47.0 } },
    { "id": "led3", "type": "led", "label": "LED3", "pins": { "in": 18 }, "settings": { "activeLevel": 0, "color": "orange" }, "geometry": { "x": 12.6, "y": 47.0 } },
    { "id": "led4", "type": "led", "label": "LED4", "pins": { "in": 19 }, "settings": { "activeLevel": 0, "color": "orange" }, "geometry": { "x": 14.8, "y": 47.0 } },
    { "id": "led5", "type": "led", "label": "LED5", "pins": { "in": 20 }, "settings": { "activeLevel": 0, "color": "orange" }, "geometry": { "x": 17.0, "y": 47.0 } },
    { "id": "s1", "type": "button", "label": "S1", "pins": { "out": 88 }, "settings": { "activeLevel": 1, "key": "1" }, "geometry": { "x": 5.0,  "y": 51.0 } },
    { "id": "s2", "type": "button", "label": "S2", "pins": { "out": 87 }, "settings": { "activeLevel": 1, "key": "2" }, "geometry": { "x": 17.5, "y": 51.0 } },
    { "id": "uart", "type": "uart", "label": "UART (BL616)", "pins": { "fromFpga": 69, "toFpga": 70 }, "settings": { "baud": 115200 }, "geometry": { "x": 11.3, "y": 6.0 } },
    { "id": "ws2812", "type": "ws2812", "label": "WS2812", "pins": { "din": 79 }, "settings": { "count": 1 }, "geometry": { "x": 11.3, "y": 42.0 } }
  ],
  "devices": [
    { "id": "hdmi", "label": { "ru": "HDMI", "en": "HDMI" }, "pins": [33, 34, 35, 36, 37, 38, 39, 40], "since": 2 },
    { "id": "i2s", "label": { "ru": "Звук I2S (MAX98357A)", "en": "I2S audio (MAX98357A)" }, "pins": [56, 55, 54, 51], "since": 2 },
    { "id": "ms5351", "label": { "ru": "Генератор MS5351", "en": "MS5351 clock generator" }, "pins": [10, 11, 13], "since": 2 },
    { "id": "tf", "label": { "ru": "TF-карта", "en": "TF card" }, "pins": [83, 82, 84, 81], "since": 3 },
    { "id": "sdram", "label": { "ru": "SDRAM 64 Мбит (внутри корпуса)", "en": "SDRAM 64 Mbit (inside the package)" }, "pins": [], "since": 3 },
    { "id": "flash", "label": { "ru": "Флеш-память с прошивкой", "en": "Flash memory with the bitstream" }, "pins": [59, 60, 61, 62], "since": null }
  ],
  "shared": [
    { "pins": [17, 18, 19, 20], "users": ["LED2–LED5", "джойстик 2"] },
    { "pins": [33, 34, 35, 36, 37, 38, 39, 40, 25, 26], "users": ["HDMI", "разъём RGB LCD"] },
    { "pins": [52, 53], "users": ["EDID HDMI", "джойстик 1"] },
    { "pins": [71, 72], "users": ["джойстик 1", "макетка"] }
  ],
  "geometry": {
    "unit": "mm",
    "width": 22.55,
    "height": 54.04,
    "usb": { "x": 11.3, "y": 0.0, "side": "top" },
    "chip": { "x": 11.3, "y": 24.0, "size": 10.0 },
    "headerPitch": 2.54,
    "headerLeftX": 1.3,
    "headerRightX": 21.25,
    "headerFirstY": 2.9
  }
}
```

Notes on the file:

- The color of the built-in LEDs, the coordinates and the board dimensions: verify against the board and the drawing (section 15).
- Which pin of the HDMI pair is positive does not matter for version 1; the names `_P` and `_N` come from the reference site and are verified for version 2.
- Binding a port to a pin from `devices` is allowed and gives the notice "the device will appear in version N": code `DEVICE_NOT_MODELED`, section 7.6. A device with `since: null` has no version and no notice (decision 110).

### 3.3. Tang Nano 9K

The file `boards/tang-nano-9k.json` (version 2, decisions 161–163). The format is the same. Data source: the course reference site, page https://fpga-helper.vercel.app/board/tang-nano-9k. The data is not verified on the board.

| What | Value |
|---|---|
| Chip | GW1NR-LV9QN88PC6/I5, in the Gowin environment GW1NR-9C |
| Clock | 27 MHz, pin 52 |
| LEDs LED0–LED5 | Pins 10, 11, 13, 14, 15, 16; on at 0 |
| Buttons S1, S2 | Pins 3 and 4; pressed = 0. The board has 10 kΩ resistors to 1.8 V, so `idle: "drive"`: a released button gives 1 even without `PULL_MODE=UP` (decision 163) |
| UART (BL702) | 17 is the output from the FPGA, 18 is the input to the FPGA; the default speed is 115,200 (the source does not name it) |
| 1.8 V bank | Pins 3, 4, 10, 11, 13–16 and 79–86: `"standard": "LVCMOS18"` |
| Free pins | 25–30 |
| Headers | 24 contacts each. Power only on the right one: 5V, GND, 3V3 |
| Devices without a model | HDMI (68–75, version 2), TF card (36–39, version 3), PSRAM (version 3), flash memory with the bitstream |
| Built-in WS2812 | None. The `ws2812` part is placed on the breadboard and bound to a free pin |

Pins whose purpose the source does not name (31, 32, 63, 79–85) have the status `header` and a note saying so. The pins of the flash memory, PSRAM and JTAG are not named by the source: they are not in the file and cannot be bound (`CST_NO_PIN`). The geometry is schematic, as for the 20K: the board size is 70 × 26 mm, the positions of the buttons, LEDs and chip are nominal.

## 4. Core ↔ interface protocol

### 4.1. General rules

- Protocol version: `1`. The sides exchange it in `hello` and `ready`; on a mismatch the interface shows an error and offers to rebuild the project.
- Two kinds of messages: control messages in JSON and bulk binary messages. In a Web Worker these are `postMessage` with a JSON string and `postMessage` with an `ArrayBuffer` (with ownership transfer). Over WebSocket these are text and binary frames. The content is the same.
- The `t` field sets the type of a control message. A command with an `id` field (an integer chosen by the interface) gets exactly one reply: `ok` or `error` with the same `id`. Messages without `id` need no reply.
- Simulation time is in picoseconds everywhere. In JSON it is passed as a string of decimal digits, because the number can exceed 2^53.
- Numbers in binary messages: little-endian byte order, all structures aligned to 4 bytes.
- Signal identifiers (`sig`) are sequence numbers from the `signals` reply; they are valid until the next core load. Parts and nets are addressed by a string in JSON and by the sequence number from `configure` in binary messages: a part by its `id`, a net by the string `pin:N`, where N is the board pin number (the same name as in the recording list).

The type descriptions are stored in `spec/protocol/`: a JSON Schema for each control message and reference binary examples in `spec/protocol/vectors/`. Tests check the TypeScript and C++ code against these files.

### 4.2. Interface commands to the core

| `t` | Fields | Action |
|---|---|---|
| `hello` | `protocol` | First message. Reply: `ready` |
| `configure` | `board`, `clock`, `nets`, `parts`, `watch` (section 4.4) | Sets nets, parts and watch, resets the simulation to the start. Reply: `ok` with the field `warnings` |
| `signals` | — | Request for the signal tree. Reply: `ok` with the field `signals` (section 4.5) |
| `run` | `speed` (number or `"max"`, optional) | Start |
| `pause` | — | Pause; the core finishes the current batch of clock cycles and sends a frame |
| `step` | `unit`: `"cycle"`, `"time"`, `"change"`; `count` (for `cycle`), `ps` (for `time`) | Step while paused: N clock cycles, a set time, or up to the nearest change of any FPGA output (not longer than 1 s of simulation time) |
| `speed` | `speed` | Change the multiplier while running |
| `reset` | — | Return to the start: time 0, the model is created anew, the parts are reset, the recording is erased. State `paused` |
| `watch` | `signals`: array of `sig` | Replace the watch list |
| `part` | `part`, `cmd`, `args` | A part command (a button press, bytes into the UART). The commands are listed in section 6 |
| `partSettings` | `part`, `settings` | Change the part's settings while running |
| `recordStart` | `signals` (array of `sig` and `pin:N` strings), `mode`, `depth`, `windowPs`, `trigger` | Start recording. Reply: `ok` with `record` (the recording number) |
| `recordStop` | — | Stop recording |
| `recordFetch` | `record`, `fromPs`, `toPs` (optional) | Request data. Reply: `ok` with `info`, then one or more binary `TRACE` messages, then `recordEnd` |

### 4.3. Core messages to the interface

| `t` | Fields | When |
|---|---|---|
| `ready` | `protocol`, `runtime` (version), `engine`: an object `{ name: "verilator", version }`, `top`, `ports`: an array of `{ name, dir, width }`, `partTypes` | In reply to `hello` |
| `ok` | `id` and the reply fields | A command succeeded |
| `error` | `id` (if any), `code`, `text` | A command was refused or the core failed |
| `state` | `run`: `"idle"`, `"running"`, `"paused"`, `"finished"`; `time`; `cycle`; `speed` | On every state change. `idle` before `configure`, `finished` after `$finish` or a model failure |
| `partEvent` | `part`, `event`, `data`, `time` | Rare part events: a UART framing error, a WS2812 timing failure |
| `notice` | `code`, `text`, `net` or `part` (optional), `time` | Simulator notices: a floating input, a conflict on a net, a recording overflow |
| `recordState` | `record`, `state`: `"armed"`, `"recording"`, `"done"`, `"stopped"`; `changes`; `fromPs`; `toPs` | When the recording state changes, and at most once a second during recording |
| `recordEnd` | `record` | After the last `TRACE` |

`notice` codes: `INPUT_FLOATING`, `NET_CONFLICT`, `RECORD_OVERFLOW`, `MODEL_FINISH`, `SLOW` (in three seconds of real time, less than 90% of the set simulation time has passed; it arrives once while the lag lasts, decision 109). The same notice for the same net repeats at most once per second of simulation time.

`error` codes:

| Code | When |
|---|---|
| `BAD_MESSAGE` | The message cannot be parsed, a required field is missing, or a field has the wrong form |
| `PROTOCOL_MISMATCH` | The protocol version in `hello` differs from the core's |
| `HELLO_REQUIRED` | A command arrived before `hello` |
| `UNKNOWN_COMMAND` | A command of unknown type with an `id` field (without `id` the message is skipped) |
| `NOT_CONFIGURED` | The command requires `configure` and there has been none yet |
| `CONFIG_INVALID` | `configure` was refused (section 4.4) |
| `BAD_STATE` | The command is not allowed in the current state: `step` when not paused, `run` and `pause` after `finished`, a clock-cycle step on a clockless design |
| `UNKNOWN_SIGNAL` | `watch` has no such signal, or it is a memory |
| `UNKNOWN_PART` | There is no part with this `id` (in PART_DATA, with this number) |
| `PART_COMMAND_INVALID` | The part has no such command, or the arguments do not fit its description |
| `SETTINGS_INVALID` | The settings in `partSettings` do not fit the part description |
| `RECORD_INVALID` | `recordStart` was refused: the signal, mode, depth, window, trigger condition, or memory limit |
| `NO_RECORD` | `recordStop` when no recording is running |
| `UNKNOWN_RECORD` | `recordFetch` with the number of a recording that does not exist |

Order details. For a `hello` with an `id` field, the core replies `ready`, then `ok`. Notices raised during `configure` and `reset` come after `ok` and `state`, before FRAME. After `step`, `ok` arrives at once, and when the step finishes, `state` and one FRAME arrive; the core computes a long step in several `fs_tick` calls. The `speed` command sends `state` with the new multiplier. The clock cycle number (`cycle` in `state` and in FRAME) is the number of rising edges done.

### 4.4. Contents of `configure`

```json
{
  "t": "configure", "id": 2,
  "board": "tang-nano-20k",
  "clock": { "port": "clk", "hz": 27000000 },
  "nets": [
    { "pin": 4,  "port": "clk", "bit": 0, "pull": "none" },
    { "pin": 15, "port": "led", "bit": 0, "pull": "none" },
    { "pin": 88, "port": "btn1", "bit": 0, "pull": "down" },
    { "pin": 73, "pull": "none" }
  ],
  "parts": [
    { "id": "led0", "type": "led", "pins": { "in": 15 }, "settings": { "activeLevel": 0 } },
    { "id": "s1", "type": "button", "pins": { "out": 88 }, "settings": { "activeLevel": 1 } }
  ],
  "watch": [12, 13]
}
```

- `clock` is `null` for a clockless design.
- `nets` lists all pins to which a port is bound or a part is connected. The order in the array sets the net number for binary messages; the order in `parts` sets the part number.
- The interface builds `configure` from the `resolved` field of the server response, the board file and `fpgasim.json`. The board's built-in parts and the breadboard parts go in one list.
- The core replies with the error `CONFIG_INVALID` and an explanation if a port does not exist, a part type is unknown, or a pin role does not exist.

### 4.5. The `signals` reply

```json
{ "t": "ok", "id": 3, "signals": [
  { "sig": 0, "path": "top.clk", "width": 1, "kind": "port" },
  { "sig": 1, "path": "top.cnt_a", "width": 25, "kind": "reg" },
  { "sig": 9, "path": "top.u_rx.mem", "width": 8, "kind": "memory", "depth": 16 }
] }
```

The interface builds the tree from the dots in `path`. Values of `kind`: `port`, `wire`, `reg`, `memory`, `param`. In version 1 a memory is shown in the tree but is not watched or recorded. With `visibility: "ports"` the list contains only ports.

### 4.6. Binary messages

Header, 24 bytes:

| Offset | Type | Field |
|---|---|---|
| 0 | u16 | Marker `0x5346` |
| 2 | u8 | Protocol version, `1` |
| 3 | u8 | Kind: `1` FRAME, `2` TRACE, `3` PART_DATA |
| 4 | u32 | Sequence number of the message of this kind |
| 8 | u64 | Simulation time at the moment of sending, ps |
| 16 | u32 | Content length in bytes |
| 20 | u32 | Reserved, `0` |

**FRAME (kind 1).** The result of a chunk. Sent after every chunk in the `running` state and once after `pause`, `step`, `reset` and `configure`.

| Type | Field |
|---|---|
| u64 | Simulation time covered by the chunk, ps |
| u64 | Clock cycle number from the start |
| u32 | Real time of the chunk, µs |
| f32 | Ratio of speed to real time over the last 500 ms |
| u16 | Number of nets N |
| u16 | Number of watched signals W |
| u16 | Number of part blocks P |
| u16 | Reserved |
| N × 12 bytes | Nets in `configure` order: u8 level at the end of the chunk; u8 flags (bit 0: the FPGA drives the net; bit 1: a part drives it; bit 2: conflict; bit 3: floating); u16 reserved; u32 number of toggles in the chunk; f32 fraction of time at one during the chunk |
| W blocks | Watch: u32 `sig`; u16 width; u16 number of words K; K × u32 value, least significant word first |
| P blocks | Parts whose state changed: u16 part number; u16 length L; L bytes of state (the format is set by the part, section 6); zero padding to 4 bytes |

If simulation time did not advance during the chunk (pause), the fraction of time at one equals the level.

**TRACE (kind 2).** A part of the recorded data, at most 1 MB per message.

| Type | Field |
|---|---|
| u32 | Recording number |
| u32 | Number of changes in the message |
| u64 | Start of the span, ps |
| u64 | End of the span, ps |
| changes | u64 time, ps; u16 signal number in the `info` list; u16 number of words K; K × u32 value |

The first changes of a span set the values of all signals at its start. The `info` field in the reply to `recordFetch`: an array of `{ index, name, width }`.

**PART_DATA (kind 3).** A part's data stream in either direction: u16 part number, u16 channel, u32 length, bytes, padding to 4. In version 1 the UART uses it: channel `0` is the bytes received from the FPGA.

### 4.7. Exchange order

1. The host loads the core and tells the interface that the transport is ready.
2. `hello` → `ready`.
3. `configure` → `ok`, `state` (`paused`), FRAME.
4. `signals` → `ok` (on request from the signal panel).
5. `run` → `ok`, `state` (`running`), then a FRAME for each chunk; between them `partEvent`, `notice`, PART_DATA.
6. `pause` → `ok`, `state` (`paused`), FRAME.
7. Any part command or a change of the watch is allowed both while running and while paused.
8. A new build: the interface terminates the Worker and starts again from step 1. The simulation state is not carried over between builds.

Reliability rules: the core sends no more than one FRAME per tick; if the interface cannot keep up, it draws only the last frame but counts the toggles and PART_DATA from all of them. A message of unknown type without `id` is skipped; with an `id` the core replies with the refusal `UNKNOWN_COMMAND`.

### 4.8. Calls between the host and the core

This is the JavaScript and WebAssembly boundary; when the core moves to the server, WebSocket will replace it and the protocol will stay the same.

| Core function | Purpose |
|---|---|
| `fs_init()` | Creates the runtime |
| `fs_alloc(n)`, `fs_free(p)` | Memory for passing messages |
| `fs_json(ptr, len)` | A control message to the core |
| `fs_binary(ptr, len)` | A binary message to the core |
| `fs_tick(nowMs)` | One chunk; the host calls it every 16 ms by timer, and back to back while a chunk lasts at least 6 ms (section 5.3) |

| Host function (core import) | Purpose |
|---|---|
| `fs_emit_json(ptr, len)` | A control message to the interface |
| `fs_emit_binary(ptr, len)` | A binary message to the interface; the host copies the bytes before returning |
| `fs_now_ms()` | Real time for accounting the chunk budget |

The host passes the handlers in the parameters of the module factory: `createModule({ onJson(text), onBinary(bytes), instantiateWasm })`. `onBinary` receives a copy of the bytes. The host writes a message to the core through `Module.HEAPU8` at the address from `fs_alloc` (decision 32). A host sample is `tools/headless/core.mjs`.

## 5. Runtime

### 5.1. Composition

| Part | Task |
|---|---|
| Scheduler | Keeps time, computes chunks, calls the engine and the parts |
| Nets | Stores the level of each pin, the sources, the pull, the statistics |
| Part registry | Creates parts by type, delivers events and commands to them |
| Recording | Stores the changes of the selected signals |
| Protocol | Parses and builds the messages of section 4 |

The code does not depend on Emscripten, except for the file with the `fs_*` boundary. The whole runtime also builds on a regular machine; the core tests run there because it is faster and easier to debug.

### 5.2. Time and clock

- Time: `uint64_t` in picoseconds from the start.
- Half-cycle number `h` starts at the moment `floor(h × 10^12 / (2 × f))`, where `f` is the frequency in hertz. The computation uses 128-bit integers. This way the 27 MHz period, which is not a whole number of picoseconds, does not accumulate error.
- An even half-cycle starts with the rising edge. Before the start the clock is 0.
- Wake-up queue: parts ask to be called at a given moment. The scheduler is designed for several clocks with non-multiple frequencies: the clock sources are stored in a list, and the nearest edge is chosen from all of them. In version 1 the list has one element.

### 5.3. Chunk

The host calls `fs_tick(nowMs)` every 16 ms. In the `running` state the host calls the next chunk right after the previous one, without waiting for the timer, as long as a chunk lasts at least 6 ms (the core is busy computing; the chunk budget is 12 ms): this is how computing goes at the `"max"` multiplier and at a multiplier the core cannot keep up with. Between chunks the host processes incoming messages (decisions 49 and 107). In the `running` state the core:

1. Computes the target: the current simulation time plus the elapsed real time multiplied by the speed multiplier. A fractional remainder smaller than a half-cycle carries over to the next chunk. For `"max"` a design with a clock has no target; for a clockless design `"max"` counts as multiplier 1.
2. Computes up to the target, but for no more than 12 ms of real time. The lag does not accumulate: if the target is not reached, the next chunk counts from the actual time.
3. Inside a chunk, repeats: find the nearest stop (the target or a part wake-up); ask the engine to run the half-cycles up to it; process the output changes; run the wake-ups; if the parts changed inputs, call the engine's re-evaluation.
4. Finishes the chunk: closes the net statistics, calls `onChunkEnd` on the parts, sends a FRAME.

The engine receives half-cycles in batches of at most 40,000, so that the time budget check and the `pause` command act at least once every few milliseconds.

**The main speed requirement.** The engine itself runs the clock in an inner loop and returns early only when an FPGA output or a recorded signal changes. The runtime does not interfere in this loop. In a design like `blink3` the outputs change a few times a second, so almost all the time goes to the model loop itself.

Clockless design: time runs in real time, and the model is recomputed only when an input changes.

Speed multipliers: `"max"`, 1, 0.5, 0.1, 0.01, 10^-3, 10^-4, 10^-5, 10^-6 (27 clock cycles per second) and an arbitrary value.

### 5.4. Nets

A net is created for each pin from `configure`. It has:

- The FPGA port bit and its direction, if a port is bound.
- The parts that read the net and the parts that drive it.
- The pull.

Level rules:

1. If the FPGA port is an output, the net level equals the port value. If a part with a different level also drives the net, `NET_CONFLICT` is issued; the level stays with the FPGA.
2. If the port is an input or there is no port: a part sets the level. Two parts with different levels give `NET_CONFLICT`, and the level is taken from the first.
3. If nobody drives the net: the pull sets the level (`up` → 1, `down` → 0). With `none` the level is 0 and the notice `INPUT_FLOATING` is issued if the FPGA reads the net. On a real board such an input behaves unpredictably, and the student must learn that.

Per-chunk statistics for each net: the level at the end, the number of toggles, the time at one. They are updated only at the moment of a change, so they cost nothing while the net does not toggle. They give the LED brightness under PWM and the frame for the interface.

An `inout` port is not connected to a net in version 1; `configure` returns the warning `INOUT_UNSUPPORTED`.

### 5.5. Recording

- Recording works on a list of signals and nets. The engine reports a change of a recorded signal the same way as a change of an output, and returns from the loop; the runtime reads the value and puts the change into storage with a timestamp.
- A fast-changing signal (a counter) stops the loop on every clock cycle, and the speed drops several times over. This is acceptable: the interface shows the actual ratio and a hint.
- Mode `ring`: a ring of `depth` changes, old ones are pushed out; the values of all signals at the start of the stored span are maintained separately.
- Mode `window`: recording starts at once or on a condition and stops after `windowPs`; if `depth` fills before then, `RECORD_OVERFLOW` is issued.
- Recording memory is limited to 64 MB.

### 5.6. Part interface

File `core/include/fpgasim/part.h`:

```cpp
namespace fpgasim {

using Time = uint64_t;                       // picoseconds

struct NetStats {                            // totals of the current chunk
    bool     level;
    uint32_t toggles;
    Time     highTime;
    Time     span;                           // chunk duration
};

class PartHost {                             // runtime services for a part
public:
    virtual Time now() const = 0;
    virtual bool level(int role) const = 0;          // current net level
    virtual void drive(int role, bool level) = 0;    // the part sets the level
    virtual void release(int role) = 0;              // the part releases the net
    virtual void wakeAt(Time t, uint32_t tag) = 0;   // call onWake at time t
    virtual void cancelWake(uint32_t tag) = 0;
    virtual const NetStats& stats(int role) const = 0;
    virtual void emitEvent(std::string_view event, const Json& data) = 0;   // partEvent
    virtual void emitData(uint16_t channel, std::span<const uint8_t> bytes) = 0; // PART_DATA
    virtual void markDirty() = 0;                    // the state for the frame changed
    virtual uint64_t random() = 0;                   // repeatable generator
protected:
    ~PartHost() = default;
};

class Part {
public:
    virtual ~Part() = default;
    virtual void attach(PartHost& host, const Json& settings) = 0;
    virtual void reset() = 0;                                    // return to the start
    virtual void onEdge(int role, bool level, Time t) {}         // net change
    virtual void onWake(uint32_t tag, Time t) {}
    virtual void onCommand(std::string_view cmd, const Json& args) {}
    virtual void onData(uint16_t channel, std::span<const uint8_t> bytes) {}
    virtual void onSettings(const Json& settings) {}
    virtual void onChunkEnd() {}                                 // before the frame is sent
    virtual void writeState(ByteWriter& out) const {}            // part block in FRAME
};

using PartFactory = std::unique_ptr<Part> (*)();
void registerPart(std::string_view type, PartFactory factory);
void registerBuiltinParts();                 // explicit list of all library parts

}  // namespace fpgasim
```

Rules:

- A role is the sequence number of the part's pin from its description.
- `onEdge` is called only for roles that have `"edges": true` in the description. An LED does not need edges: it reads the statistics in `onChunkEnd`.
- A part does not call the engine or other parts. All interaction goes through nets.
- Parts are registered by an explicit list in `registerBuiltinParts()`. Self-registration through static objects is forbidden: the linker drops such objects from a static library.
- Each part has its own random number generator, seeded from its `id`. A repeated run gives the same result, so the tests are reproducible.
- `Json` is `nlohmann::json`. It is used only in control messages; it is not in the simulation loop.

### 5.7. Part description

The file `parts/<type>/part.json` (schema `spec/part.schema.json`) is read both by the core when building the library and by the interface.

```json
{
  "format": 1,
  "type": "led",
  "since": 1,
  "name": { "ru": "Светодиод" },
  "pins": [
    { "role": "in", "dir": "in", "edges": false, "label": { "ru": "Вход" } }
  ],
  "settings": {
    "activeLevel": { "type": "integer", "enum": [0, 1], "default": 1, "label": { "ru": "Горит при уровне" } },
    "color": { "type": "string", "enum": ["red", "green", "blue", "yellow", "orange", "white"], "default": "red", "label": { "ru": "Цвет" } }
  },
  "commands": [],
  "events": []
}
```

`dir` is set from the part's side: `in` means the part reads the net, `out` means it drives it. A new part is added with three files: the description, a C++ class in `core/src/parts/`, and a widget in `web/src/parts/`. The class goes into the lists in `core/CMakeLists.txt` and `core/src/parts/builtin.cpp`. The switch and the probe have no C++ file of their own: they live in `button.cpp` and `led.cpp`.

### 5.8. Building into a library

- Build system: CMake. Targets: `fpgasim_rt` (a static library), `fpgasim_tests` (tests on a regular machine, Catch2).
- The WebAssembly library `libfpgasim_rt.a` is built in the build image with the command `emcmake cmake`, with the same optimization flags as the model. It contains the runtime, all parts, the template part of the engine, and the Verilator support files (`verilated.cpp` and the others that linking requires; stage 0 determines the exact list).
- The library and the Verilator version in the image must match: the Verilator support files are tied to its version.
- Next to it lies `host.js`, an Emscripten library with the imports `fs_emit_json`, `fs_emit_binary`, `fs_now_ms`.
- The runtime version (`runtime`) is a string from `core/VERSION`; it is part of the build cache key.

## 6. Part library of version 1

For each part: pins, settings, behavior, commands, events, state in the frame, widget.

### 6.1. LED (`led`)

- Pin: `in`.
- Settings: `activeLevel` (0 or 1), `color`.
- Behavior: the brightness over a chunk equals the fraction of time the net was at the active level. The interface smooths it with a time constant of 30 ms, so that PWM looks like a steady glow while slow blinking stays sharp.
- State: none; the interface takes the data from the net block of the frame.
- Widget: a circle with a color and a glow by brightness; a tooltip with the pin number, level, fraction and toggle frequency. While paused, the widget shows the instantaneous pin level, not the fraction over the last step; if nobody drives the net, the LED is off (decision 54).

### 6.2. Button and switch (`button`, `switch`)

- Pin: `out`.
- Settings: `activeLevel` (the level when pressed), `key` (a keyboard key), `bounceMs` (0–20, default 0), `idle` (`"release"`: at rest the net is released and the pull sets the level; `"drive"`: at rest the part holds the opposite level; default `"release"`).
- Commands: `press`, `release` for the button; `set` with `{ "on": true }` for the switch.
- Behavior: when pressed, the part drives the net at the level `activeLevel`; when released, according to the `idle` setting. With `bounceMs > 0`, after each press and release the net toggles randomly during the set time with intervals from 50 µs to 2 ms and then takes the final level.
- State: 1 byte (pressed or not).
- Widget: the button is pressed with the mouse and with a key; holding Shift while clicking latches the press. The switch changes position on a click.

The built-in 20K buttons are described with `idle: "release"`. A project without `PULL_MODE=DOWN` gets a floating input and a notice, as on a real board.

### 6.3. UART (`uart`)

- Pins: `fromFpga` (the part reads; edges are needed), `toFpga` (the part drives). Either of the two can be left unconnected.
- Settings: `baud` (300–3,000,000, default 115,200), `lineEnding` for input (`"none"`, `"lf"`, `"crlf"`). In version 1 there is one frame format: 8 data bits, no parity, one stop bit.
- Receiving from the FPGA: on a falling edge on an idle line the part asks for a wake-up after one and a half bits, then reads eight bits at one-bit steps and checks the stop bit. The received bytes go into PART_DATA (channel 0) in a batch at the end of the chunk, or earlier when 1024 bytes have accumulated. A zero stop bit gives the event `framingError` with the data `{ "count": N }` (the number of errors since the start), at most once per 100 ms of simulation time.
- Sending to the FPGA: the command `send` with `{ "bytes": [72, 105] }` queues the bytes (at most 65,536 bytes, the excess is dropped); the part puts them on `toFpga` by wake-ups. The same bytes can be sent in PART_DATA (channel 0). The idle line holds 1.
- Event `baudMismatch`: the shortest pulse among the last 64 edges is shorter than a bit by more than 10%, or is longer than a bit and not a multiple of it (with the same tolerance; a pulse longer than nine bits cannot be a frame). A pulse of a whole number of bits at the right speed comes from bytes without single bits; this is not an error (decision 75). The event data holds an estimate of the real speed `baud` and the part setting `setting`. The event is issued at most once per second of simulation time. This is a common beginner error (a wrong divisor), and the hint names it.
- State: three u32 numbers: bytes received, bytes sent, queue length.
- The `lineEnding` setting acts in the interface: its bytes are appended to the terminal input line.
- Widget: an icon on the board (a click opens the terminal tab) and the terminal tab: output, input line, display as text or as hexadecimal codes, clearing, saving the log to a file. The log starts anew together with the simulation (reset, `configure`, new build) and holds at most 256 KB: on overflow the second half stays.

### 6.4. WS2812 (`ws2812`)

- Pin: `din` (edges are needed).
- Settings: `count` (1–256), `order` (`"GRB"` by default, `"RGB"`), `layout` (`"strip"`, `"ring"`, `"matrix"` with a width).
- Behavior: the part measures the duration of the one and the period of each bit. A one of 200–500 ns reads as 0, 550–1000 ns reads as 1; a pulse outside both windows reads by the nearest window (the boundary is 525 ns). A pause at zero longer than 50 µs latches the received data: the first 24 bits go to the first LED, the next ones further along the chain. Bits beyond `count` are counted and dropped. LEDs the data did not reach keep their color.
- Event `timingError`: a pulse outside both windows, or a bit period outside 900–1900 ns. The data holds the first error of the frame: `highNs` or `periodNs` (the measured value), `bit` (the number of the bit in the frame at which the one or the period was measured), `count` (errors in the frame), `total` (errors since the start). The event is issued at most once per latch.
- State: u16 number of LEDs, u16 reserved, u32 error counter, then `count` RGB triples after the last latch.
- Widget: LEDs in the chosen layout; a tooltip with the color value of the LED under the pointer.

A 27 MHz clock step is 37 ns, so the measurement fits within the tolerances.

### 6.5. Probe (`probe`)

- Pin: `in`.
- Settings: `label`.
- Behavior: adds the net to the signal panel and to the recording under the name `pin:N`. It has no model.
- Widget: a probe on the pin with a label and the current level.

## 7. Engine

### 7.1. Interface

File `core/include/fpgasim/engine.h`:

```cpp
namespace fpgasim {

enum class PortDir { In, Out, InOut };
enum class SignalKind { Port, Wire, Reg, Memory, Param };

struct PortInfo   { std::string name; PortDir dir; uint32_t width; };
struct SignalInfo { std::string path; uint32_t width; SignalKind kind; uint32_t depth; };
struct EngineInfo { std::string name; std::string version; std::string top; };   // for ready

struct RunResult {
    uint64_t halfSteps;      // how many half-cycles were run
    bool     changed;        // stopped because of an output or a recorded signal
    bool     finished;       // the model called $finish
};

class Engine {
public:
    virtual ~Engine() = default;
    virtual EngineInfo info() const = 0;
    virtual const std::vector<PortInfo>&   ports() const = 0;
    virtual const std::vector<SignalInfo>& signals() const = 0;  // the first ones are ports: the port number equals sig
    virtual void reset() = 0;                                   // the model is created anew
    virtual void setClockPort(int port) = 0;                    // -1: no clock
    virtual void setInputBit(int port, uint32_t bit, bool level) = 0;
    virtual void settle() = 0;                                  // re-evaluation after inputs change
    virtual RunResult run(uint64_t maxHalfSteps) = 0;           // the inner clock loop
    virtual void readPort(int port, uint32_t* words) const = 0;
    virtual void readSignal(uint32_t sig, uint32_t* words) const = 0;
    virtual void setTracked(std::span<const uint32_t> sigs) = 0; // recorded signals
    virtual std::span<const int> changedOutputs() = 0;          // ports changed since the last call
};

std::unique_ptr<Engine> createEngine();      // defined by the shim

}  // namespace fpgasim
```

The runtime knows only this interface. A move to CXXRTL means a different shim and a different template; the rest does not change.

### 7.2. Shim template

The common part lives in the library: the class template `VerilatorEngine<Model, Derived>` in `core/include/fpgasim/engine_verilator.h`. It holds the clock loop:

```cpp
RunResult run(uint64_t maxHalfSteps) override {
    uint64_t i = 0;
    while (i < maxHalfSteps) {
        *clk_ = (half_ & 1) ? 0 : 1;         // even half-cycle: rising edge
        top_->eval();
        ++half_; ++i;
        const bool outputs  = self().outputsChanged();        // both checks always run,
        const bool tracked  = tracking_ && trackedChanged();  // otherwise the previous values go stale
        const bool finished = ctx_->gotFinish();
        if (outputs || tracked || finished) return {i, outputs || tracked, finished};
    }
    return {i, false, false};
}
```

`outputsChanged()` is called without a virtual call (through `Derived`), so that the compiler inlines the comparison into the loop.

The generated part is the file `shim.cpp`, which the server creates from the template `server/templates/shim.cpp.j2` using the port list:

```cpp
// Created by the FPGA SIM build server. Do not edit.
#include "Vtop.h"
#include "fpgasim/engine_verilator.h"

namespace {

struct Shim final : fpgasim::VerilatorEngine<Vtop, Shim> {
    static constexpr fpgasim::PortDesc kPorts[] = {
{%- for p in ports %}
        { "{{ p.name }}", fpgasim::PortDir::{{ p.dir }}, {{ p.width }} },
{%- endfor %}
    };
    static constexpr const char* kTop = "{{ top }}";

    Shim() { init(); }                       // the common part creates the model, but through the shim

    void* portData(int port) {
        switch (port) {
{%- for p in ports %}
            case {{ loop.index0 }}: return &top_->{{ p.cname }};
{%- endfor %}
        }
        return nullptr;
    }

    bool outputsChanged() {
        bool changed = false;
{%- for p in outputs %}
        if (FPGASIM_DIFFERS(top_->{{ p.cname }}, prev_{{ p.cname }})) {
            FPGASIM_COPY(prev_{{ p.cname }}, top_->{{ p.cname }});
            markChanged({{ p.index }});
            changed = true;
        }
{%- endfor %}
        return changed;
    }

{%- for p in outputs %}
    {{ p.ctype }} prev_{{ p.cname }}{};
{%- endfor %}
};

}  // namespace

std::unique_ptr<fpgasim::Engine> fpgasim::createEngine() {
    return std::make_unique<Shim>();
}
```

The rest (setting an input bit, reading ports through `portData` and the width, enumerating signals, comparing recorded signals) is implemented by the common part.

**Port list.** The server gets it from the header `Vtop.h`, which Verilator creates: the lines with the macros `VL_IN*`, `VL_OUT*`, `VL_INOUT*` contain the name and the bit bounds. Verify at stage 0 that the header format in the chosen version is like this; the fallback is Verilator's machine-readable output (`--json-only`).

**Internal signals.** With `visibility: "all"` Verilator runs with `--public-flat-rw`, and the common part of the engine enumerates signals through the scope and variable descriptions in the Verilator support library, getting direct pointers to the data. Verify at stage 0: whether enumeration works without VPI and how much speed this flag costs. The fallback is VPI (`--vpi`).

**The clock port** is set at `configure`, not at build time: the common part takes a pointer to the one-bit port through `portData`. So the clock binding is not part of the cache key.

### 7.3. Two visibility modes

| Mode | Flag | What is visible | Purpose |
|---|---|---|---|
| `ports` | — | Ports only | Default |
| `all` | `--public-flat-rw` | Ports and all internal signals | Debug mode: 1.3–2 times slower |

The default mode is `ports` (decision 108): in `all` mode, lessons 7, 9 and 10 run at the limit of real time or slower. `all` mode is turned on with the "Show internal signals and rebuild" button on the "Signals" tab or with the "Internal signals" field in the project settings; the choice is written to `design.visibility`.

### 7.4. Verilator flags

```
verilator --cc --prefix Vtop --top-module <top> -Mdir obj \
    --x-assign 0 --x-initial 0 --no-timing \
    -Wall -Wno-fatal --error-limit 30 \
    -O3 --compiler clang \
    [--public-flat-rw] \
    -G<parameter>=<value> … -D<macro>[=<value>] … -I<folder> … \
    <design files>
```

| Flag | Why |
|---|---|
| `--x-assign 0 --x-initial 0` | Registers without an initial value start at zero, like on a Gowin FPGA after loading. The interface mentions this in the description of limitations |
| `--no-timing` | `#` delays in the design do not run; the warning `STMTDLY` reports them |
| `-Wall -Wno-fatal` | All warnings are on and do not stop the build |
| `--error-limit 30` | A beginner does not need a long stream of errors |
| `--public-flat-rw` | Only in `all` mode |

The Verilator version is pinned in the image: a stable release on which all examples pass. The author's machine has 5.055; judging by the numbering, this is a build from the development branch, so the image takes the nearest stable release, and stage 0 records behavior differences in its report.

### 7.5. Emscripten flags

Compiling the model and the shim with one command:

```
em++ -std=c++20 -O2 -c obj/*.cpp shim.cpp \
    -I/opt/verilator/include -I/opt/verilator/include/vltstd \
    -I/opt/fpgasim/include -Iobj
```

Linking:

```
em++ *.o /opt/fpgasim/rt/libfpgasim_rt.a -o sim.mjs -O2 \
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=worker,node \
    -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=536870912 \
    -sFILESYSTEM=0 -sASSERTIONS=0 \
    -sEXPORTED_FUNCTIONS=_fs_init,_fs_alloc,_fs_free,_fs_json,_fs_binary,_fs_tick \
    -sEXPORTED_RUNTIME_METHODS=HEAPU8 \
    --js-library /opt/fpgasim/rt/host.js
```

- The flag set in effect and the compile order (flags beyond those listed, a precompiled header, one process per file) are in decisions 5, 6 and 32; they are recorded in `server/job/job.py`.
- Threads are not used. The core runs in one Worker; no special page isolation headers are needed.
- `node` in `ENVIRONMENT` is needed so that the same core runs in tests without a browser.
- If the project has memory data files (`.hex`, `.mem`), they are embedded (`--embed-file`) and linking uses `-sFILESYSTEM=1`, so that `$readmemh` works.
- The optimization level (`-O1`, `-O2`, `-O3`), the precompiled header and link-time optimization are chosen at stage 0 by two numbers: speed on `blink3` and build time. The default before measurement: `-O2` without link-time optimization.
- The Emscripten version is pinned in the image at stage 0 (the latest stable release at that moment) and recorded in `server/docker/versions.env`.

### 7.6. Compiler messages

The server parses Verilator output by lines of the form `%Warning-CODE: file:line:column: text` and `%Error[-CODE]: file:line:column: text` and returns an array:

```json
{ "source": "verilator", "severity": "warning", "code": "BLKSEQ",
  "file": "top.v", "line": 14, "column": 15,
  "original": "Blocking assignment '=' in sequential logic process", "args": {} }
```

`source`: `verilator`, `iverilog`, `cst`, `project`, `toolchain`. Icarus Verilog messages (the `testbench` operation) have no codes: the code is `ERROR` or `WARNING`, the column is empty, and the interface shows the original text (decision 90). `severity` from the server: `error` or `warning`. The interface determines the translation and the display level from the table `spec/diagnostics.json`, so that the language can change without a rebuild. A table entry: code → display level, short text, explanation.

Display levels: **important** (a yellow mark on the line and a line in the messages panel), **note** (a gray mark, in the panel under a collapsed heading), **hidden**. Errors are always shown in red with a jump to the line. An unknown code is shown as a note with the original English text.

| Verilator code | Level | Short text |
|---|---|---|
| `BLKSEQ` | important | Blocking `=` in a clocked `always` block. Use `<=` for registers, otherwise the order of lines changes the circuit |
| `COMBDLY` | important | Non-blocking `<=` in a combinational `always` block. Use `=` here |
| `LATCH` | important | A latch was inferred: the signal is not assigned in every branch. Add `else` or a default value |
| `WIDTHTRUNC`, `WIDTH` | important | The value is wider than the target; the upper bits are dropped |
| `WIDTHEXPAND` | note | The value is narrower than the target; it is padded with zeros |
| `IMPLICIT` | important | The signal is not declared and was created implicitly as a 1-bit wire. Check the name for a typo |
| `UNDRIVEN` | important | The signal has no driver; it is always zero |
| `UNUSEDSIGNAL`, `UNUSED` | note | The signal is declared but not used |
| `UNUSEDPARAM` | note | The parameter is not used |
| `MULTIDRIVEN` | important | The signal is driven from several `always` blocks |
| `CASEINCOMPLETE` | important | The `case` does not list all values and has no `default` |
| `CASEOVERLAP` | important | `case` branches overlap |
| `PINMISSING` | important | A port is missing in the module instance |
| `PINCONNECTEMPTY` | note | A module port is left unconnected |
| `UNOPTFLAT` | important | Combinational loop: the signal depends on itself without a register |
| `SYNCASYNCNET` | important | The reset is used both as synchronous and as asynchronous |
| `SELRANGE` | important | The index is out of the bit range |
| `CMPCONST`, `UNSIGNED` | important | The comparison is always true or always false |
| `STMTDLY`, `ASSIGNDLY` | important | The `#` delay does not run in the circuit: an FPGA has no delays |
| `INITIALDLY` | note | Non-blocking `<=` in an `initial` block |
| `MULTITOP` | important | The project has several top modules |
| `PROCASSWIRE` | important | Assignment to a wire inside `always`: declare the signal as `reg` |
| `CST_IO_TYPE` (a server code, not Verilator) | important | Port `led[0]`: the constraint file has `IO_TYPE=LVCMOS33`, but pin `10` on the board uses the `LVCMOS18` standard |
| `DEVICE_NOT_MODELED` (a server code, not Verilator) | note | Pin `33` goes to the device "HDMI". A model of the device will come in version 2 |
| `DECLFILENAME`, `EOFNEWLINE`, `GENUNNAMED`, `VARHIDDEN`, `TIMESCALEMOD`, `UNUSEDGENVAR`, `PINNOCONNECT`, `IMPORTSTAR`, `PROCASSINIT` | hidden | — |

The explanations (two or three sentences with an example of a fix) are written by the stage 5 agent into `spec/diagnostics.json`; the author reads them over.

Special error cases:

- Verilator did not find a module. If the name is in `spec/gowin-primitives.txt` (the list of Gowin primitives, compiled at stage 3), the server issues `GOWIN_PRIMITIVE_UNSUPPORTED` with the name: "The Gowin primitive `rPLL` is not supported yet; it will come in version 2". Otherwise `MODULE_NOT_FOUND`.
- C code inserts in the design (`$c`, `` `systemc_* ``) are the error `C_CODE_UNSUPPORTED` before the build (decision 42).
- A C++ compile or link failure is `TOOLCHAIN_FAILED` with the last 40 lines of output. The interface shows "Internal build error" and a "Copy report" button.
- Exceeding time or memory is `BUILD_TIMEOUT`, `BUILD_OOM`; running out of disk space in the job folder is `BUILD_DISK_LIMIT`; exceeding the `sim.wasm` size is `WASM_TOO_LARGE`.
- More messages than the limit in section 8.5: the extra ones are dropped, and `DIAGNOSTICS_TRUNCATED` is added at the end.
- A port bound to a pin of a `devices` device in the board file that has a `since` version is the warning `DEVICE_NOT_MODELED` with the fields `port`, `pin`, `device` (the device label is text per language, as in the board file; the interface chooses the language), `since`. The source is `cst` or `project`, as for `PIN_FORBIDDEN`. For a forbidden pin only `PIN_FORBIDDEN` is issued. The build proceeds.
- An `IO_TYPE` in `IO_PORT` that does not match the pin standard (the pin's `standard` field, without it the board's `io.standard`) is the warning `CST_IO_TYPE` with the fields `port`, `pin`, `given` (the value from the file), `expected` (the board standard). The source is `cst`, the line is the `IO_PORT` line. With no `IO_TYPE`, and for a forbidden pin, there is no notice. The build proceeds (decision 164).

## 8. Build server

### 8.1. Structure

- The `api` service: FastAPI under Uvicorn, one process. It accepts requests, checks the key or the session token and the limits, resolves the project settings, keeps the cache and starts jobs.
- Accounts, sessions and "in browser" projects live in the SQLite database `/var/lib/fpgasim/accounts/accounts.db` inside the same service (`docs/tz-accounts.md`, sections 1 and 2; decision 118). A task inside the service empties the trash once a day and writes a copy of the database (sections 2.5 and 2.6 there; decision 128).
- A job: a one-shot container from the `fpgasim-build` image. The service starts it with the `docker run` command and waits for it to finish.
- In front of the service stands the VPS system nginx: TLS and proxying (example vhost `deploy/nginx-build.conf.example`). There is no Caddy: ports 80 and 443 on the VPS are taken by nginx with other sites (decision 31).
- The service is described in `deploy/compose.yaml` and listens only on `127.0.0.1:8090`. The service is given the Docker socket; the service itself does not execute foreign code.

Starting a job:

```
docker run --rm --network none --cpus 2 --memory 2g --memory-swap 2g \
    --pids-limit 256 --cap-drop ALL --security-opt no-new-privileges \
    --user 10001:10001 --read-only --tmpfs /tmp:size=256m \
    --name fpgasim-job-<id> -e HOME=/tmp \
    -v /var/lib/fpgasim/jobs/<id>:/work \
    fpgasim-build:<version> /opt/fpgasim/bin/job <operation>
```

The service creates the job folder and deletes it after completion. The folder contents after the job are untrusted data: the service reads only regular files from it, without following links and with a size limit (decision 37). The path `/var/lib/fpgasim` is the same in the service container and on the VPS, otherwise the volume mount will not work.

### 8.2. Build image

Base: Ubuntu 24.04. Contents:

| What | From where | Note |
|---|---|---|
| Verilator | Built from source by tag | The version is in `versions.env` |
| Emscripten | emsdk by version number | The version is in `versions.env` |
| Icarus Verilog | System package | For testbenches |
| `libfpgasim_rt.a`, headers, `host.js` | Build of `core/` inside the image | A separate layer, rebuilt when `core/` changes |
| Board files | `boards/` | For parsing the binding |
| The `job` script | `server/job/` | Python: the build and testbench steps |

Yosys is not in the version 1 image: only the synthesis check in version 2 needs it, and it makes the image noticeably larger.

The image tag is made of the tool versions and `core/VERSION`; it also serves as `toolchain` in the cache key.

There are two images (decision 30): `fpgasim-tools:vl…-em…` with the tools (the first three rows of the table; it builds for a long time, and once), and on top of it `fpgasim-build:vl…-em…-rt…` with the rest. The server runs jobs in the second.

### 8.3. Operations

All requests and responses are JSON. Except for `/v1/health` and `/v1/auth/login`, the header `Authorization: Bearer <key or session token>` is needed. The server looks the value up first among the sessions, then among the keys (`docs/tz-accounts.md`, section 2.3).

**`GET /v1/health`** → `{ "status": "ok" }`. No key.

**`GET /v1/info`** → versions (`toolchain`, `runtime`, `verilator`, `emscripten`, `protocol`), the limits in effect, `owner` (the login for a session, the owner name for a key), `auth` (`session` or `key`), `user` (the account for a session, `null` for a key) and `assistant` (`{ "enabled": bool, "model": string | null }`, decision 175).

The operations for login, accounts and projects on the server (`/v1/auth/…`, `/v1/projects…`, `/v1/admin/…`) are described in section 3 of `docs/tz-accounts.md`. A key gets 403 `FORBIDDEN` on them.

**`POST /v1/check`** is a fast check without compiling: Verilator with the build flags (`--cc`, not `--lint-only`: the ports for `resolved` are read from `Vtop.h`, decision 34); the job goes no further. The request is the same as for a build. Response: `status`, `diagnostics`, `resolved`. It is used when saving a file and for the binding dialog. The expected time is under a second.

**`POST /v1/build`**

Request:

```json
{
  "files": [ { "path": "top.v", "content": "module top…" }, { "path": "top.cst", "content": "IO_LOC…" } ],
  "config": { "format": 1, "board": "tang-nano-20k" },
  "options": { "visibility": null }
}
```

`config` is the contents of `fpgasim.json` or `null`. `options.visibility` overrides the value from the settings.

Response (code 200 even for a failed build):

```json
{
  "status": "ok",
  "buildId": "3f9c…",
  "cached": false,
  "durationMs": 6840,
  "diagnostics": [ … ],
  "resolved": {
    "board": "tang-nano-20k",
    "top": "top",
    "topFile": "top.v",
    "files": ["top.v"],
    "testbenches": ["tb_top.v"],
    "constraints": "top.cst",
    "visibility": "all",
    "ports": [ { "name": "clk", "dir": "in", "width": 1, "msb": 0, "lsb": 0 }, { "name": "led", "dir": "out", "width": 6, "msb": 5, "lsb": 0 } ],
    "clock": { "port": "clk", "pin": 4, "hz": 27000000 },
    "pins": [ { "port": "led", "bit": 0, "pin": 15, "pull": "none" } ],
    "unbound": []
  },
  "artifacts": { "wasm": "/v1/artifacts/3f9c…/sim.wasm", "js": "/v1/artifacts/3f9c…/sim.mjs" }
}
```

`resolved.topFile` is the file with the top module: the interface marks it in the file list (decision 94). In `resolved.ports` the ports go in source text order; `msb` and `lsb` are the bit bounds as declared. In `resolved.pins` the `bit` field is the offset from the least significant bit. `resolved.unbound` is an array of `{ "port", "bit" }`. The fields `ports`, `clock`, `pins` and `unbound` appear when Verilator has named the ports (decision 35).

`status`: `ok` or `failed`. With `failed` there is no `artifacts` field, and `resolved` is filled as far as possible (for example, the list of candidates for `TOP_AMBIGUOUS` is in the message's `args`).

**`GET /v1/artifacts/{buildId}/{name}`** is a build file. The header is `Cache-Control: public, max-age=31536000, immutable`. The host fetches both files with `fetch` using the key; `sim.mjs` is loaded as a module through a temporary address (a Blob URL).

**`POST /v1/testbench`**

Request: `files`, `config`, `testbench` (the path of a `.v` or `.sv` file from `files`; otherwise 400 `BAD_REQUEST`). The server compiles all design files (`resolved.files`) and the chosen testbench (`iverilog -g2012 -s <module>`), runs `vvp -n` and returns:

```json
{
  "status": "ok",
  "exitCode": 0,
  "durationMs": 420,
  "stdout": "PASS: all 12 checks\n",
  "truncated": false,
  "diagnostics": [],
  "vcd": "/v1/artifacts/tb-91ab…/dump.vcd"
}
```

`status`: `ok` (the run took place; the success of the test itself is visible from the output), `failed` (a compile error or a project settings error, out of memory), `timeout`. The waveform file is looked up by `$dumpfile`; if the testbench does not create it, `vcd` is `null`. Testbench results are kept for an hour.

Details (decisions 89–91):

- The root modules (`-s`) are the modules of the testbench file whose name does not occur in that file outside their own text. If there are none, the error `TB_NO_MODULE`. Other testbenches of the project do not go into the compilation. The macros `design.defines` and the folders `design.includeDirs` are passed to the compiler; `design.parameters` are not: the testbench creates the design instance itself.
- The testbench runs on a copy of the project files: include files and data files (`$readmemh`) are available at the project paths. The design's top module, the binding and the board do not affect the run; an error in `fpgasim.json` is returned as a message with `status: "failed"`.
- `exitCode` is the `vvp` exit code; `null` if the run did not take place or the testbench was stopped. `stdout` holds the standard output and the error output of `vvp` together; on `timeout` it holds what the testbench managed to print.
- `diagnostics`: compiler messages (`source: "iverilog"`, file and line), as well as `TB_TIMEOUT`, `TB_OOM`, `TB_DISK_LIMIT`, `TB_NO_MODULE`, `TOOLCHAIN_FAILED` and the warning `TB_VCD_TOO_LARGE` (the waveform file is over the limit: `vcd` is `null`, the rest of the response stays valid).
- The waveform file is the file named by `$dumpfile("…")` in the testbench text, or `dump.vcd`, lying inside the run folder. It is served by the `artifacts` operation with the type `text/plain` and the header `Cache-Control: private, max-age=3600`; after an hour the response is 404.
- The 20 s time includes compilation. The response arrives within 25 s at most. The operation has no cache. A testbench takes a place in the job queue, like a build.

**`POST /v1/assistant`** is one model call of the assistant (decision 175). A session or a key. Request: `{ "messages": [...], "language": "ru" | "en" }`: the whole conversation in the Anthropic Messages format, as the server returned it, with the user turns of text and `tool_result` blocks; at most 1 MB and 60 messages; roles alternate, the first and the last turn are the user's. The server adds the system prompt, the five tool definitions (`list_files`, `read_file`, `get_messages`, `get_board`, `get_waveform`), the model and the effort from `[assistant]` of `/etc/fpgasim/config.toml`, and makes one call. Response: `{ "content": [...], "stop_reason": "...", "usage": { "input", "output", "cacheRead", "cacheWrite" } }`. The browser runs the tools on the live project state and posts the conversation again while `stop_reason` is `tool_use`, at most 10 calls per question. Errors: 503 `ASSISTANT_OFF` (no key or `enabled = false`), 429 `ASSISTANT_LIMIT` (a daily token limit), 502 `ASSISTANT_FAILED` (the model service failed), 413 `ASSISTANT_TOO_LONG`. The tokens are counted per UTC day in `<data folder>/assistant/usage.db` (decision 176).

Request errors: 400 `BAD_REQUEST`, 401 `UNAUTHORIZED`, 401 `BAD_CREDENTIALS`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 405 `METHOD_NOT_ALLOWED`, 409 `EXISTS`, 413 `PROJECT_TOO_LARGE`, 429 `RATE_LIMITED`, 429 `LOGIN_LOCKED`, 500 `INTERNAL`, 503 `BUSY`, and the assistant codes above. Body: `{ "error": { "code": "…", "text": "…" } }`. The codes `BAD_CREDENTIALS`, `FORBIDDEN`, `EXISTS` and `LOGIN_LOCKED` come only from the operations of section 3 of `docs/tz-accounts.md`.

### 8.4. Build steps

1. Check the request and the limits.
2. Resolve the settings (section 2.5), parse the `.cst`. Errors at this step end the build.
3. Compute the cache key; on a hit the response is returned at once with `cached: true`.
4. The job in the container: Verilator → parse `Vtop.h` → create `shim.cpp` → compile → link.
5. Collect the messages, write to the cache, respond.

The cache key: SHA-256 of canonical JSON with the fields `toolchain`, `runtime`, `visibility`, `top`, `files`, `dataFiles`, `parameters`, `defines`, `includeDirs` and the list `sources` of pairs "path, SHA-256 of the content" for the design files, include files and data files. The binding, parts, watch and testbenches are not part of the key.

Failed builds are cached too (messages without files), except for failures that depend on server load: `BUILD_TIMEOUT`, `BUILD_OOM`, `TOOLCHAIN_FAILED` (decision 36).

### 8.5. Limits

| What | Value |
|---|---|
| Files in a project | 200 |
| File size | 512 KB |
| Project size | 2 MB |
| Build time | 60 s |
| Build memory | 2 GB, 2 cores |
| Size of `sim.wasm` | 16 MB |
| Disk space in the job folder | 512 MB |
| Testbench time | 20 s, 512 MB, 1 core |
| Testbench output | 256 KB, truncated beyond that |
| Testbench waveform file | 20 MB |
| Stored testbench waveform files | 1 GB in total, 1 hour; when exceeded, the oldest are deleted |
| Concurrent jobs | 2; the rest wait up to 60 s, then `BUSY`. A freed slot goes first to a key or an account with no jobs running (decision 165) |
| Build requests from one key | 30 per minute |
| Testbench runs from one key | 30 per minute, counted separately |
| Check requests from one key | 240 per minute |
| Messages in a response | 100 `.cst` notices, 500 Verilator warnings |
| Build cache | 2 GB, least recently used entries are evicted |
| Assistant requests from one key | 20 per minute |
| Assistant tokens of one key per UTC day | 400,000 (all four kinds: input, output, cache read, cache write) |
| Assistant tokens of the server per UTC day | 4,000,000 |

The "from one key" limits also apply to an account: the count is kept separately for each key and each account (decision 121). The limits for login, session, projects on the server and account operations are in section 3.6 of `docs/tz-accounts.md` and decisions 121 and 127.

The values are in `/etc/fpgasim/config.toml` and are returned in `/v1/info`.

### 8.6. Keys

- The file `/etc/fpgasim/keys.toml`: owner name → SHA-256 of the key and the `enabled` flag. The keys themselves are not stored on the server.
- The utility `fpgasim-admin`: `key add <name>` (prints the key once), `key disable <name>`, `key list`. The commands `user …` and `db restore` are in section 3.8 of `docs/tz-accounts.md`.
- A key is 32 random bytes in base64url.
- The interface stores the key in `localStorage`. A link like `https://fpga-sim.scriptorium.cc/#key=…` writes the key and removes it from the address bar.
- A key gives only the build operations. People sign in with a login and password (`docs/tz-accounts.md`, sections 2.2–2.4); keys remain for scripts (`make e2e`, `make e2e-prod`, `make bench`) and for signing in by link (decision 120).
- CORS: the interface address of the site (`FPGASIM_WEB_URL` of the site settings, passed to the service as `FPGASIM_CORS_ORIGINS`, decision 173) and `http://localhost:5173` are allowed; the methods are `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.

### 8.7. Log

One JSON line per request: time, the key owner or login (`owner`), the sign-in kind (`auth`: `session`, `key` or `null`), operation, `buildId`, cache hit, duration, outcome, project size. Sources are not written to the log. An `assistant` line has `model`, `tokensIn`, `tokensOut`, `cacheRead`, `cacheWrite` and `stopReason`; questions, answers and tool results are not written. The log goes to the container's standard output. The operations of accounts and projects on the server and their fields are in section 3.7 of `docs/tz-accounts.md` and decision 129; the lines of the maintenance task (`trash-purge`, `backup`) are in decision 128. Passwords, session tokens and file contents do not go to the log.

## 9. Interface

### 9.1. Tools

| Task | Choice | Reason |
|---|---|---|
| Base | React, TypeScript (strict mode), Vite | Agents write it most reliably; heavy drawing bypasses React |
| State | Zustand | Small size, easy to read from Canvas code without re-rendering React |
| Editor | CodeMirror 6 | Light, has Verilog highlighting (`@codemirror/legacy-modes`) and line marks (`@codemirror/lint`) |
| Board, breadboard, waveforms | Canvas 2D | A decision from the vision document |
| Storage | IndexedDB through `idb` | Projects and files |
| Archives | `fflate` | Loading and exporting `.zip` |
| Tests | Vitest, Playwright (Chromium) | Unit and end-to-end |
| Strings | The dictionaries `web/src/i18n/ru.json`, `en.json` and the function `t(key, args)`; the language is chosen at load (decision 168) | Latvian is added as a third file |

Core frames do not pass through React state. The host puts the last frame into a plain object, and the Canvas drawing reads it in `requestAnimationFrame`. React updates only on control messages.

### 9.2. Project storage

- The IndexedDB database `fpgasim`: the stores `projects` (identifier, name, modification time, kind: `browser` or `folder`, for a folder its handle) and `files` (project, path, content, modification time).
- A project in the browser: create an empty one, from an example, from a `.zip` archive, from separate files by dragging. Export: as an archive, as a separate file, only the changed files (changed means relative to the content at project creation, decision 98).
- A project in a folder (Chrome, Edge): `showDirectoryPicker`, reading and writing straight to disk; `fpgasim.json` is saved into the same folder. From disk it takes design files, binding files, memory data files and `fpgasim.json` in the root; build output for a board and hidden folders are not taken (decision 96). Changes are tracked by polling the files' modification time once a second. The "Rebuild on change" switch starts a build 500 ms after the last change. After a page reload the browser asks for permission again, and the interface shows the "Reopen folder" button.
- In Safari and Firefox the "Open folder" item is visible but disabled, with an explanation.
- Unsaved editor changes are written to storage 300 ms after typing.
- When signed in with a login and password, "in browser" projects belong to the account (the `account` field) and synchronize with the server by themselves (the module `web/src/project/sync.ts`). The new fields of the project and file records, the visibility rules, the schedule and the parsing of the server response are in sections 4.1–4.5 of `docs/tz-accounts.md`, decisions 141 and 142. The version of the `fpgasim` database does not change. Projects "in a folder" do not go to the server.

### 9.3. Screens

**Screen 1. Projects.** A project list (name, board, modification time, kind), the buttons "New project" (a menu with a list of boards; choosing a board creates an empty project, and a non-default board is written to `fpgasim.json`), "From example" (a menu with the groups "Lessons" and "Examples"; choosing an item creates a project), "Open folder", "Upload archive". Top right: the account menu and the server state, the theme switch, help. With no session and no key, a login-and-password form is shown instead of the list. The login form, the account menu and the synchronization marks are in sections 5.1, 5.3 and 5.4 of `docs/tz-accounts.md`.

**Screen 2. Workspace.**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ‹ blink3 ▾ │ [Build] ● Built │ [▶ Run] [Step: 1 clock ▾] [⟲] │ Speed 1× ▾ 0.97×  ☼ ? │
├───────────────┬──────────────────────────────────┬───────────────────────────┤
│ Files     + ⇪ │ top.v                            │ Board [Binding] [+ Part]  │
│  top.v        │                                  │                           │
│  top.cst      │  code editor                     │  [Tang Nano 20K drawing]  │
│  tb_top.v     │  with message marks              │  [breadboard field]       │
│               │                                  │  pin legend               │
├───────────────┴──────────────────────────────────┴───────────────────────────┤
│ Messages │ Nets │ Signals │ Waveforms │ Testbench │ Assistant │ UART terminal│
│  contents of the selected tab                                                │
├──────────────────────────────────────────────────────────────────────────────┤
│ Built in 6.8 s · t = 2.104 s · clock 56,808,000 · Logic simulation, no timing ⓘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

The area borders move with the mouse; any of the three upper areas can be collapsed. The layout is remembered per project. The interface theme is remembered in the browser, not in the project.

The mark "changed since build" is set when the project files or the design settings (the `design` field) differ from those the loaded core was built from. The binding and the parts are not part of the comparison: they take effect without a build.

| Area | Contents |
|---|---|
| Top bar | Return to the project list; the project name, which is also a menu (rename, settings, export); "Build" (Ctrl/Cmd+Enter) and the build mark (not built, building, built, changed since build, error); one "Run" / "Pause" button; a compound step button (1 clock, 10, 100, until output changes, set time); reset; the speed multiplier and the actual ratio; the theme switch (light, dark, as in the system); help |
| Files | A list; create and upload are in the area header; rename and delete are in the file row's menu; file kind icons; a mark for the top module and testbenches |
| Editor | Tabs, Verilog highlighting, message marks on lines with hover text, a jump to a line from the messages panel, search. `fpgasim.json` opens as text; the same set of settings is available in a dialog |
| Board and breadboard | A board drawing with live built-in parts; the header pins are labeled with numbers, and the color shows the status (free, used, forbidden) and the current level; next to it the breadboard field with the added parts and lines to the pins |
| Messages | Errors, important warnings, collapsed notes, simulator notices (`notice`) with the simulation time |
| Nets | A table of pins: number, pin name, port, level, number of toggles, fraction at one |
| Signals | On the left a tree with search, on the right the watch list: name, value, radix; the buttons "Watch", "Record" |
| Waveforms | The panel from section 9.6 |
| UART terminal | One tab for each UART part |
| Testbench | File choice, "Run", text output, the "Show waveform" button |
| Assistant | Shown when `/v1/info` says the assistant is on (decision 175). A line that the question and the project files go to Anthropic; the conversation with answers in Markdown and the tokens of each answer; the step in progress ("Reading a file…"); "Stop", "New conversation". The conversation lives in memory and belongs to the open project: closing or opening a project and reloading the page clear it |
| Status bar | The simulation state, simulation time, clock cycle number, build result, a permanent note about the limitations with a link to the explanation |

**Screen 3. Users.** For the administrator only, opened from the account menu: a table of accounts and actions on them (section 5.6 of `docs/tz-accounts.md`, decision 133).

A session that ended while a project is open shows a strip above the workspace (section 5.2 there, decision 131).

**Dialogs.**

- *Pin binding.* A table: port bit, direction, pin (a choice from a list with names and statuses), pull. When a `.cst` is in effect, the table is read-only, with an "Edit .cst" button. An "Export as .cst" button.
- *Add part.* A list of types from `parts/`, then the choice of pins for the roles and the settings by the schema from the part description. The settings form is built automatically from `settings`.
- *Project settings.* Board, top module, parameters, macros, design files, binding file, visibility mode.
- *Sign in.* Login and password, checked through `POST /v1/auth/login`. The key entry form is removed; a key from the `#key=…` link works as before (section 5.1 of `docs/tz-accounts.md`).
- *Change password.* From the account menu (section 5.3 there).
- *Simulator limitations.* A short list: two signal states (no X and Z); registers without an initial value start at zero; no delays, setup time or hold time; no noise or bounce, except what is turned on in the button settings; bidirectional pins do not work; that a design works here does not guarantee that it will meet the timing on the board.

### 9.4. Board and widgets

- The board is drawn from the `geometry` of the board file: outline, USB connector, chip, headers, built-in parts at their coordinates, and the `devices` devices in gray with a version label (as a list under the drawing: the devices have no coordinates in the board file, decision 53).
- A part widget is a TypeScript class in `web/src/parts/<type>.ts`:

```ts
interface PartWidget {
  layout(part: PartConfig, desc: PartDescription): WidgetBox;
  draw(ctx: CanvasRenderingContext2D, view: PartView): void;   // view: settings, nets, state from the frame
  hitTest?(x: number, y: number): boolean;
  onPointer?(event: WidgetPointerEvent, send: SendCommand): void;
  onKey?(event: KeyboardEvent, send: SendCommand): void;
}
```

- The version 1 breadboard is logical: a part is placed in a cell of the field and joined to a pin with a line. There are no holes and no wiring by rows. A pin is chosen by dragging from the part to a header contact or in the dialog. The field stands to the right of the board and appears when the breadboard has at least one part; the interface chooses the cell for a new part. Dragging works for parts with one pin that are not operated with the mouse (LED, probe, WS2812); for a button and a switch the pin is changed in the dialog (decision 67). For a part with several pins (UART) the pins are chosen in the dialog, and any of them can be left unconnected.
- The button keys work when the focus is not in the editor or the terminal.

### 9.5. Build and run on the interface side

1. "Build" sends `POST /v1/build`. While waiting, the progress and elapsed time are shown; the previous simulation keeps running. "Run" on a project that is not built or is changed since the build first runs the same build and, on success, starts the simulation.
2. On `failed` the "Messages" tab opens, and the editor jumps to the first error. The previous simulation stays.
3. On `ok` the previous Worker is terminated, a new one is created, and the steps of section 4.7 run. If the simulation was running before the build, the new one starts by itself.
4. Changing the binding, the parts or a part's settings without changing the design sends `configure` or `partSettings` without a build.
5. When a file is saved (and every 2 s of idle time during editing), `POST /v1/check` runs; the marks in the editor update without a build.

### 9.6. Waveforms

- Sources: the core recording (`recordFetch`) and the testbench VCD file. Both are brought to one in-memory model: a list of signals and sorted changes.
- Drawing on Canvas: single-bit signals as a line, buses as hexagons with a value. When zoomed far out, spans with frequent toggles are filled in.
- Actions: zoom with the wheel and keys, pan by dragging, two cursors with the time difference and the frequency, radix choice, reordering and deleting rows, "Fit all".
- Recording control: signal choice, mode, depth, trigger condition, "Record", "Stop".
- VCD export: the interface creates the file from the in-memory model; the time step is 1 ps. Parsing the testbench VCD is a module of its own, `web/src/wave/vcd.ts`. The VCD scopes are parts of the signal path; a board pin `pin:N` is written as the variable `pinN` in the scope `pins` (decision 84).
- A testbench waveform (decision 92): the "Show waveform" button loads the VCD file and takes over the panel. The panel rows are the signals of the file itself (the first 100); reordering and deleting them works until the waveform is closed and is not written to `fpgasim.json`. There are no recording controls in this view; the "Back to simulator recording" button returns the panel to the core recording. The core recording meanwhile goes on as usual.
- The panel rows are the list `record.signals` from `fpgasim.json`. While recording runs, the waveform updates while paused, after a step, and once a second if there are at most 100,000 changes; when recording ends, always (decision 85).
- FST and embedding Surfer are not part of version 1; checking whether it is possible is an optional task of stage 8.

### 9.7. Tools for automatic checks

In the development build and with the parameter `?debug=1`, the object `window.__fpgasim` is available:

| Method | Returns |
|---|---|
| `state()` | Simulation state, time, clock cycle, speed ratio |
| `net(pin)` | Level, toggles since the start, last fraction at one |
| `part(id)` | Part state (brightness, colors, terminal bytes) |
| `partEvents(id)` | Part events (`partEvent`) since the start of the simulation |
| `diagnostics()` | The list of messages of the last build |
| `signals()` | Signals of the loaded core (the `signals` reply) |
| `watch()` | The watch list with values from the last frame |
| `record()` | The core recording state and the refusal of the last "Record" |
| `wave()` | The in-memory waveform: span, number of changes, signals |
| `waveChanges(name)` | Changes of a waveform signal: time and value |
| `waveView()` | The view window, cursors and rows of the waveform panel |
| `vcd()` | The VCD text that the panel exports |
| `testbench()` | The testbench files, the chosen file and the last run: state, exit code, output, messages, VCD path |
| `fileRoles()` | The file with the top module and the testbenches from the last server response |
| `files()` | Saved files of the open project: path and text |
| `changedFiles()` | Paths of changed files (decision 98) |
| `project()` | Name and kind of the open project: `browser` or `folder`; for a view-only copy, the `view` field with the owner's login |
| `board()` | The identifier of the open project's board |
| `examples()` | The "From example" list in order: name and the author's lesson flag |
| `help()` | A brief help summary: whether it is open, the number of sections and the number of screenshots |
| `folder()` | A project in a folder: access, the rebuild switch, the number of scans and scans with changes |
| `transfer()` | The report of the last file transfer: what was not taken and why, a refusal as a whole |
| `bottomTab()` | The selected tab of the bottom panel |
| `assistant()` | The assistant's conversation: question, answer, tools used, tokens, error |
| `pins()` | Pins of the board drawing: number, status, level, point on the drawing |
| `parts()` | Project parts: name, type, pins, origin (board or breadboard), whether enabled |
| `binding()` | The binding in effect: source, `.cst` file, table rows and pins |
| `file(path)` | The saved text of a project file or `null` |
| `messages()` | Rows of the messages panel |
| `layout()` | Sizes and collapsed state of the workspace areas |
| `editor()` | The editor state: the open file and unsaved files |
| `command(msg)` | Sends a control message to the core |
| `account()` | Sign-in: kind (`none`, `key`, `session`), login, name, role, the "session ended" flag |
| `sync()` | Synchronization of the open project: state, refusal text, revision, unsent files, files with a discrepancy; `null` without synchronization |
| `syncNow()` | Starts synchronization of the list and the open project; the promise completes after the response is parsed |
| `projects()` | The list of the projects screen: identifier, name, kind, synchronization state |
| `busyProject()` | The name of the project that did not open because it is open in another tab |
| `users()` | Rows of the table of the "Users" page; empty if the page is not open |

The account and synchronization methods are in section 5.7 of `docs/tz-accounts.md`, decisions 133 and 141.

The exact fields of the methods are in `web/src/debug/api.ts`.

End-to-end tests check behavior by this data, not by Canvas pixels.

## 10. Deployment

### 10.1. Static files

- The Cloudflare Pages project `fpga-sim`, its own domain `fpga-sim.scriptorium.cc`.
- Deployment: `make deploy-web` (a Vite build and `wrangler pages deploy web/dist --project-name fpga-sim`).
- The static files include the board files, the part descriptions, the message table and the examples.
- The file `web/public/_headers` sets the content security policy: scripts only from itself plus `'wasm-unsafe-eval'` and `blob:` (for the core module and the Worker), connections only to its own address and the build server. The file holds the mark `__BUILD_URL__`; the build writes `VITE_BUILD_URL` in its place (decision 173).
- The build server address is set by the variable `VITE_BUILD_URL`; for development it is `http://localhost:8080`.

### 10.2. Server

- A Hetzner CX33 VPS, Ubuntu LTS, Docker with Compose.
- DNS: an `A` record `fpga-build` pointing to the VPS address. TLS is held by the VPS system nginx (decision 31); the author chooses the certificate kind and the DNS record mode (`docs/deploy-server.md`).
- Folders: `/opt/fpgasim` (a copy of the repository for building images), `/etc/fpgasim` (settings and keys), `/var/lib/fpgasim/cache`, `/var/lib/fpgasim/jobs`, `/var/lib/fpgasim/testbench`, `/var/lib/fpgasim/deploy`, `/var/lib/fpgasim/bench`, `/var/lib/fpgasim/accounts`, `/var/lib/fpgasim/backup` (the purpose is in `docs/deploy-server.md`).
- Open ports: 22, 80, 443.
- The build image is built on the VPS itself: the author's Mac has a different processor architecture, and the project build time must be measured where it will be in use. The Dockerfile must also build on a Mac, for development and tests.
- Deployment: `make deploy-server`. The script `deploy/deploy.sh` sends the repository over SSH (the SSH host `VPS` of the site settings, decision 173; `fpga-build` in the author's deployment), builds the images, restarts Compose and checks `/v1/health`.
- Rollback: the image tags are kept for the two previous deployments; `deploy/rollback.sh` returns the previous one.
- Backups: once a day the service writes a copy of the accounts database to `/var/lib/fpgasim/backup` and keeps the last 14; the daily copy goes to Cloudflare R2 (`deploy/offsite-r2.sh`), and `make backup-accounts` fetches the last copy to the author's Mac; restore is `fpgasim-admin db restore` (`docs/tz-accounts.md`, sections 2.5 and 3.8; the procedure is in `docs/deploy-server.md`). The cache and keys have no copies: the cache can be rebuilt, and keys are issued anew.
- Other services of the author may run on the VPS. The deployment scripts touch only the listed folders, their own Compose project and their own images.

### 10.3. What the author does by hand

1. Creates the two DNS records and the Cloudflare Pages project (or runs `wrangler login`, after which the agent creates the project).
2. Adds the `fpga-build` host to the SSH settings and checks the login.
3. Creates a private GitHub repository and gives the agent access.
4. After the first server deployment, creates his own administrator account with the command `fpgasim-admin user add taras --name Taras --admin` (section 3.8 of `docs/tz-accounts.md`). He creates the other accounts on the "Users" page. Keys are issued with the command `fpgasim-admin key add <name>` for scripts: acceptance tests and measurements (`docs/deploy-web.md`).

## 11. Verification

### 11.1. Kinds of tests

| Kind | Where | Tool | What it checks |
|---|---|---|---|
| Core unit tests | Container, regular build | Catch2 | Time, nets, statistics, parts, recording, protocol |
| Reference binary messages | Core and interface | Files `spec/protocol/vectors/` | Byte-for-byte match of the encoding in C++ and TypeScript |
| Examples without a browser | Node | `tools/headless/run.mjs` | The built core passes the example's `expect.json` |
| Server tests | Container and Docker | pytest | Operations, parsing, cache, limits, keys |
| Interface unit tests | Node | Vitest | Storage, VCD parsing, dictionary, panel logic |
| End-to-end tests | Chromium | Playwright | User scenarios through `window.__fpgasim` |
| Measurement | VPS and Mac | `tools/bench/` | Speed and build time |

### 11.2. Example expectations

Each example has an `expect.json`:

```json
{
  "build": { "status": "ok", "codes": [] },
  "run": { "ps": "2100000000000" },
  "actions": [],
  "nets": { "15": { "toggles": 4 }, "16": { "toggles": 8 }, "17": { "toggles": 16 } },
  "parts": {},
  "notices": []
}
```

- `build.codes`: the message codes that must appear (for example, `BLKSEQ`).
- `actions`: commands to parts at set moments: `{ "atPs": "1000000000", "part": "s1", "cmd": "press" }`; the optional field `args` holds the command arguments.
- `nets`: exact or bound values (`toggles`, `togglesMin`, `level`, `dutyMin`, `dutyMax`).
- `parts`: expectations for parts, part name → object. Fields: `text` (the bytes received by the UART terminal, as a string: one character per byte), `bytes` (the same bytes as an array of numbers), `colors` (WS2812 colors as `"#rrggbb"` strings), `errors` (the WS2812 error counter), `events` (part events: a name or `{ "event": "timingError", "data": { "highNs": { "min": 500, "max": 550 }, "bit": 0 } }`; a number in `data` is compared exactly, `min` and `max` set bounds). The set of part event names must match the list; without the `events` field there must be no events.

The same file is executed by both the run without a browser and the end-to-end test.

### 11.3. Commands

| Command | Action |
|---|---|
| `make image` | Builds the build image on this machine |
| `make dev` | Starts the server on `localhost:8080` and Vite on `localhost:5173` |
| `make test-core`, `test-server`, `test-web` | Component tests |
| `make test-examples` | Builds all examples through the local server and runs `expect.json` in Node |
| `make e2e` | End-to-end tests on the local setup |
| `make check` | Style and type checks and all the tests above. Must pass before every stage is completed |
| `make bench` | Measurement; writes `bench/results.json` |
| `make deploy-server`, `deploy-web` | Deployment |
| `make e2e-prod` | End-to-end tests against the production URLs (needs a key in an environment variable) |

## 12. Work plan

General rules:

- The stages go in order. Stages 6–10, once stage 5 is complete, do not depend on one another and can be done by different agents in separate branches.
- A stage is complete when all acceptance criteria are met, `make check` passes, an entry is added to `docs/progress.md` (what was done, what was deferred, which decisions were made) and the changes are committed to Git.
- The agent checks the acceptance criteria itself. The "for the author" items are a short manual check after the stage; they do not block the next one.

### Stage 0. Measuring speed and build time

**What is done.**

1. The initial Dockerfile: Verilator and Emscripten with pinned versions.
2. The example `examples/blink3`.
3. The test bench `tools/bench/`: a simplified loop per section 7.2 (clock, output check, toggle count) without the rest of the runtime. Built to native code and to WebAssembly.
4. Measuring speed (millions of clock cycles per second) for these combinations: `all` and `ports` mode; `-O1`, `-O2`, `-O3`. Environments: native code on the VPS and on the Mac, WebAssembly in Node on the Mac, WebAssembly in Chrome on the Mac (Playwright; the same page `tools/bench/bench.html` can also be opened by hand).
5. Measuring build time on the VPS by step (Verilator, compile, link) in two variants: the Verilator support files are compiled every time or taken from a ready library. Additionally: with a precompiled header.
6. Checking the assumptions from section 15 marked with stage 0.

**Output.** `docs/stage0-report.md` with tables and a conclusion; `bench/results.json`; entries in `docs/decisions.md`: the optimization level, the default visibility mode, the library contents, the tool versions in `server/docker/versions.env`.

**Acceptance criteria.**

- `make bench` finishes successfully and creates `bench/results.json` with all combinations.
- In every run, in 2.1 s of simulation time, 4, 8 and 16 toggles are obtained on the three outputs.
- The report contains a conclusion by the rule. Speed in Chrome on the Mac in the chosen mode: at least 27 million clock cycles per second, work continues; from 8.1 to 27, work continues and the discrepancy is recorded in the decisions; below 8.1, the agent stops and informs the author.
- Cold build time of `blink3` on the VPS with a ready library: at most 15 s is accepted; from 15 to 30 s is accepted with an entry in the decisions; more than 30 s, stop and inform the author.
- For each assumption of section 15 for stage 0, the report says "confirmed" or describes a replacement.

**For the author.** Open `bench.html` in his own Chrome and compare the number with the report.

### Stage 1. Repository skeleton and formats

**What is done.** The structure of section 13; `CLAUDE.md`; the schemas in `spec/` (project, board, part, protocol messages); `boards/tang-nano-20k.json`; the descriptions of five parts; `Makefile`; the style check settings (clang-format, ruff, ESLint, Prettier); a copy of the spec in `docs/tz-v1.md`.

**Output.** A repository in which `make check` passes on empty components.

**Acceptance criteria.**

- The board file and the part descriptions pass validation against the schemas.
- For each schema there are at least three invalid samples in `spec/tests/`, and validation rejects them.
- The `fpgasim.json` examples from section 2 pass validation.
- `make check` passes on the Mac.

### Stage 2. The core on a regular machine

**What is done.** The runtime per section 5; the common part of the Verilator engine and the shim template (at this stage the shim is created by the script `tools/mkshim.py`, which later moves into the server); the protocol; the parts `led`, `button`, `switch`, `probe`; the example runner for the native build.

**Output.** The library `fpgasim_rt`, tests; the examples `blink3` and `buttons` pass `expect.json` in the native build.

**Acceptance criteria.**

- Time test: half-cycle number 54,000,000 at 27 MHz starts exactly at 10^12 ps; two clocks of 27 and 25.175 MHz give the correct edge order on a 1 ms span.
- `blink3`: 4, 8 and 16 toggles in 2.1 s; the fraction of time at one on pin 15 over a whole number of periods is 0.5 ± 0.001.
- `buttons`: the commands `press` and `release` change the output levels; in the variant without a pull, `INPUT_FLOATING` arrives.
- A conflict of two parts on one net gives `NET_CONFLICT`.
- Bounce: with `bounceMs = 5`, after a press the net has more than two toggles, and all of them fit within 5 ms; two runs give the same sequence.
- The encoding of FRAME, TRACE and PART_DATA matches the reference files byte for byte.
- Each command of section 4.2 has a test for success and for refusal.

### Stage 3. Build server

**What is done.** The build image with the library; the service with the operations `health`, `info`, `check`, `build`, `artifacts`; auto-detection and `.cst` parsing; shim creation; parsing Verilator messages; the cache; keys and `fpgasim-admin`; limits; the log; running the core in Node (`tools/headless/`); the first deployment to the VPS.

**Output.** A working `https://fpga-build.scriptorium.cc`; `make test-examples` passes.

**Acceptance criteria.**

- `blink3` and `buttons` build; the built core passes `expect.json` in Node.
- A repeated build answers with `cached: true` faster than 300 ms. Changing the `.cst` does not change `buildId`.
- For each code from sections 2.5, 2.6 and 7.6 (`TOP_AMBIGUOUS`, `TOP_NOT_FOUND`, `CST_*`, `PORT_UNBOUND`, `PINS_IGNORED`, `PIN_FORBIDDEN`, `GOWIN_PRIMITIVE_UNSUPPORTED`, `MODULE_NOT_FOUND`, `BUILD_TIMEOUT`) there is a project in `server/tests/projects/` and a test that gets exactly this code.
- A syntax error is returned with the correct file, line and column.
- A test confirms that the job container has no network and that writing outside `/work` and `/tmp` is impossible.
- A request without a key gets 401, with a disabled key 401, a project over 2 MB 413.
- Three simultaneous builds of different projects finish successfully (the third waits in the queue).
- `curl https://fpga-build.scriptorium.cc/v1/health` answers `ok`; a cold build of `blink3` on the VPS fits the time accepted at stage 0, with a margin of no more than 20%.

### Stage 4. Interface skeleton and running in the browser

**What is done.** The Vite application; the projects screen; storage; the editor with highlighting; the server client; key entry; the host in a Web Worker; protocol encoding in TypeScript; build and run; the "Messages" tab; a temporary net table in place of the board; `window.__fpgasim`.

**Output.** In the browser one can create a project from an example, build it, run it and see the changing levels.

**Acceptance criteria (end-to-end tests on the local setup).**

- A project from the `blink3` example builds and runs; after 3 s of real time `net(15).toggles` is at least 4, and the speed ratio is not below the one accepted at stage 0 minus 20%.
- An error in the code: status `failed`, a mark on the correct editor line, a click on the message moves the cursor.
- Reloading the page keeps the project and the unsaved edit.
- Encoding and parsing of binary messages in TypeScript matches the reference files.
- Without a key the key entry is shown; a wrong key is rejected with an explanation.

### Stage 5. Board, LEDs, buttons, time control

**What is done.** The board drawing from the file; the widgets `led`, `button`; the top bar (run, pause, step, reset, speed, ratio); the workspace layout; the message table with translations and explanations; warning marks; the check on save; the limitations dialog; the examples `pwm_fade` and `shift_chain`.

**Output.** A version fit for lessons with LEDs and buttons when a `.cst` exists.

**Acceptance criteria.**

- `buttons`: the key "1" changes `part("led0")`; releasing returns it.
- `pwm_fade`: the measured brightness at the control moments differs from the calculated one by no more than 0.05.
- A step of 1 clock increases the clock cycle number by exactly 1; the "until output changes" step in `blink3` stops at the first toggle of the fastest counter, near clock cycle 3,375,000 (the agent computes the exact number from the example code and writes it into the test).
- Multiplier 0.1: in 5 s of real time, 0.5 s of simulation time passes ± 5%.
- Reset returns the time and the clock cycle number to zero.
- `shift_chain`: the message `BLKSEQ` is shown with the Russian text on the correct line; the build succeeds meanwhile.
- All codes from the table of section 7.6 have a short text and an explanation in `spec/diagnostics.json` (checked by a test).
- The interface has no strings bypassing the dictionary (the style check finds Cyrillic in component files).

**For the author.** Read over the explanations of the warnings; judge how recognizable the board is.

### Stage 6. Breadboard and pin binding

**What is done.** The breadboard field; the "Add part" dialog with an automatic settings form; the binding dialog; export to `.cst`; the switch; the probe; changes to the built-in parts (`boardParts`); the example `debounce`.

**Acceptance criteria.**

- A project without a `.cst`: after binding in the dialog the simulation starts, and the build request counter does not change.
- An exported `.cst` gives the same `resolved.pins` on a repeated build.
- An external LED on pin 73 lights by the port level; two ports cannot be bound to one pin.
- `debounce`: with `bounceMs = 5`, the counter without debouncing increases by more than 1 per press, with debouncing by exactly 1.
- Binding to pins 59–62 shows a warning.

### Stage 7. UART and WS2812

**What is done.** The parts `uart` and `ws2812` in the core, the widgets, the terminal tab, the examples `uart_hello`, `uart_echo`, `ws2812_rainbow`, `ws2812_badtiming`.

**Acceptance criteria.**

- `uart_hello`: the terminal receives the expected string in full.
- `uart_echo`: 256 different bytes come back without loss and in the same order.
- A part speed of 9600 with a design at 115,200 gives the event `baudMismatch` with an estimate within 5% of 115,200.
- `ws2812_rainbow`: the colors of the eight LEDs at the control moment match the calculated ones.
- `ws2812_badtiming`: `timingError` arrives with the measured duration.
- The speed on `uart_hello` with an idle line differs from `blink3` by no more than 20%.

### Stage 8. Signals and waveforms

**What is done.** The signal tree; the watch list; recording (both modes, the trigger condition); the waveform panel; VCD export. Optional: an evaluation of embedding Surfer, with the conclusion written to `docs/decisions.md`.

**Acceptance criteria.**

- The `blink3` tree has `top.cnt_a`, `top.cnt_b`, `top.cnt_c`, `top.q`; in `ports` mode only the ports.
- The value of `top.cnt_a` in the watch after a step of 1000 clock cycles from the start equals 1000.
- A recording in `window` mode with a condition on the edge of `pin:15` starts at the moment of the edge, accurate to one half-cycle.
- A ring of 1000 changes after 10,000 changes contains the last 1000, and the values at the span start are correct.
- The exported VCD is read by a third-party parser (a Python library in the test container) and by our own; the number of changes matches the recording.
- `shift_chain`: in the recording the `<=` variant shifts the value by one bit per clock cycle, and the `=` variant shifts it through all bits in one clock cycle.

### Stage 9. Testbench

**What is done.** The `testbench` operation on the server; the "Testbench" tab; showing VCD in the waveform panel; testbenches for `blink3` and `shift_chain`.

**Acceptance criteria.**

- The example's testbench returns the expected text and `exitCode: 0`; the waveform opens and has at least three signals.
- A testbench with an infinite loop gets `timeout` within 25 s at most.
- A testbench compile error is shown with the file and line.
- Output over 256 KB is truncated, `truncated: true`.
- The testbench file does not get into the simulator build (`resolved.files`).

### Stage 10. Folder on disk and archives

**What is done.** Opening a folder; polling for changes; rebuild on change; asking for permission again; loading and exporting an archive; exporting changed files.

**Acceptance criteria.**

- An end-to-end test replaces `showDirectoryPicker` with a folder from the browser's private storage (`navigator.storage.getDirectory()`): changing a file in it triggers a rebuild within 3 s at most.
- `fpgasim.json` is written to the folder after the settings change.
- An archive exported and loaded back gives a project with the same files, byte for byte.
- When `showDirectoryPicker` is missing, the item is disabled and an explanation is shown.

**For the author.** Open a real lesson folder, edit a file in VS Code and confirm the rebuild.

### Stage 11. Deployment and acceptance of version 1

**What is done.** Deploying the static files to `fpga-sim.scriptorium.cc`; the content security policy; copying `~/fpga/lessonNN_*` (lessons 2–10) into `examples/lessons/` and writing `expect.json` from the comment at the start of each `top.v`; a brief help page; issuing keys to students; the final report `docs/v1-report.md`.

**Acceptance criteria.**

- `make e2e-prod` passes against the production URLs.
- Each lesson 2–10 builds without `fpgasim.json` and passes its `expect.json`. If a lesson's behavior cannot be checked with the version 1 parts, this is recorded in the report with the reason.
- Four simultaneous sessions (Playwright) build and run different projects without errors.
- The report contains the speed and the build time for each lesson.

**For the author.** Go through lessons 2–10 in the application; check how it works on a student's laptop.

## 13. Repository structure

```
fpga-sim/
├── CLAUDE.md
├── AGENTS.md                     pointer to CLAUDE.md for other agents
├── README.md
├── Makefile
├── ruff.toml
├── bench/                        results.json: the result of the stage 0 measurements
├── docs/
│   ├── tz-v1.md                  copy of this spec
│   ├── tz-accounts.md            addendum: accounts and projects on the server
│   ├── vision.md                 copy of the vision document
│   ├── decisions.md              decisions made along the way, with date and reason
│   ├── progress.md               stage log
│   ├── stage0-report.md
│   ├── v1-report.md              final report of version 1
│   ├── deploy-server.md          deploying the build server, the database and its copies
│   └── deploy-web.md             deploying the static files, users, acceptance tests
├── spec/
│   ├── fpgasim.schema.json
│   ├── board.schema.json
│   ├── part.schema.json
│   ├── diagnostics.json          message codes: level, text, explanation
│   ├── gowin-primitives.txt
│   ├── protocol/                 message schemas and vectors/
│   └── tests/                    valid and invalid samples
├── boards/
│   ├── tang-nano-20k.json
│   └── tang-nano-9k.json
├── parts/
│   ├── led/part.json
│   ├── button/part.json
│   ├── switch/part.json
│   ├── uart/part.json
│   ├── ws2812/part.json
│   └── probe/part.json
├── core/
│   ├── CMakeLists.txt
│   ├── VERSION
│   ├── include/fpgasim/          part.h, engine.h, engine_verilator.h, protocol.h, runtime.h, clock.h, json.h, bytes.h
│   ├── src/runtime/              scheduler, nets, recording, protocol
│   ├── src/parts/                led.cpp (and the probe), button.cpp (and the switch), uart.cpp, ws2812.cpp, builtin.cpp, parts.h
│   ├── src/native/               running an example in the native build
│   ├── src/wasm/                 the fs_* boundary and host.js
│   └── tests/
├── server/
│   ├── pyproject.toml
│   ├── fpgasim_server/           api, resolve, cst, cache, keys, jobs, diagnostics, config, admin,
│   │                             accounts (records, sessions), projects (projects, trash, database copies)
│   ├── job/                      the job script inside the container
│   ├── templates/shim.cpp.j2
│   ├── docker/                   Dockerfile.tools, Dockerfile.build, Dockerfile.api, versions.env
│   └── tests/                    tests and projects/
├── web/
│   ├── package.json
│   ├── public/_headers
│   └── src/
│       ├── app/                  screens and layout, sign-in, account menu, "Users"
│       ├── editor/
│       ├── project/              storage, folder, archives, synchronization with the server (sync.ts)
│       ├── build/                server client, storage of the key and the session token
│       ├── sim/                  host, Worker, protocol
│       ├── board/                drawing the board and the breadboard
│       ├── parts/                part widgets
│       ├── wave/                 waveforms, VCD
│       ├── i18n/                 ru.json
│       └── debug/                window.__fpgasim
├── examples/
│   ├── blink3/  buttons/  buttons_nopull/  shift_chain/  pwm_fade/  debounce/
│   ├── uart_hello/  uart_echo/  ws2812_rainbow/  ws2812_badtiming/
│   └── lessons/                  copies of lessons 2–10 (stage 11)
├── tools/
│   ├── bench/
│   ├── dev/                      the local build server and `make dev`
│   ├── headless/
│   ├── lessons/                  moving the author's lessons into `examples/lessons/`
│   ├── wave/                     reading VCD for end-to-end tests
│   ├── native/                   running examples in the native build (stage 2)
│   ├── spec/                     checking the formats and the reference messages
│   └── mkshim.py
├── e2e/                          Playwright tests
└── deploy/
    ├── compose.yaml
    ├── nginx-build.conf.example
    ├── remote.sh                 the part of deployment that runs on the VPS itself
    ├── fpgasim-admin             wrapper of the key and account utility for the VPS
    ├── backup-accounts.sh        make backup-accounts: the last database copy from the VPS to .fpgasim/backup/
    ├── deploy.sh
    ├── deploy-web.sh
    └── rollback.sh
```

## 14. Contents of `CLAUDE.md`

The file is placed in the repository root verbatim.

```markdown
# FPGA SIM

A web simulator for Verilog projects for the Sipeed Tang Nano 20K and Tang Nano 9K boards.
The build runs on the server (Verilator → WebAssembly), the computation runs in the browser.

## Main documents

- `docs/tz-v1.md` — the specification. This is the source of truth.
- `docs/tz-accounts.md` — an addendum to the spec: accounts and projects on the server.
- `docs/vision.md` — the vision and architecture. The decisions there are not revisited.
- `docs/decisions.md` — decisions made along the way. Read it before starting work.
- `docs/progress.md` — the stage log. The first section says where we are now.

## How to work

Version 1 is complete: the stages of section 12 of the spec are done. Further work follows the author's tasks.

1. Read the first sections of `docs/progress.md`: where we are now, the next tasks, what is open.
2. Do only the task the author named. Record what you find along the way in the "Open" section
   of the same file, not in the change.
3. A task is complete when `make check` passes and the visible behavior is checked in the browser.
4. At the end, add an entry to the "After acceptance" section of `docs/progress.md`: what was done,
   what was deferred and why.
5. Record every decision that is not in the spec in `docs/decisions.md`
   with a date and a reason.
6. A change to `web/`, `examples/`, `boards/`, `parts/` or `spec/` takes effect at the production URL after
   `make deploy-web`; a change to `core/` or `server/` takes effect after `make deploy-server`. A change to `boards/`
   needs both deployments: both the interface and the server read the board file (it is part of the image). A change to
   `core/` requires changing `core/VERSION`: otherwise the server serves from the build cache with the old core.
   After deployment, run `make e2e-prod`. Deployment, merge and push only on the author's command.

## What not to do

- Change the formats (`fpgasim.json`, the board file, the part description, the protocol)
  without editing the schemas in `spec/` and the spec section in `docs/tz-v1.md`.
- Weaken or delete a test to make it pass. If an acceptance criterion
  cannot be met, stop and describe the reason in `docs/progress.md`.
- Reach into Verilog parsing from the interface: everything about the design comes from the server and the core.
- Call the engine or another part from a part: only through nets.
- Write interface strings in component code: only through `web/src/i18n/ru.json`.
- Keep keys, addresses with keys and the contents of `/etc/fpgasim` in the repository.
- Touch anything on the VPS except `/opt/fpgasim`, `/etc/fpgasim`,
  `/var/lib/fpgasim`, your own Compose project and your own images.
- Ask the author for lesson texts. The lesson code is in `~/fpga/lessonNN_*`,
  and the expected behavior is described in the comment at the start of `top.v`.

## The "verify" items

Section 15 of the spec lists the assumptions. If an assumption of your task
is not confirmed, do not bypass it silently: describe the discrepancy in `docs/decisions.md`,
propose a replacement and continue only if the replacement does not change the formats and the protocol.
Otherwise stop and tell the author.

## Commands

- `make dev` — the server on localhost:8080 and the interface on localhost:5173
- `make check` — style, types and all tests; run it before finishing
- `make test-core` / `test-server` / `test-web` / `test-examples` / `e2e`
- `make bench` — measuring speed and build time
- `make deploy-server` / `deploy-web` — deployment (hosts from the site settings, `deploy/site.env.example`)

Do not install Verilator, Emscripten and Icarus on the Mac: all of them are in the build
image (`make image`), and the core and server tests run in the container.

## Style

- C++20, clang-format, no exceptions in the simulation loop, no memory
  allocation in the simulation loop.
- Python 3.12, ruff, type annotations, pytest.
- TypeScript in strict mode, ESLint, Prettier. Core frames are not put
  into React state.
- Interface look: Tailwind and shadcn components (`web/src/components/ui/`), shared elements are in
  `web/src/app/kit.tsx`. Colors are only theme variables from `web/src/styles.css` (in Canvas,
  `themeColor()`): a color literal breaks the dark theme. A choice list is `Choice`, not `<select>`
  (decision 111).
- Names in code are English. Comments, commit messages and documents are in Russian.
- Commit message: "area: what was done", for example "interface: …", "server: …",
  "documents: …". The commits of the version 1 stages were named "stage N: …".

## Checking in the browser

End-to-end tests read the state through `window.__fpgasim`, not by pixels.
A new visible element of behavior gets a method or a field in this object.
```

## 15. Open items and deferred work

### 15.1. Assumptions to verify

| No. | Assumption | Stage | Fallback |
|---|---|---|---|
| 1 | WebAssembly speed on `blink3` is at least 1× in Chrome on the Mac | 0 | `ports` mode by default; below 0.3×, revisit the architecture |
| 2 | A cold build takes no longer than 15 s on the CX33 | 0 | A precompiled header, `-O1`; longer than 30 s, a message to the author |
| 3 | The port list is reliably read from `Vtop.h` | 0 | Verilator's machine-readable output (`--json-only`) |
| 4 | Internal signals are enumerated through scope descriptions with `--public-flat-rw`, without VPI | 0 | VPI (`--vpi`) |
| 5 | The speed loss from `--public-flat-rw` allows keeping `all` mode as the default | 0 | The default `ports`, a "debug mode" by a button |
| 6 | The Verilator support files are built into a library in advance and fit any model of the same version | 0 | Compile on every build with a cache of object files |
| 7 | The stable Verilator release behaves on the examples the same as the author's 5.055 | 0 | Pin the same build as the author's |
| 8 | `$readmemh` works with embedded files with `-sFILESYSTEM=1` | 3 | Convert the data files into initial values on the server |
| 9 | Parsing Verilator messages by line covers all errors that have a place in the code | 3 | A message without a place is shown in the panel as a whole |
| 10 | The color of the built-in LEDs, the board dimensions and the element positions | 5 | Edit the board file |
| 11 | Polling the file modification time once a second is enough for a lesson folder | 10 | `FileSystemObserver` where it exists |
| 12 | The web version of Surfer can be embedded in place of our own panel | 8, optional | Our own panel remains the main one |

Items for version 2: the polarity of the HDMI pairs, the license and completeness of the Yosys models for Gowin primitives, the SDRAM pins (version 3).

### 15.2. What is deferred and where room is left

| Deferred | Version | Extension point |
|---|---|---|
| Several clocks, `rPLL` | 2 | The list of clock sources in the scheduler; `clocks` in the board file and `clock` in `configure` become arrays |
| Gowin primitives | 2 | A folder of models that the server adds to the file list; `spec/gowin-primitives.txt` |
| Display, sound, seven-segment indicator | 2 | New parts; PART_DATA for frames and sound |
| Tang Nano 9K | Done 2026-11-20 on the author's command | The file `boards/tang-nano-9k.json`, section 3.3, decisions 161–163 |
| Synthesis check | 2 | The server operation `synth`, Yosys in the image |
| Bidirectional pins | 3 | `PortDir::InOut` and the net rules |
| Computation on the VPS | 3 | The same protocol over WebSocket; the `fs_*` boundary is replaced |
| Accounts, projects on the server | Out of turn, from 2026-11-20 on the author's command | Done without a separate service: a SQLite database in the `api` service; keys remain for scripts. Description: `docs/tz-accounts.md`, decisions 117–160; the stage progress is in `docs/progress.md` |
| Latvian language | when ready | A third dictionary and a third language in `spec/diagnostics.json`, part descriptions and board texts (English is done, decision 168) |
