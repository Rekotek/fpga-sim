// Nets and parts (spec sections 5.4, 5.6 and 6).
#include <catch2/catch_test_macros.hpp>

#include "harness.h"
#include "runtime/registry.h"

using namespace fpgasim;
using namespace fpgasim::test;

namespace {

// A design without a clock: time advances only by steps and part wakeups.
Json clocklessConfigure() {
    Json cfg = defaultConfigure();
    cfg["clock"] = nullptr;
    cfg["nets"][0]["pull"] = "down";
    return cfg;
}

// Net changes from the recording: times and levels after the initial values.
std::vector<std::pair<Time, uint32_t>> recordedChanges(Sim& sim, int record) {
    sim.host.traces.clear();
    REQUIRE(isOk(sim.cmd(Json{{"t", "recordFetch"}, {"record", record}})));
    std::vector<std::pair<Time, uint32_t>> out;
    for (const TraceMsg& trace : sim.host.traces) {
        for (size_t i = 1; i < trace.changes.size(); ++i)
            out.emplace_back(trace.changes[i].t, trace.changes[i].words[0]);
    }
    return out;
}

}  // namespace

TEST_CASE("кнопки: press и release меняют уровни выходов", "[nets]") {
    Sim sim;
    sim.configure(clocklessConfigure());
    CHECK(sim.host.noticeCodes().empty());
    // At rest the buttons are released and the inputs are pulled down: led[0] and led[1] are at one.
    CHECK(sim.frame().nets[kNetBtn0].level == 0);
    CHECK(sim.frame().nets[kNetBtn0].flags == 0);
    CHECK(sim.frame().nets[kNetLed0].level == 1);
    CHECK(sim.frame().nets[kNetLed0].flags == kNetFpga);
    CHECK(sim.frame().nets[kNetLed1].level == 1);
    CHECK(sim.frame().nets[kNetLed3].level == 0);

    sim.stepTime(1'000'000);
    REQUIRE(isOk(sim.part("s1", "press")));
    sim.stepTime(1'000'000);
    CHECK(sim.frame().nets[kNetBtn0].level == 1);
    CHECK(sim.frame().nets[kNetBtn0].flags == kNetPart);
    CHECK(sim.frame().nets[kNetBtn0].toggles == 1);
    CHECK(sim.frame().nets[kNetLed0].level == 0);
    CHECK(sim.frame().nets[kNetLed0].toggles == 1);
    CHECK(sim.frame().nets[kNetLed1].level == 1);
    CHECK(sim.frame().nets[kNetLed1].toggles == 0);
    // Button state: one byte, only for the part that changed.
    REQUIRE(sim.frame().parts.size() == 1);
    CHECK(sim.frame().parts[0].index == 1);
    CHECK(sim.frame().parts[0].state == std::vector<uint8_t>{1});

    sim.part("s2", "press");
    sim.stepTime(1'000'000);
    CHECK(sim.frame().nets[kNetLed1].level == 0);
    CHECK(sim.frame().nets[kNetLed3].level == 1);  // both pressed

    REQUIRE(isOk(sim.part("s1", "release")));
    sim.stepTime(1'000'000);
    CHECK(sim.frame().nets[kNetBtn0].level == 0);
    CHECK(sim.frame().nets[kNetBtn0].flags == 0);
    CHECK(sim.frame().nets[kNetLed0].level == 1);
    CHECK(sim.frame().nets[kNetLed3].level == 0);
    CHECK(sim.frame().parts[0].state == std::vector<uint8_t>{0});
    // A repeated command changes nothing.
    sim.part("s1", "release");
    sim.stepTime(1'000'000);
    CHECK(sim.frame().nets[kNetBtn0].toggles == 0);
    CHECK(sim.frame().parts.empty());
}

