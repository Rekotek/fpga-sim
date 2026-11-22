// The live project state for the assistant's tools (decision 175): the same readers as window.__fpgasim
// (spec section 9.7).
import { projectFiles } from "../app/actions";
import { useApp } from "../app/state";
import { api } from "../debug/fpgasim";
import { boardById } from "../project/assets";
import { projectParts } from "../project/config";
import type { ToolSource } from "./tools";

export function liveSource(): ToolSource {
  return {
    files: projectFiles,
    topFile: () => useApp.getState().topFile,
    testbenches: () => useApp.getState().testbenches,
    build: () => api.state().build,
    messages: () => api.messages(),
    notices: () =>
      useApp.getState().notices.map((n) => ({ code: n.code, text: n.text, net: n.net, part: n.part, time: n.time })),
    board: () => useApp.getState().project?.board ?? null,
    parts: () => {
      const app = useApp.getState();
      const board = boardById(app.project?.board ?? "");
      return board
        ? projectParts(board, app.config).map((p) => ({
            id: p.id,
            type: p.type,
            label: p.label,
            origin: p.origin,
            enabled: p.enabled,
            pins: p.pins,
            settings: p.settings,
          }))
        : [];
    },
    binding: () => api.binding(),
    pins: () => api.pins().map((p) => ({ pin: p.pin, state: p.state, level: p.level })),
    run: () => {
      const state = api.state();
      return { run: state.run, loaded: state.loaded, time: state.time };
    },
    wave: () => api.wave(),
    waveChanges: (name, from, count) => api.waveChanges(name, from, count),
    signals: () => api.signals(),
  };
}
