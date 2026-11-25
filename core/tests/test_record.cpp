// Recording (spec section 5.5) and TRACE messages.
#include <catch2/catch_test_macros.hpp>

#include "harness.h"

using namespace fpgasim;
using namespace fpgasim::test;

namespace {

constexpr uint64_t kHz = 27'000'000;

// Time of the rising edge of clock number n (counted from one).
Time riseOf(uint64_t n) { return halfStart(kHz, 2 * (n - 1)); }

int startRecord(Sim& sim, Json msg) {
    msg["t"] = "recordStart";
    const Json reply = sim.cmd(std::move(msg));
    REQUIRE(isOk(reply));
    return reply["record"];
}

std::vector<TraceMsg> fetch(Sim& sim, int record, Json extra = Json::object()) {
    sim.host.traces.clear();
    extra["t"] = "recordFetch";
    extra["record"] = record;
    REQUIRE(isOk(sim.cmd(std::move(extra))));
    CHECK(sim.host.ofType("recordEnd").back()["record"] == record);
    return sim.host.traces;
}

Json lastRecordState(const Sim& sim) { return sim.host.ofType("recordState").back(); }

}  // namespace

TEST_CASE("кольцо на 1000 изменений после 10 000 содержит последние 1000", "[record]") {
    Sim sim(1u << 30);
    sim.configure();
    const int record =
        startRecord(sim, Json{{"signals", Json::array({FakeEngine::kCnt})}, {"mode", "ring"}, {"depth", 1000}});
    CHECK(sim.engine->tracked() == std::vector<uint32_t>{FakeEngine::kCnt});
    sim.stepCycles(10000);
    const std::vector<TraceMsg> traces = fetch(sim, record);
    REQUIRE(traces.size() == 1);
    const TraceMsg& t = traces[0];
    REQUIRE(t.changes.size() == 1001);
    // The value at the segment start is what was pushed out last: counter 9000 at clock 9000.
    CHECK(t.fromPs == riseOf(9000));
    CHECK(t.changes[0].t == t.fromPs);
    CHECK(t.changes[0].index == 0);
    CHECK(t.changes[0].words == std::vector<uint32_t>{9000});
    for (uint32_t i = 1; i <= 1000; ++i) {
        REQUIRE(t.changes[i].words == std::vector<uint32_t>{9000 + i});
        REQUIRE(t.changes[i].t == riseOf(9000 + i));
    }
    CHECK(t.toPs == halfStart(kHz, 20000));
    CHECK(t.header.time == halfStart(kHz, 20000));
    const Json state = lastRecordState(sim);
    CHECK(state["state"] == "recording");

    // After the stop the engine no longer tracks the signal, and the recording stays available.
    sim.cmd(Json{{"t", "recordStop"}});
    CHECK(sim.engine->tracked().empty());
    CHECK(lastRecordState(sim)["state"] == "stopped");
    CHECK(lastRecordState(sim)["changes"] == 1000);
    CHECK(lastRecordState(sim)["fromPs"] == timeToString(riseOf(9000)));
    CHECK(lastRecordState(sim)["toPs"] == timeToString(halfStart(kHz, 20000)));
    sim.stepCycles(100);
    CHECK(fetch(sim, record)[0].changes.size() == 1001);
    // reset erases the recording.
    sim.cmd(Json{{"t", "reset"}});
    CHECK(errorCode(sim.cmd(Json{{"t", "recordFetch"}, {"record", record}})) == "UNKNOWN_RECORD");
}

