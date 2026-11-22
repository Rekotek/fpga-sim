// Example launcher for the host build. It links with the model and the example shim,
// takes a scenario in JSON and prints the result as one line of JSON. tools/native/run_examples.py
// prepares the scenario: the configure message, the run time and the commands to parts.
//
//   { "configure": { … }, "runPs": "2100000000000",
//     "actions": [ { "atPs": "1000000000", "part": "s1", "cmd": "press", "args": {} } ] }
//
// The launcher talks to the core only with protocol messages, as the interface does.
#include <chrono>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "fpgasim/json.h"
#include "fpgasim/protocol.h"
#include "fpgasim/runtime.h"

namespace {

using fpgasim::Json;
using fpgasim::Time;

struct NetTotal {
    uint64_t toggles = 0;
    double highPs = 0;
    uint8_t level = 0;
    uint8_t flags = 0;
};

class RunnerHost final : public fpgasim::Host {
public:
    void emitJson(std::string_view text) override {
        Json msg = Json::parse(text, nullptr, false);
        const std::string type = msg.value("t", "");
        if (type == "ready") ready = msg;
        if (type == "notice") notices.push_back(msg);
        if (type == "error") errors.push_back(msg);
        if (type == "ok") lastOk = msg;
        if (type == "state") state = msg;
        if (type == "partEvent") partEvents.push_back(msg);
    }

    void emitBinary(std::span<const uint8_t> bytes) override {
        const auto header = fpgasim::decodeHeader(bytes);
        if (header && header->kind == fpgasim::BinaryKind::Trace) {
            fpgasim::ByteReader r(bytes.subspan(fpgasim::kBinaryHeaderSize));
            r.u32();
            const uint32_t count = r.u32();
            r.u64();
            r.u64();
            for (uint32_t i = 0; i < count && !r.failed(); ++i) {
                Json change{{"t", fpgasim::timeToString(r.u64())}, {"index", r.u16()}, {"words", Json::array()}};
                const uint16_t words = r.u16();
                for (uint16_t k = 0; k < words; ++k) change["words"].push_back(r.u32());
                trace.push_back(std::move(change));
            }
            return;
        }
        if (header && header->kind == fpgasim::BinaryKind::PartData) {
            const auto data = fpgasim::decodePartData(bytes.subspan(fpgasim::kBinaryHeaderSize));
            if (data && data->channel == 0) {
                if (partData.size() <= data->part) partData.resize(data->part + 1);
                partData[data->part].insert(partData[data->part].end(), data->bytes.begin(), data->bytes.end());
            }
            return;
        }
        if (!header || header->kind != fpgasim::BinaryKind::Frame) return;
        fpgasim::Frame frame;
        if (!fpgasim::decodeFrame(bytes.subspan(fpgasim::kBinaryHeaderSize), frame)) {
            errors.push_back(Json{{"t", "error"}, {"code", "FRAME_DECODE"}, {"text", "кадр не разобран"}});
            return;
        }
        ++frames;
        watch = Json::array();
        for (const fpgasim::FrameWatch& w : frame.watch) watch.push_back(w.words);
        for (const fpgasim::FramePart& p : frame.parts) {
            if (partStates.size() <= p.index) partStates.resize(p.index + 1);
            partStates[p.index] = p.state;
        }
        spanPs += frame.spanPs;
        cycle = frame.cycle;
        totals.resize(frame.nets.size());
        for (size_t i = 0; i < frame.nets.size(); ++i) {
            totals[i].toggles += frame.nets[i].toggles;
            totals[i].highPs += static_cast<double>(frame.nets[i].duty) * static_cast<double>(frame.spanPs);
            totals[i].level = frame.nets[i].level;
            totals[i].flags = frame.nets[i].flags;
        }
    }

    double nowMs() override {
        return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();
    }

    Json ready;
    Json watch = Json::array();  // watch values from the last frame
    Json trace = Json::array();  // changes from TRACE messages
    Json lastOk;
    Json state;
    std::vector<Json> notices;
    std::vector<Json> errors;
    std::vector<Json> partEvents;
    std::vector<std::vector<uint8_t>> partData;    // channel 0 bytes by part index
    std::vector<std::vector<uint8_t>> partStates;  // last state from frames
    std::vector<NetTotal> totals;
    uint64_t frames = 0;
    Time spanPs = 0;
    uint64_t cycle = 0;
};

int failWith(const std::string& text) {
    std::fprintf(stderr, "%s\n", text.c_str());
    return 2;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) return failWith("использование: sim <сценарий.json>");
    std::ifstream file(argv[1]);
    std::stringstream buffer;
    buffer << file.rdbuf();
    const Json scenario = Json::parse(buffer.str(), nullptr, false);
    if (!scenario.is_object() || !scenario.contains("configure")) return failWith("сценарий не читается");

    RunnerHost host;
    fpgasim::Runtime rt(fpgasim::createEngine(), host);
    int nextId = 1;
    const auto command = [&](Json msg) {
        msg["id"] = nextId++;
        const size_t errorsBefore = host.errors.size();
        rt.json(msg.dump());
        return host.errors.size() == errorsBefore;
    };

    if (!command(Json{{"t", "hello"}, {"protocol", fpgasim::kProtocolVersion}}))
        return failWith(host.errors.back().dump());
    if (scenario.value("readyOnly", false)) {
        std::printf("\nFPGASIM_RESULT %s\n", Json{{"ready", host.ready}}.dump().c_str());
        return 0;
    }
    Json configure = scenario["configure"];
    configure["t"] = "configure";
    if (!command(configure)) return failWith(host.errors.back().dump());
    const Json warnings = host.lastOk.value("warnings", Json::array());
    command(Json{{"t", "signals"}});
    const Json signals = host.lastOk.value("signals", Json::array());

