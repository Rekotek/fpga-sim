# FPGA SIM: vision and architecture

Version 3 of 2026-11-18, refined on 2026-11-19 after version 1 (build container, risks 1 and 2, path to lessons). Basis for the detailed spec. Changes against version 2: added board data from the course reference site, clarified how warnings are shown. Items marked "verify" need checking before development starts.

## 1. Goal

A web application for interactive simulation of Verilog designs for Sipeed Tang Nano 20K boards (later Tang Nano 9K and others). The user creates a project, uploads or writes any code, sees the board, presses buttons, watches LEDs and peripherals, observes internal signals and waveforms, edits the code, and downloads the changed files.

The application is not tied to a specific course. The lessons of the FPGA course (2–15) serve as a set of test examples: a project made of `top.v` and `top.cst` must run without setup.

The simulator shows the logic of the design. It does not model timing or electrical effects, and the interface must say so plainly.

**Users.** The author, who experiments with arbitrary code, and up to four students at the same time.

## 2. Main scheme

- **Build on a VPS.** The server receives the sources, runs Verilator, and compiles the result to WebAssembly.
- **Computation in the browser.** The finished module runs in a Web Worker on the user's processor. The server does not run other people's simulation code.
- **Projects in the browser.** In version 1 the server stores nothing except the build cache.

Reason for the split: real-time simulation at 27 MHz takes a whole processor core, while a build takes a few seconds.

## 3. Project

A project consists of files and one settings file (`fpgasim.json`) that stores everything that does not follow from the code:

- The board.
- The list of design files, the top module, the values of its parameters.
- The binding of ports to pins, if there is no `.cst` file.
- The parts on the virtual breadboard and their settings (UART speed, number of LEDs in a strip).
- The list of watched signals.

**Auto-detection, so that a simple project works at once:**

- Top module: the one that nobody instantiates; if it is ambiguous, the user chooses.
- Testbenches are separated from the design (a module without ports, named `tb_*`) and do not go into the simulator build.
- The `.cst` file (Gowin format: `IO_LOC`, `IO_PORT` with `PULL_MODE`) gives the pin binding.
- Clock input: the port bound to the board's clock pin.

**If there is no `.cst`**, the binding is made in the interface: a port is connected to a pin or a device. The binding can be exported as `.cst`.

**Where the files are stored:**

- In browser storage, with export and import as an archive and as separate files.
- In a folder on disk, opened directly (Chrome and Edge). The code is then edited in VS Code, and the simulator rebuilds when the code changes. This mode is not available in Safari and Firefox.
- A built-in editor with Verilog highlighting for edits in place.

**Language:** Verilog-2005 and the part of SystemVerilog that Verilator accepts. VHDL is not supported.

## 4. Architecture

**Interface.** A single-page application in TypeScript, served as static files (Cloudflare Pages or Vercel). The board and widgets are drawn on a Canvas.

**Simulation core (C++ → WebAssembly).** It has two parts:

- A permanent runtime: time scheduler, peripheral models, trace recording, message exchange. It is built in advance into a library, so it is not compiled on every project build.
- The project model from Verilator and a small generated glue layer: port list, clocks, pin binding.

Peripheral models live in the core, not in the interface, because they need every clock cycle.

**Build server (VPS).** Python (FastAPI) and a container with Verilator, Emscripten, and Icarus. Yosys is added to the image in version 2, for synthesis checks. Operations:

- Build: files and settings → a WebAssembly module and a signal description, or a list of errors with file and line.
- Testbench run: Icarus in the container → text output and a waveform file.
- Build cache keyed by input hash, on the VPS disk.

Protection: access by key, limits on time, memory, and project size, a container without network. Durable Objects and R2 are not needed in version 1.

**Protocol.** One set of messages between the core and the interface: control in JSON, bulk data (frames, audio, traces) in binary form. The protocol does not depend on the transport. Today this is an exchange with a Web Worker; later the same core can run on the VPS and connect to the interface over WebSocket. With four users this is a realistic fallback for heavy projects.

## 5. Engine