TEST_CASE("окно с условием по фронту сети начинается в момент фронта", "[record]") {
    Sim sim(4);  // q on pin 17: up at clock 4, down at clock 8
    sim.configure();
    const Time window = 20 * 37037;
    sim.host.clear();
    const int record = startRecord(sim, Json{{"signals", Json::array({FakeEngine::kCnt, "pin:17"})},
                                             {"mode", "window"},
                                             {"windowPs", timeToString(window)},
                                             {"trigger", Json{{"signal", "pin:17"}, {"edge", "rise"}}}});
    CHECK(lastRecordState(sim)["state"] == "armed");
    CHECK(lastRecordState(sim)["changes"] == 0);
    sim.stepCycles(2);
    CHECK(lastRecordState(sim)["state"] == "armed");
    sim.stepCycles(98);
    const std::vector<Json> states = sim.host.ofType("recordState");
    REQUIRE(states.size() == 3);
    CHECK(states[1]["state"] == "recording");
    CHECK(states[1]["fromPs"] == timeToString(riseOf(4)));
    CHECK(states[2]["state"] == "done");
    CHECK(states[2]["fromPs"] == timeToString(riseOf(4)));
    CHECK(states[2]["toPs"] == timeToString(riseOf(4) + window));
    CHECK(sim.engine->tracked().empty());  // recording ended: tracking is removed

    const std::vector<TraceMsg> traces = fetch(sim, record);
    REQUIRE(traces.size() == 1);
    const TraceMsg& t = traces[0];
    CHECK(t.fromPs == riseOf(4));  // exactly at the edge time
    CHECK(t.toPs == riseOf(4) + window);
    // The values at the segment start already include the edge itself.
    REQUIRE(t.changes.size() > 2);
    CHECK(t.changes[0].words == std::vector<uint32_t>{4});
    CHECK(t.changes[1].index == 1);
    CHECK(t.changes[1].words == std::vector<uint32_t>{1});
    uint32_t cnt = 4;
    uint32_t qChanges = 0;
    for (size_t i = 2; i < t.changes.size(); ++i) {
        CHECK(t.changes[i].t > t.fromPs);
        CHECK(t.changes[i].t < t.toPs);
        if (t.changes[i].index == 0) {
            CHECK(t.changes[i].words[0] == ++cnt);
        } else {
            ++qChanges;
        }
    }
    CHECK(cnt == 4 + 19);  // clocks 5...23 fall in a window of 20 periods
    CHECK(qChanges == 4);  // clocks 8, 12, 16, 20
}

TEST_CASE("условие запуска по сигналу вне списка записи и по спаду", "[record]") {
    Sim sim(4);
    sim.configure();
    const int record = startRecord(sim, Json{{"signals", Json::array({FakeEngine::kCnt})},
                                             {"mode", "ring"},
                                             {"trigger", Json{{"signal", FakeEngine::kQ}, {"edge", "fall"}}}});
    CHECK(sim.engine->tracked() == std::vector<uint32_t>{FakeEngine::kCnt, FakeEngine::kQ});
    sim.stepCycles(12);
    const std::vector<TraceMsg> traces = fetch(sim, record);
    REQUIRE(traces.size() == 1);
    CHECK(traces[0].fromPs == riseOf(8));  // first fall of q
    REQUIRE(traces[0].changes.size() == 1 + 4);
    CHECK(traces[0].changes[0].words == std::vector<uint32_t>{8});
    CHECK(traces[0].changes[4].words == std::vector<uint32_t>{12});
    // The info list has no trigger condition.
    CHECK(sim.host.ofType("ok").back()["info"].size() == 1);

    // The change condition fires on any change of a multi-bit signal.
    const int second = startRecord(sim, Json{{"signals", Json::array({"pin:17"})},
                                             {"mode", "ring"},
                                             {"trigger", Json{{"signal", FakeEngine::kCnt}, {"edge", "change"}}}});
    CHECK(second == record + 1);
    CHECK(errorCode(sim.cmd(Json{{"t", "recordFetch"}, {"record", record}})) == "UNKNOWN_RECORD");
    sim.stepCycles(1);
    CHECK(fetch(sim, second)[0].fromPs == riseOf(13));
}

TEST_CASE("запись, остановленная до срабатывания условия, отдаёт текущие значения", "[record]") {
    Sim sim(1u << 30);  // q does not change: the condition will not fire
    sim.configure();
    const int record = startRecord(sim, Json{{"signals", Json::array({FakeEngine::kCnt})},
                                             {"mode", "ring"},
                                             {"trigger", Json{{"signal", "pin:17"}, {"edge", "rise"}}}});
    sim.stepCycles(50);
    // While the recording waits for its condition, the values at the current moment are delivered.
    std::vector<TraceMsg> traces = fetch(sim, record);
    REQUIRE(traces[0].changes.size() == 1);
    CHECK(traces[0].changes[0].words == std::vector<uint32_t>{50});
    sim.stepCycles(25);
    sim.cmd(Json{{"t", "recordStop"}});
    CHECK(lastRecordState(sim)["state"] == "stopped");
    CHECK(lastRecordState(sim)["changes"] == 0);
    CHECK(lastRecordState(sim)["fromPs"] == timeToString(halfStart(kHz, 150)));
    traces = fetch(sim, record);
    REQUIRE(traces.size() == 1);
    REQUIRE(traces[0].changes.size() == 1);
    CHECK(traces[0].changes[0].words == std::vector<uint32_t>{75});
    CHECK(traces[0].fromPs == halfStart(kHz, 150));
    CHECK(traces[0].toPs == halfStart(kHz, 150));
}