    // Step for a given time: the core computes it in chunks, and the result arrives as one frame.
    Time now = 0;
    const auto stepTo = [&](Time target) {
        if (target <= now) return true;
        const uint64_t framesBefore = host.frames;
        if (!command(Json{{"t", "step"}, {"unit", "time"}, {"ps", fpgasim::timeToString(target - now)}})) return false;
        while (host.frames == framesBefore) rt.tick(host.nowMs());
        now = target;
        return true;
    };

    const auto started = std::chrono::steady_clock::now();
    for (const Json& action : scenario.value("actions", Json::array())) {
        const auto at = fpgasim::parseTime(action.value("atPs", ""));
        if (!at) return failWith("действие без времени atPs: " + action.dump());
        if (!stepTo(*at)) return failWith(host.errors.back().dump());
        Json msg{{"t", "part"}, {"part", action.value("part", "")}, {"cmd", action.value("cmd", "")}};
        if (action.contains("args")) msg["args"] = action["args"];
        if (!command(msg)) return failWith(host.errors.back().dump());
    }
    const auto runPs = fpgasim::parseTime(scenario.value("runPs", ""));
    if (!runPs) return failWith("в сценарии нет времени прогона runPs");
    if (!stepTo(*runPs)) return failWith(host.errors.back().dump());
    const double realMs = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();

    // The totals of the main run are taken before the engine check: that check starts with reset.
    const std::vector<NetTotal> totals = host.totals;
    const Time totalSpan = host.spanPs;
    const uint64_t totalCycle = host.cycle;
    const std::string totalTime = host.state.value("time", "0");
    Json noticeList = Json::array();
    Json codes = Json::array();
    for (const Json& n : host.notices) {
        noticeList.push_back(n);
        codes.push_back(n.value("code", ""));
    }

    // Totals per part: PART_DATA bytes (channel 0), the last state from the frame, and events.
    Json parts = Json::object();
    const Json& partList = scenario["configure"]["parts"];
    for (size_t i = 0; i < partList.size(); ++i) {
        const std::string id = partList[i].value("id", "");
        Json events = Json::array();
        for (const Json& e : host.partEvents) {
            if (e.value("part", "") == id) events.push_back(Json{{"event", e["event"]}, {"data", e["data"]}});
        }
        parts[id] = Json{{"type", partList[i].value("type", "")},
                         {"data", i < host.partData.size() ? host.partData[i] : std::vector<uint8_t>{}},
                         {"state", i < host.partStates.size() ? host.partStates[i] : std::vector<uint8_t>{}},
                         {"events", events}};
    }

    // Engine check on a real model: watch and write by signal name.
    //   "engine": { "cycles": 20, "watch": ["top.cnt"], "record": ["pin:4", "top.cnt"] }
    Json engine = Json::object();
    if (scenario.contains("engine")) {
        const Json& spec = scenario["engine"];
        const auto sigOf = [&](const Json& name) {
            for (const Json& s : signals) {
                if (s.value("path", "") == name.get<std::string>()) return s["sig"];
            }
            return name;  // pin:N stays a string
        };
        Json watch = Json::array();
        for (const Json& name : spec.value("watch", Json::array())) watch.push_back(sigOf(name));
        Json record = Json::array();
        for (const Json& name : spec.value("record", Json::array())) record.push_back(sigOf(name));
        if (!command(Json{{"t", "reset"}})) return failWith(host.errors.back().dump());
        if (!command(Json{{"t", "watch"}, {"signals", watch}})) return failWith(host.errors.back().dump());
        if (!record.empty() && !command(Json{{"t", "recordStart"}, {"signals", record}, {"mode", "ring"}}))
            return failWith(host.errors.back().dump());
        const Json recordId = host.lastOk.value("record", Json());
        const uint64_t framesBefore = host.frames;
        if (!command(Json{{"t", "step"}, {"unit", "cycle"}, {"count", spec.value("cycles", 1)}}))
            return failWith(host.errors.back().dump());
        while (host.frames == framesBefore) rt.tick(host.nowMs());
        engine["cycle"] = host.cycle;
        engine["timePs"] = host.state.value("time", "0");
        engine["watch"] = host.watch;
        if (!record.empty()) {
            if (!command(Json{{"t", "recordFetch"}, {"record", recordId}})) return failWith(host.errors.back().dump());
            engine["trace"] = host.trace;
        }
    }

    Json nets = Json::object();
    const Json& netList = scenario["configure"]["nets"];
    for (size_t i = 0; i < totals.size() && i < netList.size(); ++i) {
        const NetTotal& t = totals[i];
        nets[std::to_string(netList[i].value("pin", 0))] =
            Json{{"toggles", t.toggles},
                 {"level", t.level},
                 {"flags", t.flags},
                 {"duty", totalSpan ? t.highPs / static_cast<double>(totalSpan) : static_cast<double>(t.level)}};
    }
    const Json result{{"ready", host.ready}, {"warnings", warnings},     {"signals", signals},  {"nets", nets},
                      {"notices", codes},    {"noticeList", noticeList}, {"timePs", totalTime}, {"cycle", totalCycle},
                      {"realMs", realMs},    {"engine", engine},         {"parts", parts}};
    // The model may print to standard output ($finish, $display): the result goes on a separate labelled line.
    std::printf("\nFPGASIM_RESULT %s\n", result.dump().c_str());
    return 0;
}
