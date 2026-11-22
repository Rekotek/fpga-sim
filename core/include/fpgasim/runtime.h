// Runtime (spec section 5): scheduler, nets, part registry, recording, protocol.
// Independent of Emscripten: the fs_* boundary (spec section 4.8) is a thin wrapper over this class.
#pragma once

#include <cstdint>
#include <memory>
#include <span>
#include <string_view>

#include "fpgasim/engine.h"

namespace fpgasim {

// Host side: what WebAssembly receives as the imports fs_emit_json, fs_emit_binary, fs_now_ms.
class Host {
public:
    virtual void emitJson(std::string_view text) = 0;             // control message to the interface
    virtual void emitBinary(std::span<const uint8_t> bytes) = 0;  // binary message; the host copies the bytes
    virtual double nowMs() = 0;                                   // real time for the chunk budget

protected:
    ~Host() = default;
};

class Runtime {
public:
    Runtime(std::unique_ptr<Engine> engine, Host& host);
    ~Runtime();
    Runtime(const Runtime&) = delete;
    Runtime& operator=(const Runtime&) = delete;

    void json(std::string_view text);             // control message to the core (fs_json)
    void binary(std::span<const uint8_t> bytes);  // binary message to the core (fs_binary)
    void tick(double nowMs);                      // one chunk (fs_tick)

private:
    class Impl;
    std::unique_ptr<Impl> impl_;
};

// Chunk limits (spec section 5.3).
inline constexpr uint64_t kPacketHalfSteps = 40000;  // half-cycles per call to the engine
inline constexpr double kChunkBudgetMs = 12.0;       // real time per chunk

}  // namespace fpgasim