- Verilator; version 5.055 is verified on the author's machine. On the server the version is pinned in the container.
- The engine interface is replaceable. Fallback: CXXRTL from Yosys.
- Warnings do not stop the build and are shown softly, next to the code line. Some of them are useful for learning: for example, the blocking `=` in a clocked `always` (the topic of lesson 5). The spec decides which warnings to show and how to translate them into plain language.
- Errors are shown with a jump to the line in the editor.
- Verilator works with two states (no X and Z). Bidirectional pins are supported in a limited way.
- Verilator accepts code that Yosys does not synthesize. So version 2 adds a synthesis check (`synth_gowin` on the server) with a resource report: the number of LUTs, ALUs, and flip-flops. The course relies on this report (comparing the number of flip-flops in lesson 5), so it is useful to students too.

## 6. Gowin primitives

Arbitrary code uses vendor primitives that Verilator does not know. The simulator ships its own library of models:

- Version 2: `rPLL` (the frequency is computed from the parameters, the scheduler emits the clock), `CLKDIV`, block memory (`SP`, `SDPB`, `pROM`) with `.hex` loading, `OSER10`, LVDS output buffers, `IOBUF`.
- Basis: models from Yosys (`techlibs/gowin/cells_sim.v`); verify the license and completeness.
- An unknown primitive gives a clear "not supported" message, not a compiler error.
- Encrypted cores from Gowin IDE cannot be simulated.

## 7. Time model

- Time is in picoseconds. The scheduler is designed for several clocks with non-multiple frequencies, although in version 1 there is one clock.
- Designs without a clock are recomputed when an input changes.
- Computation runs in chunks of one screen frame. Target: real time. The interface shows the actual ratio, for example "0.3×".
- Controls: run, pause, step by clock cycles, speed multiplier.
- For each output, a chunk reports the final level, the fraction of time at one, and the number of toggles. This turns PWM into brightness.

## 8. Boards and breadboard

A board is described by a file: pins, clock frequency, geometry, onboard devices, shared and forbidden pins. An onboard device is the same part from the common library, placed in advance on its pins. A new board is added as a file, with no code change.

The virtual breadboard lets the user connect any part from the library to any free pin.

`PULL_MODE` from `.cst` is modeled: the pull sets the level of a floating input.

The data source is below: the course reference site, pages https://fpga-helper.vercel.app/board/pinout and https://fpga-helper.vercel.app/board/tang-nano-9k. The author confirmed the 20K data for the clock, LEDs, and buttons on the board.

### Tang Nano 20K (GW2AR-LV18QN88C8/I7)

| Device | Pins | Note |
|---|---|---|
| Clock 27 MHz | 4 | — |
| LEDs LED0–LED5 | 15, 16, 17, 18, 19, 20 | Light at 0; 17–20 are shared with joystick 2 |
| Buttons S1, S2 | 88, 87 | Pressed = 1, needs `PULL_MODE=DOWN` |
| UART (BL616) | 69 — output from the FPGA, 70 — input to the FPGA | 115,200 by default |
| WS2812 | 79 | — |
| HDMI | CLK 33/34, D0 35/36, D1 37/38, D2 39/40 | Which pin of a pair is positive: verify against the schematic; shared with RGB LCD |
| I2S (MAX98357A) | BCLK 56, LRCK 55, DIN 54, PA_EN 51 | — |
| TF card (SPI) | CLK 83, MOSI 82, MISO 84, CS 81 | — |
| MS5351 | 10, 11, 13 | Extra clocks |
| Firmware flash | 59–62 | Must not be used; the simulator warns |
| Free pins | 73, 74, 75, 76, 86; 71 and 72 without joystick 1 | For the breadboard |
| SDRAM | inside the package | Pins are not given on the site; needed by version 3 |

### Tang Nano 9K (GW1NR-LV9QN88PC6/I5), done 2026-11-20

| Device | Pins | Note |
|---|---|---|
| Clock 27 MHz | 52 | — |
| LEDs | 10, 11, 13, 14, 15, 16 | Light at 0 |
| Buttons S1, S2 | 3, 4 | Pressed = 0; a pull-up to 1.8 V is on the board, `PULL_MODE=UP` is optional |
| UART (BL702) | 17 — output from the FPGA, 18 — input to the FPGA | — |
| HDMI | 68–75 | — |
| Free 3.3 V pins | 25–30 | — |

The 9K has no WS2812 and no I2S amplifier; PSRAM replaces SDRAM. The buttons, LEDs, and pins 79–86 are in the 1.8 V bank (`LVCMOS18`); the full list is in section 3.3 of `docs/tz-v1.md`. The different button polarity on the two boards confirms that the board file sets the polarity, not the simulator code.

## 9. Part library