TEST_CASE("окно заполнено раньше срока: RECORD_OVERFLOW", "[record]") {
    Sim sim(1u << 30);
    sim.configure();
    sim.host.clear();
    const int record = startRecord(sim, Json{{"signals", Json::array({FakeEngine::kCnt})},
                                             {"mode", "window"},
                                             {"depth", 5},
                                             {"windowPs", "1000000000000"}});
    sim.stepCycles(50);
    CHECK(sim.host.noticeCodes() == std::vector<std::string>{"RECORD_OVERFLOW"});
    CHECK(lastRecordState(sim)["state"] == "done");
    CHECK(lastRecordState(sim)["changes"] == 5);
    CHECK(lastRecordState(sim)["toPs"] == timeToString(riseOf(6)));
    const std::vector<TraceMsg> traces = fetch(sim, record);
    REQUIRE(traces[0].changes.size() == 6);
    CHECK(traces[0].changes[5].words == std::vector<uint32_t>{5});
    // A window without a condition starts at once and ends on time even without changes.
    sim.host.clear();
    const int quiet =
        startRecord(sim, Json{{"signals", Json::array({"pin:88"})}, {"mode", "window"}, {"windowPs", "1000"}});
    CHECK(lastRecordState(sim)["state"] == "recording");
    sim.stepCycles(1);
    CHECK(lastRecordState(sim)["state"] == "done");
    CHECK(fetch(sim, quiet)[0].changes.size() == 1);
    CHECK(fetch(sim, quiet)[0].toPs - fetch(sim, quiet)[0].fromPs == 1000);
}

TEST_CASE("запись длиннее 1 МБ уходит несколькими TRACE", "[record]") {
    Sim sim(1u << 30);
    sim.configure();
    const uint32_t total = 100'000;
    const int record = startRecord(
        sim, Json{{"signals", Json::array({FakeEngine::kCnt, FakeEngine::kLed})}, {"mode", "ring"}, {"depth", total}});
    sim.stepCycles(total);
    sim.host.clear();
    const std::vector<TraceMsg> traces = fetch(sim, record);
    REQUIRE(traces.size() == 2);  // a change takes 16 bytes: 100,000 changes are 1.6 MB
    uint32_t next = 1;
    for (size_t m = 0; m < traces.size(); ++m) {
        const TraceMsg& t = traces[m];
        CHECK(t.bytes <= kTraceMaxBytes);
        CHECK(t.header.seq == traces[0].header.seq + m);
        // Each message starts with the values of all signals at its own start.
        REQUIRE(t.changes.size() > 2);
        CHECK(t.changes[0].t == t.fromPs);
        CHECK(t.changes[0].index == 0);
        CHECK(t.changes[0].words == std::vector<uint32_t>{next - 1});
        CHECK(t.changes[1].t == t.fromPs);
        CHECK(t.changes[1].index == 1);
        CHECK(t.changes[1].words == std::vector<uint32_t>{0b000011});
        for (size_t i = 2; i < t.changes.size(); ++i) {
            REQUIRE(t.changes[i].words[0] == next++);
            REQUIRE(t.changes[i].t >= t.fromPs);
            REQUIRE(t.changes[i].t <= t.toPs);
        }
        if (m > 0) CHECK(t.fromPs == traces[m - 1].toPs);
    }
    CHECK(next == total + 1);
    CHECK(traces[0].fromPs == 0);
    CHECK(traces[1].toPs == halfStart(kHz, 2 * total));
    CHECK(traces[0].bytes > kTraceMaxBytes - 64);
    CHECK(sim.host.badBinary == 0);
}

