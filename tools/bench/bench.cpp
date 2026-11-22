// Benchmark: outer measurement loop.
// The model is created anew for each run; the clock runs in batches of at most
// 40 000 half cycles (spec section 5.3), output toggles are counted per bit.
// The file does not depend on the model: the engine comes through createEngine() from the shim.
#include <algorithm>
#include <chrono>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "engine_bench.h"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#endif

namespace {

constexpr uint64_t kPacket = 40000;

struct OutputState {
    int port;
    uint32_t width;
    std::vector<uint32_t> prev;
    std::vector<uint32_t> cur;
    std::vector<uint64_t> toggles;  // one counter per bit
};

void appendf(std::string& s, const char* fmt, ...) {
    char buf[256];
    va_list ap;
    va_start(ap, fmt);
    std::vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);
    s += buf;
}

// Names with Verilog escaping contain a backslash.
std::string jsonEscape(const std::string& in) {
    std::string out;
    for (const char c : in) {
        if (c == '"' || c == '\\') out += '\\';
        out += c;
    }
    return out;
}

std::string runBench(uint64_t halfSteps, const char* clockName) {
    std::unique_ptr<fpgasim::Engine> eng = fpgasim::createEngine();

    int clockPort = -1;
    std::vector<OutputState> outs;
    for (int i = 0; i < eng->portCount(); ++i) {
        const fpgasim::PortDesc& p = eng->port(i);
        if (p.dir == fpgasim::PortDir::In && p.width == 1 && std::strcmp(p.name, clockName) == 0) clockPort = i;
        if (p.dir == fpgasim::PortDir::Out) {
            const size_t words = (p.width + 31) / 32;
            outs.push_back({i, p.width, std::vector<uint32_t>(words), std::vector<uint32_t>(words),
                            std::vector<uint64_t>(p.width)});
        }
    }
    if (clockPort < 0) return "{\"error\":\"clock port not found\"}";

    eng->setClockPort(clockPort);
    eng->settle();
    eng->takeChangedOutputs();
    for (OutputState& o : outs) eng->readPort(o.port, o.prev.data());

    uint64_t done = 0;
    uint64_t stops = 0;
    bool finished = false;
    const auto t0 = std::chrono::steady_clock::now();
    while (done < halfSteps && !finished) {
        const fpgasim::RunResult r = eng->run(std::min(kPacket, halfSteps - done));
        done += r.halfSteps;
        finished = r.finished;
        if (!r.changed) continue;
        ++stops;
        const uint64_t mask = eng->takeChangedOutputs();
        for (OutputState& o : outs) {
            if (!(mask & (uint64_t{1} << o.port))) continue;
            eng->readPort(o.port, o.cur.data());
            for (uint32_t bit = 0; bit < o.width; ++bit) {
                const uint32_t diff = (o.cur[bit / 32] ^ o.prev[bit / 32]) >> (bit % 32) & 1u;
                o.toggles[bit] += diff;
            }
            o.prev = o.cur;
        }
    }
    const auto t1 = std::chrono::steady_clock::now();
    const double seconds = std::chrono::duration<double>(t1 - t0).count();

    std::string json = "{";
    appendf(json, "\"halfSteps\":%llu,\"seconds\":%.6f,\"mcps\":%.3f,\"stops\":%llu,\"finished\":%s,",
            static_cast<unsigned long long>(done), seconds, done / 2.0 / seconds / 1e6,
            static_cast<unsigned long long>(stops), finished ? "true" : "false");
    json += "\"toggles\":{";
    for (size_t i = 0; i < outs.size(); ++i) {
        if (i) json += ",";
        appendf(json, "\"%s\":[", jsonEscape(eng->port(outs[i].port).name).c_str());
        for (uint32_t bit = 0; bit < outs[i].width; ++bit) {
            appendf(json, "%s%llu", bit ? "," : "", static_cast<unsigned long long>(outs[i].toggles[bit]));
        }
        json += "]";
    }
    json += "},\"signals\":[";
    const std::vector<fpgasim::SignalInfo> sigs = eng->signals();
    for (size_t i = 0; i < sigs.size(); ++i) {
        const fpgasim::SignalInfo& s = sigs[i];
        if (i) json += ",";
        appendf(json, "{\"path\":\"%s\",\"width\":%u,\"depth\":%u,\"param\":%s", jsonEscape(s.path).c_str(), s.width,
                s.depth, s.isParam ? "true" : "false");
        if (s.depth == 0 && s.width <= 64 && s.data) {
            uint32_t w[2] = {0, 0};
            fpgasim::readWords(s.data, s.width, w);
            appendf(json, ",\"value\":\"%llu\"", static_cast<unsigned long long>(w[0] | (uint64_t{w[1]} << 32)));
        }
        json += "}";
    }
    json += "]}";
    return json;
}

}  // namespace

#ifdef __EMSCRIPTEN__

extern "C" EMSCRIPTEN_KEEPALIVE const char* bench_run(double halfSteps) {
    static std::string result;
    result = runBench(static_cast<uint64_t>(halfSteps), "clk");
    return result.c_str();
}

#else

// Usage: bench [half cycles] [runs] [clock name]. One JSON line per run.
int main(int argc, char** argv) {
    const uint64_t halfSteps = argc > 1 ? std::strtoull(argv[1], nullptr, 10) : 113400000ull;
    const int runs = argc > 2 ? std::atoi(argv[2]) : 1;
    const char* clockName = argc > 3 ? argv[3] : "clk";
    for (int i = 0; i < runs; ++i) {
        std::puts(runBench(halfSteps, clockName).c_str());
        std::fflush(stdout);
    }
    return 0;
}

#endif
