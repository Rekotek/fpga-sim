// Test scaffolding: a host that remembers the core messages, and a bench with the fake engine.
#pragma once

#include <cstdlib>
#include <fstream>
#include <string>
#include <vector>

#include "fake_engine.h"
#include "fpgasim/clock.h"
#include "fpgasim/json.h"
#include "fpgasim/protocol.h"
#include "fpgasim/runtime.h"

namespace fpgasim::test {

struct TraceChange {
    Time t;
    uint16_t index;
    std::vector<uint32_t> words;
};

struct TraceMsg {
    BinaryHeader header;
    uint32_t record;
    Time fromPs;
    Time toPs;
    std::vector<TraceChange> changes;
    size_t bytes;
};

struct PartDataMsg {
    BinaryHeader header;
    uint16_t part;
    uint16_t channel;
    std::vector<uint8_t> bytes;
};

struct FrameMsg {
    BinaryHeader header;
    Frame frame;
};

class TestHost final : public Host {
public:
    void emitJson(std::string_view text) override {
        msgs.push_back(Json::parse(text));
        // All core messages are saved for checking against the spec/protocol schemas (make test-core).
        if (const char* path = std::getenv("FPGASIM_TRANSCRIPT")) std::ofstream(path, std::ios::app) << text << "\n";
    }

    void emitBinary(std::span<const uint8_t> bytes) override {
        const auto header = decodeHeader(bytes);
        if (!header) {
            ++badBinary;
            return;
        }
        const auto payload = bytes.subspan(kBinaryHeaderSize);
        if (header->kind == BinaryKind::Frame) {
            FrameMsg msg{*header, {}};
            if (!decodeFrame(payload, msg.frame)) ++badBinary;
            frames.push_back(std::move(msg));
        } else if (header->kind == BinaryKind::Trace) {
            ByteReader r(payload);
            TraceMsg msg{*header, r.u32(), 0, 0, {}, bytes.size()};
            const uint32_t count = r.u32();
            msg.fromPs = r.u64();
            msg.toPs = r.u64();
            for (uint32_t i = 0; i < count && !r.failed(); ++i) {
                TraceChange c{r.u64(), r.u16(), {}};
                const uint16_t words = r.u16();
                for (uint16_t k = 0; k < words; ++k) c.words.push_back(r.u32());
                msg.changes.push_back(std::move(c));
            }
            if (r.failed() || r.remaining() != 0) ++badBinary;
            traces.push_back(std::move(msg));
        } else {
            const auto data = decodePartData(payload);
            if (!data) {
                ++badBinary;
                return;
            }
            partData.push_back({*header, data->part, data->channel, {data->bytes.begin(), data->bytes.end()}});
        }
    }

    // Real time in tests advances only by calls: each poll moves it by perCallMs.
    double nowMs() override {
        clock += perCallMs;
        return clock;
    }

    std::vector<Json> ofType(const std::string& type) const {
        std::vector<Json> out;
        for (const Json& m : msgs) {
            if (m.value("t", "") == type) out.push_back(m);
        }
        return out;
    }
    std::vector<std::string> noticeCodes() const {
        std::vector<std::string> out;
        for (const Json& m : ofType("notice")) out.push_back(m.value("code", ""));
        return out;
    }
    void clear() {
        msgs.clear();
        frames.clear();
        traces.clear();
        partData.clear();
    }

