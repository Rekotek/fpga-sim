// Core host in a Web Worker (spec section 4.8). Loads sim.mjs and sim.wasm from the bytes the page sent,
// and then only relays protocol messages: a JSON string goes to fs_json, an ArrayBuffer to
// fs_binary; core replies go to the page in the same form. Reference: tools/headless/core.mjs.
import type { LoadRequest, TransportMessage } from "./messages";

interface CoreModule {
  _fs_init(): void;
  _fs_alloc(size: number): number;
  _fs_free(ptr: number): void;
  _fs_json(ptr: number, size: number): void;
  _fs_binary(ptr: number, size: number): void;
  _fs_tick(nowMs: number): void;
  HEAPU8: Uint8Array;
}

interface ModuleOptions {
  instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance) => void): object;
  onJson(text: string): void;
  onBinary(bytes: Uint8Array<ArrayBuffer>): void;
}

type CreateModule = (options: ModuleOptions) => Promise<CoreModule>;

const TICK_MS = 16; // spec section 5.3
// A batch no shorter than this time (6 ms) counts as having used its budget: the core has more to compute.
const BUSY_MS = 6;
const scope = self as unknown as DedicatedWorkerGlobalScope;
const encoder = new TextEncoder();
let core: CoreModule | null = null;
let running = false; // running state: time-driven computing
let pumping = false; // the next batch is already scheduled without waiting for the timer
// A call without delay: nested setTimeout(0) calls have a delay of at least 4 ms.
const pump = new MessageChannel();

const report = (message: TransportMessage): void => {
  scope.postMessage(message);
};

// A message to the core is written into its memory at the address from fs_alloc. HEAPU8 is read after fs_alloc:
// when memory grows, the core replaces the view.
function pass(bytes: Uint8Array, call: (module: CoreModule, ptr: number, size: number) => void): void {
  if (!core) return;
  const ptr = core._fs_alloc(bytes.length);
  core.HEAPU8.set(bytes, ptr);
  call(core, ptr, bytes.length);
  core._fs_free(ptr);
}

async function load(mjs: ArrayBuffer, wasm: ArrayBuffer): Promise<void> {
  // sim.mjs is loaded as a module through a temporary URL (spec section 8.3).
  const url = URL.createObjectURL(new Blob([mjs], { type: "text/javascript" }));
  try {
    const loaded = (await import(/* @vite-ignore */ url)) as { default: CreateModule };
    const module = await loaded.default({
      // The wasmBinary parameter has no effect in Emscripten 7.0.0 (decision 32).
      instantiateWasm: (imports, done) => {
        void WebAssembly.instantiate(wasm, imports).then(
          (result) => {
            done(result.instance);
          },
          (e: unknown) => {
            report({ transport: "failed", text: String(e) });
          },
        );
        return {};
      },
      onJson: (text) => {
        if (text.includes('"t":"state"')) {
          const state = JSON.parse(text) as { t: string; run?: string };
          if (state.t === "state") running = state.run === "running";
        }
        scope.postMessage(text);
      },
      // The core returns a copy with its own buffer, and ownership passes to the page.
      onBinary: (bytes) => {
        scope.postMessage(bytes.buffer, [bytes.buffer]);
      },
    });
    module._fs_init();
    core = module;
    // Batches run on a timer every 16 ms. In the running state, while a batch uses its budget,
    // the next one is called right after incoming messages are handled (spec section 5.3, decisions 49
    // and 107). A batch uses its budget at the max multiplier and at a multiplier the core cannot keep up with:
    // on a timer alone it would compute 12 ms of 16 and fall behind where it could keep up.
    const tick = (): void => {
      const started = performance.now();
      module._fs_tick(started);
      pumping = running && performance.now() - started >= BUSY_MS;
      if (pumping) pump.port2.postMessage(0);
    };
    pump.port1.onmessage = tick;
    setInterval(() => {
      if (!pumping) tick();
    }, TICK_MS);
    report({ transport: "ready" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

scope.onmessage = (event: MessageEvent<string | ArrayBuffer | LoadRequest>) => {
  const data = event.data;
  if (typeof data === "string") {
    pass(encoder.encode(data), (m, ptr, size) => {
      m._fs_json(ptr, size);
    });
  } else if (data instanceof ArrayBuffer) {
    pass(new Uint8Array(data), (m, ptr, size) => {
      m._fs_binary(ptr, size);
    });
  } else {
    load(data.load.mjs, data.load.wasm).catch((e: unknown) => {
      report({ transport: "failed", text: String(e) });
    });
  }
};