TEST_CASE("доля времени в единице считается по моментам изменений", "[nets]") {
    Sim sim;
    sim.configure(clocklessConfigure());
    sim.stepTime(1'000'000);  // frame closed; then one chunk of 4 ms
    const size_t before = sim.host.frames.size();
    // Commands arrive on pause at one moment; the time step splits the chunk.
    sim.cmd(Json{{"t", "step"}, {"unit", "time"}, {"ps", "1000000000"}});
    sim.tick(0);
    sim.part("s1", "press");
    sim.cmd(Json{{"t", "step"}, {"unit", "time"}, {"ps", "3000000000"}});
    sim.tick(0);
    REQUIRE(sim.host.frames.size() == before + 2);
    const Frame& low = sim.host.frames[before].frame;
    const Frame& high = sim.host.frames[before + 1].frame;
    CHECK(low.nets[kNetBtn0].duty == 0.0f);
    CHECK(high.spanPs == 3'000'000'000ull);
    CHECK(high.nets[kNetBtn0].duty == 1.0f);
    CHECK(high.nets[kNetBtn0].toggles == 1);
    CHECK(high.nets[kNetLed0].duty == 0.0f);
    // If time did not advance during the chunk, the fraction equals the level.
    sim.cmd(Json{{"t", "pause"}});
    CHECK(sim.frame().spanPs == 0);
    CHECK(sim.frame().nets[kNetBtn0].duty == 1.0f);
    CHECK(sim.frame().nets[kNetLed0].duty == 0.0f);
}

TEST_CASE("вход без подтяжки и без источника даёт INPUT_FLOATING", "[nets]") {
    Sim sim;
    Json cfg = clocklessConfigure();
    cfg["nets"][kNetBtn0]["pull"] = "none";
    sim.hello();
    sim.host.clear();
    REQUIRE(isOk(sim.cmd(cfg)));
    // The notice arrives after the reply and the state, before the frame.
    REQUIRE(sim.host.msgs.size() == 3);
    const Json notice = sim.host.msgs[2];
    CHECK(notice["t"] == "notice");
    CHECK(notice["code"] == "INPUT_FLOATING");
    CHECK(notice["net"] == "pin:88");
    CHECK(notice["time"] == "0");
    CHECK(sim.frame().nets[kNetBtn0].level == 0);
    CHECK(sim.frame().nets[kNetBtn0].flags == kNetFloating);
    CHECK(sim.frame().nets[kNetBtn1].flags == 0);  // the second button has a pull

    // A press clears the flag; a release restores it, but the notice comes at most once per second of simulation.
    sim.host.clear();
    sim.part("s1", "press");
    sim.stepTime(1'000'000);
    CHECK(sim.frame().nets[kNetBtn0].flags == kNetPart);
    sim.part("s1", "release");
    sim.stepTime(1'000'000);
    CHECK(sim.frame().nets[kNetBtn0].flags == kNetFloating);
    CHECK(sim.host.noticeCodes().empty());
    sim.stepTime(kPsPerSecond);
    sim.part("s1", "press");
    sim.part("s1", "release");
    CHECK(sim.host.noticeCodes() == std::vector<std::string>{"INPUT_FLOATING"});

    // A pull-up sets one; a net without an FPGA port gives no notice.
    Sim pulled;
    cfg["nets"][kNetBtn0]["pull"] = "up";
    cfg["nets"].push_back(Json{{"pin", 73}, {"pull", "none"}});
    pulled.configure(cfg);
    CHECK(pulled.host.noticeCodes().empty());
    CHECK(pulled.frame().nets[kNetBtn0].level == 1);
    CHECK(pulled.frame().nets[kNetLed0].level == 0);
    CHECK(pulled.frame().nets[7].flags == kNetFloating);
    // reset repeats the notice: the notice history is erased.
    Sim again;
    cfg["nets"][kNetBtn0]["pull"] = "none";
    again.configure(cfg);
    again.host.clear();
    again.cmd(Json{{"t", "reset"}});
    CHECK(again.host.noticeCodes() == std::vector<std::string>{"INPUT_FLOATING"});
}

TEST_CASE("конфликт двух деталей на одной сети даёт NET_CONFLICT", "[nets]") {
    Sim sim;
    Json cfg = clocklessConfigure();
    // A second button on the same pin: at rest it holds 1, and on press it pulls to 0.
    cfg["parts"].push_back(Json{{"id", "s3"},
                                {"type", "button"},
                                {"pins", Json{{"out", 88}}},
                                {"settings", Json{{"activeLevel", 0}, {"idle", "drive"}}}});
    sim.configure(cfg);
    CHECK(sim.host.noticeCodes().empty());
    CHECK(sim.frame().nets[kNetBtn0].level == 1);  // one source: no conflict
    CHECK(sim.frame().nets[kNetBtn0].flags == kNetPart);

    sim.part("s3", "press");  // s3 pulls to 0
    sim.host.clear();
    sim.part("s1", "press");  // s1 pulls to 1
    REQUIRE(sim.host.noticeCodes() == std::vector<std::string>{"NET_CONFLICT"});
    CHECK(sim.host.ofType("notice")[0]["net"] == "pin:88");
    sim.stepTime(1000);
    CHECK(sim.frame().nets[kNetBtn0].flags == (kNetPart | kNetConflict));
    CHECK(sim.frame().nets[kNetBtn0].level == 1);  // the level comes from the first part

    // The conflict disappears when the levels match, and repeats at most once per second of simulation.
    sim.host.clear();
    sim.part("s3", "release");
    sim.stepTime(1000);
    CHECK(sim.frame().nets[kNetBtn0].flags == kNetPart);
    sim.part("s3", "press");
    CHECK(sim.host.noticeCodes().empty());
    sim.part("s3", "release");
    sim.stepTime(kPsPerSecond);
    sim.part("s3", "press");
    CHECK(sim.host.noticeCodes() == std::vector<std::string>{"NET_CONFLICT"});
}

TEST_CASE("деталь против выхода ПЛИС: NET_CONFLICT, уровень остаётся за ПЛИС", "[nets]") {
    Sim sim;
    Json cfg = clocklessConfigure();
    cfg["parts"].push_back(
        Json{{"id", "sx"}, {"type", "button"}, {"pins", Json{{"out", 15}}}, {"settings", Json{{"activeLevel", 0}}}});
    sim.configure(cfg);
    CHECK(sim.host.noticeCodes().empty());
    sim.host.clear();
    sim.part("sx", "press");  // led[0] = 1, the part pulls to 0
    CHECK(sim.host.noticeCodes() == std::vector<std::string>{"NET_CONFLICT"});
    sim.stepTime(1000);
    CHECK(sim.frame().nets[kNetLed0].level == 1);
    CHECK(sim.frame().nets[kNetLed0].flags == (kNetFpga | kNetPart | kNetConflict));
    // When the FPGA output itself becomes zero, the levels match.
    sim.part("s1", "press");
    sim.stepTime(1000);
    CHECK(sim.frame().nets[kNetLed0].level == 0);
    CHECK(sim.frame().nets[kNetLed0].flags == (kNetFpga | kNetPart));
}

TEST_CASE("переключатель: команда set и настройка idle", "[nets]") {
    Sim sim;
    Json cfg = clocklessConfigure();
    cfg["parts"][1] = Json{{"id", "sw"},
                           {"type", "switch"},
                           {"pins", Json{{"out", 88}}},
                           {"settings", Json{{"activeLevel", 0}, {"idle", "drive"}}}};
    sim.configure(cfg);
    CHECK(sim.frame().nets[kNetBtn0].level == 1);  // at rest the part holds the opposite level
    CHECK(sim.frame().nets[kNetBtn0].flags == kNetPart);
    REQUIRE(isOk(sim.part("sw", "set", Json{{"on", true}})));
    sim.stepTime(1000);
    CHECK(sim.frame().nets[kNetBtn0].level == 0);
    CHECK(sim.frame().parts[0].state == std::vector<uint8_t>{1});
    REQUIRE(isOk(sim.part("sw", "set", Json{{"on", false}})));
    sim.stepTime(1000);
    CHECK(sim.frame().nets[kNetBtn0].level == 1);
    CHECK(errorCode(sim.part("sw", "set")) == "PART_COMMAND_INVALID");                   // no argument on
    CHECK(errorCode(sim.part("sw", "set", Json{{"on", 1}})) == "PART_COMMAND_INVALID");  // not a boolean value
    CHECK(errorCode(sim.part("sw", "press")) == "PART_COMMAND_INVALID");
}

TEST_CASE("дребезг: больше двух переключений, все в пределах 5 мс, запуски совпадают", "[nets]") {
    const Time bouncePs = 5'000'000'000ull;
    const Time pressAt = 1'000'000'000ull;
    const auto bounce = [&](Sim& sim) {
        const Json started =
            sim.cmd(Json{{"t", "recordStart"}, {"signals", Json::array({"pin:88"})}, {"mode", "ring"}});
        REQUIRE(isOk(started));
        sim.stepTime(pressAt);
        REQUIRE(isOk(sim.part("s1", "press")));
        sim.stepTime(20'000'000'000ull);
        return recordedChanges(sim, started["record"]);
    };
    Json cfg = clocklessConfigure();
    cfg["parts"][1]["settings"]["bounceMs"] = 5;

    Sim first;
    first.configure(cfg);
    const auto changes = bounce(first);
    REQUIRE(changes.size() > 2);
    CHECK(changes.front().first == pressAt);
    CHECK(changes.front().second == 1);
    CHECK(changes.back().second == 1);  // final level is pressed
    Time last = 0;
    for (size_t i = 0; i < changes.size(); ++i) {
        CHECK(changes[i].first >= pressAt);
        CHECK(changes[i].first <= pressAt + bouncePs);
        if (i > 0) {
            CHECK(changes[i].second != changes[i - 1].second);
            const Time gap = changes[i].first - last;
            CHECK(gap >= 50'000'000ull);     // intervals from 50 us...
            CHECK(gap <= 2'000'000'000ull);  // ...to 2 ms
        }
        last = changes[i].first;
    }
    // Button state in the frame is "pressed", without bounce.
    CHECK(first.frame().nets[kNetBtn0].level == 1);
    CHECK(first.frame().nets[kNetBtn0].toggles == changes.size());

    // A second run and a run after reset give the same sequence.
    Sim second;
    second.configure(cfg);
    CHECK(bounce(second) == changes);
    first.cmd(Json{{"t", "reset"}});
    CHECK(bounce(first) == changes);

    // A button with another name has its own sequence.
    Sim other;
    cfg["parts"][1]["id"] = "s1b";
    other.configure(cfg);
    other.cmd(Json{{"t", "recordStart"}, {"signals", Json::array({"pin:88"})}, {"mode", "ring"}});
    other.stepTime(pressAt);
    other.part("s1b", "press");
    other.stepTime(20'000'000'000ull);
    CHECK(recordedChanges(other, 0) != changes);

    // A release also bounces and ends with the contact released.
    const Json started = second.cmd(Json{{"t", "recordStart"}, {"signals", Json::array({"pin:88"})}, {"mode", "ring"}});
    second.part("s1", "release");
    second.stepTime(20'000'000'000ull);
    const auto released = recordedChanges(second, started["record"]);
    REQUIRE(released.size() > 2);
    CHECK(released.front().second == 0);
    CHECK(released.back().second == 0);
    CHECK(released.back().first - released.front().first <= bouncePs);
}

// --- Part for checking runtime services ------------------------------------------------

namespace {

struct TestPart final : Part {
    static TestPart* last;
    PartHost* host = nullptr;
    std::vector<std::pair<bool, Time>> edges;
    std::vector<std::pair<uint32_t, Time>> wakes;
    std::vector<uint8_t> received;
    NetStats chunk{};
    int resets = 0;
    int gain = 0;

    void attach(PartHost& h, const Json& settings) override {
        host = &h;
        gain = settings.value("gain", 0);
        last = this;
    }
    void reset() override {
        ++resets;
        edges.clear();
        wakes.clear();
    }
    void onEdge(int role, bool level, Time t) override {
        edges.emplace_back(level, t);
        host->emitEvent("edge", Json{{"role", role}, {"level", level}});
        host->markDirty();
    }
    void onWake(uint32_t tag, Time t) override {
        wakes.emplace_back(tag, t);
        host->drive(1, tag == 7);
    }
    void onCommand(std::string_view cmd, const Json& args) override {
        if (cmd == "emit") {
            const std::vector<uint8_t> bytes = args["bytes"];
            host->emitData(3, bytes);
        } else if (cmd == "wake") {
            host->wakeAt(host->now() + 1000, 7);
            host->wakeAt(host->now() + 3000, 8);
            host->wakeAt(host->now() + 2000, 9);
            host->cancelWake(9);
        }
    }
    void onData(uint16_t channel, std::span<const uint8_t> bytes) override {
        received.assign(bytes.begin(), bytes.end());
        received.push_back(static_cast<uint8_t>(channel));
    }
    void onSettings(const Json& settings) override { gain = settings.value("gain", 0); }
    void onChunkEnd() override { chunk = host->stats(0); }
    void writeState(ByteWriter& out) const override {
        out.u8(static_cast<uint8_t>(edges.size()));
        out.u8(static_cast<uint8_t>(gain));
        out.u8(host->level(0) ? 1 : 0);
    }
};
TestPart* TestPart::last = nullptr;

void registerTestPart() {
    registerPartDescription("tpart", R"({
        "format": 1, "type": "tpart", "since": 1, "name": {"ru": "Тестовая"},
        "pins": [
            {"role": "in", "dir": "in", "edges": true, "label": {"ru": "Вход"}},
            {"role": "out", "dir": "out", "edges": false, "label": {"ru": "Выход"}}
        ],
        "settings": {"gain": {"type": "integer", "minimum": 0, "maximum": 9, "default": 2, "label": {"ru": "Усиление"}}},
        "commands": [
            {"name": "emit", "args": {"bytes": {"type": "array", "items": {"type": "integer", "minimum": 0, "maximum": 255}}}},
            {"name": "wake"}
        ],
        "events": [{"name": "edge"}]
    })");
    registerPart("tpart", [] { return std::unique_ptr<Part>(std::make_unique<TestPart>()); });
}

}  // namespace

TEST_CASE("услуги для детали: фронты, события, данные, пробуждения, статистика", "[nets][parts]") {
    registerTestPart();
    Sim sim;  // q on pin 17 toggles every 4 clocks
    Json cfg = defaultConfigure();
    cfg["nets"].push_back(Json{{"pin", 73}, {"pull", "down"}});
    cfg["parts"].push_back(Json{{"id", "tp"}, {"type", "tpart"}, {"pins", Json{{"in", 17}, {"out", 73}}}});
    sim.hello();
    CHECK(sim.host.ofType("ready")[0]["partTypes"] ==
          Json::array({"button", "led", "probe", "switch", "tpart", "uart", "ws2812"}));
    REQUIRE(isOk(sim.cmd(cfg)));
    TestPart* part = TestPart::last;
    REQUIRE(part != nullptr);
    CHECK(part->gain == 2);  // default from the part description
    CHECK(part->resets == 1);
    const int tp = 3;  // part index in configure

    // Edges arrive with exact time: q changes on clocks 4 and 8.
    sim.host.clear();
    sim.stepCycles(10);
    REQUIRE(part->edges.size() == 2);
    CHECK(part->edges[0] == std::make_pair(true, halfStart(27'000'000, 6)));
    CHECK(part->edges[1] == std::make_pair(false, halfStart(27'000'000, 14)));
    const std::vector<Json> events = sim.host.ofType("partEvent");
    REQUIRE(events.size() == 2);
    CHECK(events[0] == Json{{"t", "partEvent"},
                            {"part", "tp"},
                            {"event", "edge"},
                            {"data", Json{{"role", 0}, {"level", true}}},
                            {"time", timeToString(halfStart(27'000'000, 6))}});
    // Net statistics per chunk and the state in the frame.
    CHECK(part->chunk.toggles == 2);
    CHECK(part->chunk.level == false);
    CHECK(part->chunk.span == halfStart(27'000'000, 20));
    CHECK(part->chunk.highTime == halfStart(27'000'000, 14) - halfStart(27'000'000, 6));
    REQUIRE(sim.frame().parts.size() == 1);
    CHECK(sim.frame().parts[0].index == tp);
    CHECK(sim.frame().parts[0].state == std::vector<uint8_t>{2, 2, 0});

    // Wakeups: at the given time; a cancelled one does not arrive; the part drives the net.
    const Time base = halfStart(27'000'000, 20);
    REQUIRE(isOk(sim.part("tp", "wake")));
    sim.stepTime(1500);
    REQUIRE(part->wakes.size() == 1);
    CHECK(part->wakes[0] == std::make_pair(uint32_t{7}, base + 1000));
    CHECK(sim.frame().nets[7].level == 1);
    CHECK(sim.frame().nets[7].flags == kNetPart);
    CHECK(sim.frame().nets[7].toggles == 1);
    sim.stepTime(5000);
    REQUIRE(part->wakes.size() == 2);
    CHECK(part->wakes[1] == std::make_pair(uint32_t{8}, base + 3000));
    CHECK(sim.frame().nets[7].level == 0);

    // PART_DATA in both directions.
    sim.host.clear();
    REQUIRE(isOk(sim.part("tp", "emit", Json{{"bytes", Json::array({72, 105, 33})}})));
    REQUIRE(sim.host.partData.size() == 1);
    CHECK(sim.host.partData[0].part == tp);
    CHECK(sim.host.partData[0].channel == 3);
    CHECK(sim.host.partData[0].bytes == std::vector<uint8_t>{72, 105, 33});
    CHECK(sim.host.partData[0].header.time == base + 6500);
    sim.part("tp", "emit", Json{{"bytes", Json::array()}});
    CHECK(sim.host.partData[1].header.seq == sim.host.partData[0].header.seq + 1);
    CHECK(errorCode(sim.part("tp", "emit", Json{{"bytes", Json::array({256})}})) == "PART_COMMAND_INVALID");
    std::vector<uint8_t> msg;
    const uint8_t bytes[] = {1, 2, 3, 4, 5};
    encodePartData(msg, 0, 0, static_cast<uint16_t>(tp), 6, bytes);
    sim.rt.binary(msg);
    CHECK(part->received == std::vector<uint8_t>{1, 2, 3, 4, 5, 6});

    // Settings on the fly and reset.
    REQUIRE(isOk(sim.cmd(Json{{"t", "partSettings"}, {"part", "tp"}, {"settings", Json{{"gain", 9}}}})));
    CHECK(part->gain == 9);
    sim.cmd(Json{{"t", "reset"}});
    CHECK(part->resets == 2);
    CHECK(part->edges.empty());
    CHECK(sim.host.badBinary == 0);
}
