// UART and WS2812 parts (spec sections 6.3 and 6.4) on a fake engine with a given waveform.
#include <catch2/catch_test_macros.hpp>

#include "harness.h"
#include "script_engine.h"

using namespace fpgasim;
using namespace fpgasim::test;

namespace {

constexpr uint64_t kHz = 1'000'000'000;  // 1 GHz clock: rising edge number n arrives at (n - 1) ns

// Bench: the core with ScriptEngine. Pin 69 is wave or tx, pin 70 is rx.
struct Stand {
    explicit Stand(std::unique_ptr<ScriptEngine> e) : engine(e.get()), rt(std::move(e), host) {}

    Json cmd(Json msg) {
        const int id = nextId++;
        msg["id"] = id;
        rt.json(msg.dump());
        for (auto it = host.msgs.rbegin(); it != host.msgs.rend(); ++it) {
            const std::string t = it->value("t", "");
            if ((t == "ok" || t == "error") && it->value("id", -1) == id) return *it;
        }
        return Json();
    }

    Json configure(const char* fromPort, Json part) {
        cmd(Json{{"t", "hello"}, {"protocol", 1}});
        return cmd(Json{{"t", "configure"},
                        {"board", "tang-nano-20k"},
                        {"clock", Json{{"port", "clk"}, {"hz", kHz}}},
                        {"nets", Json::array({
                                     Json{{"pin", 4}, {"port", "clk"}, {"bit", 0}, {"pull", "none"}},
                                     Json{{"pin", 69}, {"port", fromPort}, {"bit", 0}, {"pull", "none"}},
                                     Json{{"pin", 70}, {"port", "rx"}, {"bit", 0}, {"pull", "up"}},
                                 })},
                        {"parts", Json::array({std::move(part)})},
                        {"watch", Json::array()}});
    }

    void stepNs(uint64_t ns) {
        const size_t before = host.frames.size();
        cmd(Json{{"t", "step"}, {"unit", "time"}, {"ps", timeToString(ns * 1000)}});
        for (int i = 0; i < 1000000 && host.frames.size() == before; ++i) rt.tick(host.clock);
    }

    std::vector<uint8_t> received() const {
        std::vector<uint8_t> out;
        for (const PartDataMsg& m : host.partData) {
            if (m.channel == 0) out.insert(out.end(), m.bytes.begin(), m.bytes.end());
        }
        return out;
    }

    // Last state of part 0 from the frames.
    std::vector<uint8_t> state() const {
        for (auto it = host.frames.rbegin(); it != host.frames.rend(); ++it) {
            for (const FramePart& p : it->frame.parts) {
                if (p.index == 0) return p.state;
            }
        }
        return {};
    }

    std::vector<Json> events(const std::string& name) const {
        std::vector<Json> out;
        for (const Json& m : host.ofType("partEvent")) {
            if (m.value("event", "") == name) out.push_back(m);
        }
        return out;
    }

    TestHost host;
    ScriptEngine* engine;
    Runtime rt;
    int nextId = 1;
};

uint32_t u32At(const std::vector<uint8_t>& bytes, size_t at) {
    return bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (static_cast<uint32_t>(bytes[at + 3]) << 24);
}

Json uartPart(int baud) {
    return Json{{"id", "u"},
                {"type", "uart"},
                {"pins", Json{{"fromFpga", 69}, {"toFpga", 70}}},
                {"settings", Json{{"baud", baud}}}};
}

// UART waveform: 8N1 frames with a bit length of bitCycles clocks. The line starts at one.
struct UartWave {
    explicit UartWave(uint64_t bitCycles) : bit(bitCycles) {}

    void level(bool value, uint64_t bits) {
        if (value != current) {
            toggles.push_back(at);
            current = value;
        }
        at += bits * bit;
    }
    void byte(uint8_t value, bool stop = true) {
        level(false, 1);
        for (int i = 0; i < 8; ++i) level((value >> i) & 1, 1);
        level(stop, 1);
    }

    uint64_t bit;
    uint64_t at = 100;  // clock index of the next boundary
    bool current = true;
    std::vector<uint64_t> toggles;
};

// WS2812 waveform: durations in nanoseconds (clocks of 1 GHz).
struct LedWave {
    void bit(uint64_t highNs, uint64_t periodNs) {
        toggles.push_back(at);
        toggles.push_back(at + highNs);
        at += periodNs;
    }
    void byte(uint8_t value, uint64_t zeroNs = 350, uint64_t oneNs = 700, uint64_t periodNs = 1250) {
        for (int i = 7; i >= 0; --i) bit((value >> i) & 1 ? oneNs : zeroNs, periodNs);
    }
    void pause(uint64_t ns) { at += ns; }