    std::vector<Json> msgs;
    std::vector<FrameMsg> frames;
    std::vector<TraceMsg> traces;
    std::vector<PartDataMsg> partData;
    int badBinary = 0;
    double clock = 1000.0;
    double perCallMs = 0.0;
};

// Net indexes in the default configure.
enum DefaultNet { kNetClk = 0, kNetLed0, kNetLed1, kNetLed2, kNetLed3, kNetBtn0, kNetBtn1 };

inline Json defaultConfigure() {
    return Json{
        {"t", "configure"},
        {"board", "tang-nano-20k"},
        {"clock", Json{{"port", "clk"}, {"hz", 27000000}}},
        {"nets", Json::array({
                     Json{{"pin", 4}, {"port", "clk"}, {"bit", 0}, {"pull", "none"}},
                     Json{{"pin", 15}, {"port", "led"}, {"bit", 0}, {"pull", "none"}},
                     Json{{"pin", 16}, {"port", "led"}, {"bit", 1}, {"pull", "none"}},
                     Json{{"pin", 17}, {"port", "led"}, {"bit", 2}, {"pull", "none"}},
                     Json{{"pin", 18}, {"port", "led"}, {"bit", 3}, {"pull", "none"}},
                     Json{{"pin", 88}, {"port", "btn"}, {"bit", 0}, {"pull", "down"}},
                     Json{{"pin", 87}, {"port", "btn"}, {"bit", 1}, {"pull", "down"}},
                 })},
        {"parts",
         Json::array({
             Json{{"id", "led0"}, {"type", "led"}, {"pins", Json{{"in", 15}}}, {"settings", Json{{"activeLevel", 0}}}},
             Json{
                 {"id", "s1"}, {"type", "button"}, {"pins", Json{{"out", 88}}}, {"settings", Json{{"activeLevel", 1}}}},
             Json{{"id", "s2"}, {"type", "button"}, {"pins", Json{{"out", 87}}}},
         })},
        {"watch", Json::array()},
    };
}

// The core with the fake engine. Commands get an id, and the reply to the command is returned.
class Sim {
public:
    explicit Sim(uint32_t div = 4) : Sim(std::make_unique<FakeEngine>(div)) {}
    explicit Sim(std::unique_ptr<FakeEngine> e) : engine(e.get()), rt(std::move(e), host) {}

    // Sends a command and returns the ok or error reply with its id.
    Json cmd(Json msg) {
        const int id = nextId_++;
        msg["id"] = id;
        rt.json(msg.dump());
        for (auto it = host.msgs.rbegin(); it != host.msgs.rend(); ++it) {
            const std::string t = it->value("t", "");
            if ((t == "ok" || t == "error") && it->value("id", -1) == id) return *it;
        }
        return Json();
    }

    void hello() { cmd(Json{{"t", "hello"}, {"protocol", 1}}); }

    Json configure(const Json& msg = defaultConfigure()) {
        hello();
        return cmd(msg);
    }

    // Step on pause: the command and tick calls until a frame arrives.
    Json step(Json msg) {
        msg["t"] = "step";
        const size_t before = host.frames.size();
        Json reply = cmd(std::move(msg));
        for (int i = 0; i < 100000 && reply.value("t", "") == "ok" && host.frames.size() == before; ++i) tick(0);
        return reply;
    }
    Json stepCycles(uint64_t count) { return step(Json{{"unit", "cycle"}, {"count", count}}); }
    Json stepTime(Time ps) { return step(Json{{"unit", "time"}, {"ps", timeToString(ps)}}); }

    // One chunk; real time advances by advanceMs.
    void tick(double advanceMs) {
        host.clock += advanceMs;
        rt.tick(host.clock);
    }

    Json part(const std::string& id, const std::string& command, Json args = Json::object()) {
        return cmd(Json{{"t", "part"}, {"part", id}, {"cmd", command}, {"args", std::move(args)}});
    }

    const Frame& frame() const { return host.frames.back().frame; }
    Time frameTime() const { return host.frames.back().header.time; }
    Json lastState() const { return host.ofType("state").back(); }

    TestHost host;
    FakeEngine* engine;
    Runtime rt;

private:
    int nextId_ = 1;
};

inline bool isOk(const Json& reply) { return reply.value("t", "") == "ok"; }
inline std::string errorCode(const Json& reply) {
    return reply.value("t", "") == "error" ? reply.value("code", "") : "";
}

}  // namespace fpgasim::test