The part interface is uniform: connection to pins, a call on change or clock, events to the outside, a widget in the interface, a set of settings.

| Part | Version | Note |
|---|---|---|
| LED | 1 | Brightness by time fraction, polarity is configurable |
| Button, switch | 1 | Key binding, bounce mode |
| UART | 1 | Terminal in a window, any pins, configurable speed |
| WS2812 | 1 | One LED or a strip; display of timing errors |
| Probe | 1 | A pin or an internal signal to the waveform panel |
| Seven-segment display | 2 | — |
| Screen (HDMI, VGA) | 2 | The picture is captured from RGB and sync pulses before the serializer; the resolution is found from the scan |
| I2S sound | 2 | At low speed the sound is buffered |
| OLED SSD1306, MPU-6050, SDRAM | 3 | Need bidirectional pins |

## 10. Signal debugging

- A tree of all project signals, including internal ones.
- A watch list with live values.
- Recording of selected signals: a window or a ring buffer, because continuous recording at 27 MHz is too large.
- A built-in waveform panel for the recorded window and export to VCD or FST.
- The option to embed the web version of Surfer instead of our own panel: verify.
- Testbench run: the user picks a file, the server runs it in Icarus, the interface shows the output and a waveform.

## 11. Version boundaries

| Version | Contents | Test examples |
|---|---|---|
| 1 | Projects, editor, opening a folder, build, Tang Nano 20K, one clock, breadboard, LEDs, buttons, PWM, bounce, UART, WS2812, time control, signal watching and recording, testbench run | Lessons 2–10 and arbitrary small designs |
| 2 | Library of Gowin primitives, several clocks, screen, sound, seven-segment display, Tang Nano 9K, synthesis check with a resource report | Lessons 11–15 |
| 3 | Bidirectional pins and I2C devices, SDRAM, accounts and projects on the server, viewing students' work, UART bridge for scripts on the computer, computation on the VPS for heavy projects | Lessons 16+ |

In version 2 the screen is allowed to run several times slower than real time.

Done ahead of their version, on the author's command: Tang Nano 9K (2026-11-20), accounts, projects on the server, and viewing students' work (2026-11-20). The rest of the table stays in its own versions; what is deferred and where room is left is in section 15.2 of `docs/tz-v1.md`.

## 12. Risks

1. **WebAssembly speed.** Measured (`docs/stage0-report.md`, `docs/v1-report.md`, section 3): on `blink3` 1.45× real time with internal signals and 1.95× without them; lessons 2–10 in "ports only" mode run from 1.7×. "Ports only" mode is accepted as the default.
2. **Build time.** Measured: a cold build of a lesson on the VPS takes 4.0–4.5 s. The runtime is built into a library in advance.
3. **Gowin primitives.** The size of the model library and the accuracy of `rPLL`.
4. **Screen.** Arbitrary code outputs HDMI in different ways; a reliable way to capture the picture before the serializer is needed.
5. **Bidirectional pins** in Verilator.
6. **Build server security** when accepting arbitrary code.
7. **Opening a folder on disk** does not work in all browsers.

## 13. Accepted decisions

- Web application: build on a VPS, computation in the browser.
- Projects are stored in the browser or in an opened folder; in version 1 the server stores nothing.
- A universal tool; the course lessons serve as test examples.
- Verilator engine, replaceable engine interface.
- Build server in Python.
- Peripherals as a part library; onboard devices of the board are the same parts.
- The protocol does not depend on the transport.
- Up to four simultaneous users; scaling is not planned for.
- Board data comes from the course reference site.

## 14. What the spec must define

- The format of `fpgasim.json` and of the board file.
- The format of protocol messages.
- The part interface in C++ and the way to build the runtime.
- The Verilator glue template, the Verilator and Emscripten flags, the set of warnings shown.
- Build server operations, the container, limits, the access method.
- The interface library (framework, code editor), screen layouts.
- Hosting: domain, static files, server.
- Work order and acceptance criteria. First step: measure speed and build time on lesson 4.

**Materials for verification.** Lesson texts need not be uploaded to the chat. The agents need only the code folders (`~/fpga/lessonNN_*`: `top.v`, `top.cst`, `tb_top.v`; copies of lessons 2–10 are in `examples/lessons/`) and the expected behavior from the comment at the start of `top.v`. Already analyzed: lessons 0 (buttons), 4 (blink), and 5 (flip-flop chain).
