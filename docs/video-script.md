# Demo video script

The video is for the hackathon judges. The interface is in English (`?lang=en`), and the speech is
in English. The on-screen actions are described in English, and the narrator text is given as it
is read.

## Cognizant video requirements

From the rules at `https://cognizant-agenticweb.devpost.com/rules` (page saved on 2026-11-22):

- shorter than two minutes: "Judges are not required to watch beyond two minutes";
- the frame shows the project running in the browser;
- the participant explains the project;
- the video is on YouTube, publicly accessible, and the link is in the submission form;
- no third-party trademarks and no music without permission;
- everything is in English.

The rules also require things the project does not have yet: an agentic site (an agent network
`.json` file, a `runtime` in the browser) and unrestricted access to the project for the judges. The
video for Cognizant shows the agentic part; this script does not include it and suits hackathons
without such a theme.

## Preparation

1. Sign in at `https://fpga-sim.scriptorium.cc/?lang=en`, light theme, window 1920×1080.
2. Delete extra items from the project list so the projects screen is clean.
3. Build `blink3` and `uart_hello` in advance: a repeat build from the cache is faster than the
   first.

## Shots

Total 1:50. The script was not run in a browser: the shot times are estimates; check them at a
rehearsal.

| # | Time | On screen | Narrator |
|---|---|---|---|
| 1 | 0:00–0:12 | Projects screen | FPGA SIM runs Verilog designs for the Tang Nano FPGA boards in the browser. No board, no vendor tools, nothing to install. |
| 2 | 0:12–0:32 | "From example" → `blink3`. "Run". LED0–LED2 blink at different rates | A project is plain Verilog and the Gowin pin file. The design is built on the server with Verilator into WebAssembly, and the simulation runs here, in the browser, at 27 megahertz. |
| 3 | 0:32–0:47 | "+ Part" → LED on the breadboard, pin 15. It blinks together with LED0 | Add parts on the breadboard: LEDs, buttons with contact bounce, switches, a UART, an LED strip. |
| 4 | 0:47–1:05 | "Waveforms" tab: "+ Signal", "Record", "Stop", "Fit all", cursor | Record any signal as a waveform, set a trigger, measure with cursors, export to VCD. |
| 5 | 1:05–1:17 | "Testbench" tab: "Run", the line `PASS: 8 checks` | Testbenches run on the server in Icarus Verilog. |
| 6 | 1:17–1:32 | In `top.v` line 13: `CLK_HZ / 2` → `CLK_HZ`. "Run": the project rebuilds, LED0 blinks twice as slowly | Change the code and run again. The board shows the result in seconds. |
| 7 | 1:32–1:42 | "From example" → `uart_hello`, "Run", the terminal shows `Hello, FPGA SIM!` | The UART terminal talks to the design, like the USB serial port on the real board. |
| 8 | 1:42–1:50 | Limits icon on the right of the status bar, the list of limits | It computes logic, not timing, and says so. Thirty-two lessons of an FPGA course are its acceptance tests. |

Shot 5 comes before the code edit: the testbench `blink3/tb_top.v` checks the `CLK_HZ / 2` divider
and fails after the edit in shot 6.

## After recording

- Put the video link in the Devpost form and in the README.
- The code and comments of the examples are in Russian (the author's choice). The comment at the
  start of `blink3/top.v` is visible in shot 2; to show an English comment instead, tell the agent
  before recording.