    uint64_t at = 1000;
    std::vector<uint64_t> toggles;
};

Json ledPart(int count, const char* order = "GRB") {
    return Json{{"id", "ws"},
                {"type", "ws2812"},
                {"pins", Json{{"din", 69}}},
                {"settings", Json{{"count", count}, {"order", order}}}};
}

std::vector<uint8_t> colors(const std::vector<uint8_t>& state) {
    return state.size() < 8 ? std::vector<uint8_t>{} : std::vector<uint8_t>(state.begin() + 8, state.end());
}

}  // namespace

TEST_CASE("uart: 256 байтов уходят в ПЛИС и возвращаются по петле без потерь", "[parts][uart]") {
    Stand s(std::make_unique<ScriptEngine>());
    REQUIRE(isOk(s.configure("tx", uartPart(115200))));
    // The toFpga line holds 1 at rest.
    CHECK(s.host.frames.back().frame.nets[2].level == 1);
    CHECK(s.host.frames.back().frame.nets[2].flags == kNetPart);

    Json bytes = Json::array();
    std::vector<uint8_t> want;
    for (int i = 0; i < 256; ++i) {
        bytes.push_back(i);
        want.push_back(static_cast<uint8_t>(i));
    }
    REQUIRE(isOk(s.cmd(Json{{"t", "part"}, {"part", "u"}, {"cmd", "send"}, {"args", Json{{"bytes", bytes}}}})));
    s.stepNs(10'000'000);  // 10 ms: part of it is sent
    std::vector<uint8_t> state = s.state();
    REQUIRE(state.size() == 12);
    CHECK(u32At(state, 0) > 100);                     // received
    CHECK(u32At(state, 4) + u32At(state, 8) == 256);  // sent and in the queue
    s.stepNs(15'000'000);
    CHECK(s.received() == want);
    state = s.state();
    CHECK(u32At(state, 0) == 256);
    CHECK(u32At(state, 4) == 256);
    CHECK(u32At(state, 8) == 0);
    CHECK(s.host.ofType("partEvent").empty());

    // Bytes in PART_DATA from the interface also go into the transmit queue.
    s.host.partData.clear();
    std::vector<uint8_t> msg;
    const uint8_t hi[] = {72, 105};
    encodePartData(msg, 0, 0, 0, 0, hi);
    s.rt.binary(msg);
    s.stepNs(1'000'000);
    CHECK(s.received() == std::vector<uint8_t>{72, 105});

    // Reset clears the counters and the queue.
    s.cmd(Json{{"t", "part"}, {"part", "u"}, {"cmd", "send"}, {"args", Json{{"bytes", bytes}}}});
    s.cmd(Json{{"t", "reset"}});
    s.host.partData.clear();
    s.stepNs(2'000'000);
    CHECK(s.received().empty());
    CHECK(u32At(s.state(), 0) == 0);
    CHECK(u32At(s.state(), 4) == 0);
    CHECK(u32At(s.state(), 8) == 0);
    CHECK(s.host.badBinary == 0);
}

TEST_CASE("uart: приём при совпадающей скорости; 9600 против 115 200 даёт baudMismatch", "[parts][uart]") {
    // Bit length 8681 clocks of 1 ns: 115194 baud.
    const auto build = [] {
        auto engine = std::make_unique<ScriptEngine>();
        engine->waveInit = true;
        UartWave wave(8681);
        for (int i = 0; i < 40; ++i) wave.byte(static_cast<uint8_t>('A' + i % 26));
        engine->toggles = wave.toggles;
        return engine;
    };
    std::vector<uint8_t> want;
    for (int i = 0; i < 40; ++i) want.push_back(static_cast<uint8_t>('A' + i % 26));

    Stand good(build());
    REQUIRE(isOk(good.configure("wave", uartPart(115200))));
    good.stepNs(40'000'000);
    CHECK(good.received() == want);
    CHECK(good.host.ofType("partEvent").empty());

    Stand bad(build());
    REQUIRE(isOk(bad.configure("wave", uartPart(9600))));
    bad.stepNs(40'000'000);
    const std::vector<Json> events = bad.events("baudMismatch");
    REQUIRE(events.size() == 1);  // at most once per second
    const double estimate = events[0]["data"]["baud"].get<double>();
    CHECK(estimate > 115200 * 0.95);
    CHECK(estimate < 115200 * 1.05);
    CHECK(events[0]["data"]["setting"] == 9600);
    CHECK(events[0]["part"] == "u");

    // Changing the setting to the right one: no more events, reception works.
    Stand fixed(build());
    REQUIRE(isOk(fixed.configure("wave", uartPart(9600))));
    REQUIRE(isOk(fixed.cmd(Json{{"t", "partSettings"}, {"part", "u"}, {"settings", Json{{"baud", 115200}}}})));
    fixed.stepNs(40'000'000);
    CHECK(fixed.received() == want);
    CHECK(fixed.events("baudMismatch").empty());
}

