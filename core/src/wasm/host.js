// Core imports on the host side (spec section 4.8). An Emscripten library: linked in
// at link time with the --js-library flag.
//
// The host passes handlers in the module factory parameters:
//   const core = await createModule({ onJson(text) { … }, onBinary(bytes) { … } });
// onBinary receives a copy of the bytes (a Uint8Array with its own buffer): core memory changes
// after the call returns, and the copy's buffer can be passed on with transfer of ownership.
addToLibrary({
  fs_emit_json__deps: ['$UTF8ToString'],
  fs_emit_json: (ptr, len) => {
    Module['onJson']?.(UTF8ToString(ptr, len));
  },

  fs_emit_binary: (ptr, len) => {
    Module['onBinary']?.(HEAPU8.slice(ptr, ptr + len));
  },

  fs_now_ms: () => performance.now(),
});
