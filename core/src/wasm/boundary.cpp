// Boundary between the JavaScript host and the core in WebAssembly (spec section 4.8).
// A thin wrapper over the Runtime class: the fs_* exports and the host imports from host.js.
#include <emscripten/emscripten.h>

#include <cstdint>
#include <cstdlib>
#include <memory>
#include <span>
#include <string_view>

#include "fpgasim/runtime.h"

extern "C" {

// Imports: defined in host.js.
void fs_emit_json(const char* ptr, uint32_t len);
void fs_emit_binary(const uint8_t* ptr, uint32_t len);
double fs_now_ms();

}  // extern "C"

namespace {

class WasmHost final : public fpgasim::Host {
public:
    void emitJson(std::string_view text) override { fs_emit_json(text.data(), static_cast<uint32_t>(text.size())); }
    void emitBinary(std::span<const uint8_t> bytes) override {
        fs_emit_binary(bytes.data(), static_cast<uint32_t>(bytes.size()));
    }
    double nowMs() override { return fs_now_ms(); }
};

WasmHost gHost;
std::unique_ptr<fpgasim::Runtime> gRuntime;

}  // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE void fs_init() { gRuntime = std::make_unique<fpgasim::Runtime>(fpgasim::createEngine(), gHost); }

EMSCRIPTEN_KEEPALIVE void* fs_alloc(uint32_t n) { return std::malloc(n ? n : 1); }

EMSCRIPTEN_KEEPALIVE void fs_free(void* p) { std::free(p); }

EMSCRIPTEN_KEEPALIVE void fs_json(const char* ptr, uint32_t len) {
    if (gRuntime) gRuntime->json(std::string_view(ptr, len));
}

EMSCRIPTEN_KEEPALIVE void fs_binary(const uint8_t* ptr, uint32_t len) {
    if (gRuntime) gRuntime->binary(std::span<const uint8_t>(ptr, len));
}

EMSCRIPTEN_KEEPALIVE void fs_tick(double nowMs) {
    if (gRuntime) gRuntime->tick(nowMs);
}

}  // extern "C"