TEST_CASE("recordFetch с границами отдаёт участок со значениями на его начало", "[record]") {
    Sim sim(1u << 30);
    sim.configure();
    const int record = startRecord(sim, Json{{"signals", Json::array({FakeEngine::kCnt})}, {"mode", "ring"}});
    sim.stepCycles(100);
    const std::vector<TraceMsg> part =
        fetch(sim, record, Json{{"fromPs", timeToString(riseOf(41))}, {"toPs", timeToString(riseOf(50))}});
    REQUIRE(part.size() == 1);
    CHECK(part[0].fromPs == riseOf(41));
    CHECK(part[0].toPs == riseOf(50));
    REQUIRE(part[0].changes.size() == 1 + 10);
    CHECK(part[0].changes[0].words == std::vector<uint32_t>{40});  // value before the first change of the segment
    CHECK(part[0].changes[1].words == std::vector<uint32_t>{41});
    CHECK(part[0].changes[10].words == std::vector<uint32_t>{50});
    // Bounds wider than the recording are clipped to it; a segment without changes holds only the initial values.
    const std::vector<TraceMsg> wide = fetch(sim, record, Json{{"fromPs", "0"}, {"toPs", "999999999999999"}});
    CHECK(wide[0].changes.size() == 101);
    CHECK(wide[0].toPs == halfStart(kHz, 200));
    const std::vector<TraceMsg> empty =
        fetch(sim, record, Json{{"fromPs", timeToString(riseOf(50) + 1)}, {"toPs", timeToString(riseOf(50) + 2)}});
    REQUIRE(empty[0].changes.size() == 1);
    CHECK(empty[0].changes[0].words == std::vector<uint32_t>{50});
    const std::vector<TraceMsg> inverted = fetch(sim, record, Json{{"fromPs", "5000"}, {"toPs", "10"}});
    CHECK(inverted[0].fromPs == inverted[0].toPs);
}

TEST_CASE("запись широкого сигнала и тактового вывода", "[record]") {
    Sim sim(1u << 30);
    sim.configure();
    const int record = startRecord(sim, Json{{"signals", Json::array({FakeEngine::kWide, "pin:4"})}, {"mode", "ring"}});
    sim.stepCycles(3);
    const std::vector<TraceMsg> traces = fetch(sim, record);
    CHECK(sim.host.ofType("ok").back()["info"] == Json::array({Json{{"index", 0}, {"name", "top.wide"}, {"width", 70}},
                                                               Json{{"index", 1}, {"name", "pin:4"}, {"width", 1}}}));
    const TraceMsg& t = traces[0];
    REQUIRE(t.changes.size() == 2 + 3 + 6);
    CHECK(t.changes[0].words == std::vector<uint32_t>{0, 0, 0x2a});
    // The clock pin is recorded as the signal of the clock port: a change on every half-cycle.
    uint32_t wide = 0, clk = 0;
    for (size_t i = 2; i < t.changes.size(); ++i) {
        if (t.changes[i].index == 0) {
            CHECK(t.changes[i].words == std::vector<uint32_t>{++wide, 0, 0x2a});
        } else {
            CHECK(t.changes[i].words == std::vector<uint32_t>{clk % 2 == 0 ? 1u : 0u});
            CHECK(t.changes[i].t == halfStart(kHz, clk));
            ++clk;
        }
    }
    CHECK(wide == 3);
    CHECK(clk == 6);
}

TEST_CASE("во время записи состояние приходит не чаще раза в секунду", "[record]") {
    Sim sim(1u << 30);
    sim.configure();
    startRecord(sim, Json{{"signals", Json::array({"pin:88"})}, {"mode", "ring"}});
    sim.cmd(Json{{"t", "run"}, {"speed", 1e-3}});
    sim.host.clear();
    for (int i = 0; i < 250; ++i) sim.tick(16);  // 4 s of real time
    const std::vector<Json> states = sim.host.ofType("recordState");
    CHECK(states.size() >= 3);
    CHECK(states.size() <= 4);
    CHECK(states.back()["state"] == "recording");
    CHECK(states.back()["changes"] == 0);
    // Recording memory is limited to 64 MB: two million changes of a 512-bit signal do not fit.
    const auto huge = [&](int depth) {
        return sim.cmd(Json{
            {"t", "recordStart"}, {"signals", Json::array({FakeEngine::kHuge})}, {"mode", "ring"}, {"depth", depth}});
    };
    const Json tooBig = huge(2'000'000);
    CHECK(errorCode(tooBig) == "RECORD_INVALID");
    CHECK(tooBig["args"] == Json{{"reason", "recordMemory"}, {"megabytes", 64}});
    CHECK(isOk(huge(100'000)));
}