TEST_CASE("uart: байты без одиночных битов при верной скорости baudMismatch не дают", "[parts][uart]") {
    auto engine = std::make_unique<ScriptEngine>();
    engine->waveInit = true;
    UartWave wave(8681);
    for (int i = 0; i < 40; ++i) {
        wave.byte(0x30);  // shortest pulse is two bits
        wave.level(true, 20);
    }
    engine->toggles = wave.toggles;
    Stand s(std::move(engine));
    REQUIRE(isOk(s.configure("wave", uartPart(115200))));
    s.stepNs(20'000'000);
    CHECK(s.received() == std::vector<uint8_t>(40, 0x30));
    CHECK(s.host.ofType("partEvent").empty());
}

TEST_CASE("uart: смена скорости на ходу; порядок цветов ws2812 меняется без нового кадра", "[parts]") {
    // Loop: transmission starts at 9600, the rate changes to 115200 in the middle of a byte.
    Stand s(std::make_unique<ScriptEngine>());
    REQUIRE(isOk(s.configure("tx", uartPart(9600))));
    const Json bytes = Json::array({0x55, 0xa3, 0x00, 0xff});
    REQUIRE(isOk(s.cmd(Json{{"t", "part"}, {"part", "u"}, {"cmd", "send"}, {"args", Json{{"bytes", bytes}}}})));
    s.stepNs(400'000);  // about four bits of the first byte
    REQUIRE(isOk(s.cmd(Json{{"t", "partSettings"}, {"part", "u"}, {"settings", Json{{"baud", 115200}}}})));
    s.stepNs(2'000'000);
    // The interrupted byte is sent again in full, with no losses and no extra bytes.
    CHECK(s.received() == std::vector<uint8_t>{0x55, 0xa3, 0x00, 0xff});
    CHECK(u32At(s.state(), 4) == 4);
    CHECK(s.events("framingError").empty());

    auto engine = std::make_unique<ScriptEngine>();
    LedWave wave;
    for (const uint8_t b : {0x10, 0x20, 0x30}) wave.byte(static_cast<uint8_t>(b));
    engine->toggles = wave.toggles;
    Stand led(std::move(engine));
    REQUIRE(isOk(led.configure("wave", ledPart(1))));
    led.stepNs(100'000);
    CHECK(colors(led.state()) == std::vector<uint8_t>{0x20, 0x10, 0x30});
    REQUIRE(isOk(led.cmd(Json{{"t", "partSettings"}, {"part", "ws"}, {"settings", Json{{"order", "RGB"}}}})));
    led.stepNs(1'000);
    CHECK(colors(led.state()) == std::vector<uint8_t>{0x10, 0x20, 0x30});
}

TEST_CASE("uart: нулевой стоповый бит даёт framingError, приём продолжается", "[parts][uart]") {
    auto engine = std::make_unique<ScriptEngine>();
    engine->waveInit = true;
    UartWave wave(8681);
    wave.byte(0x41);
    wave.byte(0x42, false);  // stop bit is zero
    wave.level(true, 3);
    wave.byte(0x43);
    engine->toggles = wave.toggles;
    Stand s(std::move(engine));
    REQUIRE(isOk(s.configure("wave", uartPart(115200))));
    s.stepNs(1'000'000);
    CHECK(s.received() == std::vector<uint8_t>{0x41, 0x43});
    const std::vector<Json> events = s.events("framingError");
    REQUIRE(events.size() == 1);
    CHECK(events[0]["data"]["count"] == 1);
}

TEST_CASE("ws2812: тройки защёлкиваются после паузы; порядок GRB и RGB; лишние биты отброшены", "[parts][ws2812]") {
    const auto build = [] {
        auto engine = std::make_unique<ScriptEngine>();
        LedWave wave;
        const uint8_t first[] = {0x10, 0x20, 0x30, 0xff, 0x00, 0x80, 0x01, 0x02, 0x03, 0xaa, 0xbb, 0xcc};
        for (const uint8_t b : first) wave.byte(b);  // four triples for three LEDs
        wave.pause(60'000);
        const uint8_t second[] = {0x55, 0x66, 0x77};  // data for the first LED only
        for (const uint8_t b : second) wave.byte(b);
        engine->toggles = wave.toggles;
        return engine;
    };
    Stand s(build());
    REQUIRE(isOk(s.configure("wave", ledPart(3))));
    std::vector<uint8_t> state = s.state();
    REQUIRE(state.size() == 8 + 9);
    CHECK(state[0] == 3);
    CHECK(colors(state) == std::vector<uint8_t>(9, 0));

    s.stepNs(150'000);  // data received (96 bits take 120 us), the 50 us pause has not passed yet
    CHECK(colors(s.state()) == std::vector<uint8_t>(9, 0));
    s.stepNs(40'000);  // the pause has passed
    CHECK(colors(s.state()) == std::vector<uint8_t>{0x20, 0x10, 0x30, 0x00, 0xff, 0x80, 0x02, 0x01, 0x03});
    s.stepNs(150'000);  // second frame: the other LEDs keep their color
    state = s.state();
    CHECK(colors(state) == std::vector<uint8_t>{0x66, 0x55, 0x77, 0x00, 0xff, 0x80, 0x02, 0x01, 0x03});
    CHECK(u32At(state, 4) == 0);
    CHECK(s.host.ofType("partEvent").empty());

    Stand rgb(build());
    REQUIRE(isOk(rgb.configure("wave", ledPart(3, "RGB"))));
    rgb.stepNs(190'000);
    CHECK(colors(rgb.state()) == std::vector<uint8_t>{0x10, 0x20, 0x30, 0xff, 0x00, 0x80, 0x01, 0x02, 0x03});

    // Reset turns the LEDs off.
    rgb.cmd(Json{{"t", "reset"}});
    CHECK(colors(rgb.state()) == std::vector<uint8_t>(9, 0));
}

TEST_CASE("ws2812: импульс и период вне окон дают timingError раз на защёлкивание", "[parts][ws2812]") {
    auto engine = std::make_unique<ScriptEngine>();
    LedWave wave;
    wave.byte(0xff);
    wave.byte(0x00, 520);  // eight zeros with a high of 520 ns: between the windows
    wave.byte(0x0f);
    wave.pause(60'000);
    wave.byte(0x01);
    wave.bit(350, 2500);  // period outside 900-1900 ns
    for (int i = 0; i < 15; ++i) wave.bit(350, 1250);
    wave.pause(60'000);
    for (int i = 0; i < 24; ++i) wave.bit(700, 1250);  // frame without errors
    engine->toggles = wave.toggles;
    Stand s(std::move(engine));
    REQUIRE(isOk(s.configure("wave", ledPart(1))));

    s.stepNs(100'000);
    std::vector<Json> events = s.events("timingError");
    REQUIRE(events.size() == 1);
    CHECK(events[0]["data"]["highNs"] == 520);
    CHECK(events[0]["data"]["bit"] == 8);
    CHECK(events[0]["data"]["count"] == 8);
    CHECK(events[0]["data"]["total"] == 8);
    // A 520 ns pulse reads as 0 (the nearest window).
    CHECK(colors(s.state()) == std::vector<uint8_t>{0x00, 0xff, 0x0f});
    CHECK(u32At(s.state(), 4) == 8);

    s.stepNs(100'000);
    events = s.events("timingError");
    REQUIRE(events.size() == 2);
    CHECK(events[1]["data"]["periodNs"] == 2500);
    CHECK(events[1]["data"]["bit"] == 8);  // the bit whose period was measured
    CHECK(events[1]["data"]["count"] == 1);
    CHECK(events[1]["data"]["total"] == 9);

    s.stepNs(100'000);
    CHECK(s.events("timingError").size() == 2);
    CHECK(colors(s.state()) == std::vector<uint8_t>{0xff, 0xff, 0xff});
    CHECK(u32At(s.state(), 4) == 9);
}
