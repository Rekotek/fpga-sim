// Scheduler: steps, chunks, speed multiplier (spec sections 5.2 and 5.3).
#include <catch2/catch_test_macros.hpp>
#include <cmath>

#include "harness.h"

using namespace fpgasim;
using namespace fpgasim::test;

namespace {
constexpr uint64_t kHz = 27'000'000;
}

TEST_CASE("шаг на N тактов выполняет ровно N передних фронтов", "[scheduler]") {
    Sim sim;
    sim.configure();
    sim.cmd(Json{{"t", "watch"}, {"signals", Json::array({FakeEngine::kCnt})}});
    sim.stepCycles(1);
    CHECK(sim.frame().cycle == 1);
    CHECK(sim.frame().watch[0].words[0] == 1);
    CHECK(sim.frameTime() == halfStart(kHz, 2));
    CHECK(sim.frame().spanPs == halfStart(kHz, 2));
    sim.stepCycles(999);
    CHECK(sim.frame().cycle == 1000);
    CHECK(sim.frame().watch[0].words[0] == 1000);
    CHECK(sim.frameTime() == halfStart(kHz, 2000));
    CHECK(sim.engine->halfSteps == 2000);
    // Clock net: level, toggles and fraction are counted by the number of half-cycles.
    CHECK(sim.frame().nets[kNetClk].toggles == 1998);
    CHECK(sim.frame().nets[kNetClk].level == 0);
    CHECK(sim.frame().nets[kNetClk].flags == 0);
    CHECK(std::fabs(sim.frame().nets[kNetClk].duty - 0.5f) < 0.001f);
}

TEST_CASE("шаг по времени: выполняются полутакты, начавшиеся до цели", "[scheduler]") {
    Sim sim(1u << 30);
    sim.configure();
    // Exactly 1 s: half-cycle 54,000,000 starts at 10^12 ps and is not part of the step.
    sim.stepTime(kPsPerSecond);
    CHECK(sim.frameTime() == kPsPerSecond);
    CHECK(sim.frame().spanPs == kPsPerSecond);
    CHECK(sim.engine->halfSteps == 54'000'000);
    CHECK(sim.frame().cycle == 27'000'000);
    sim.stepTime(1);  // it executes as soon as time passes its start
    CHECK(sim.engine->halfSteps == 54'000'001);
    CHECK(sim.frame().cycle == 27'000'001);
    CHECK(sim.frame().nets[kNetClk].level == 1);
    sim.stepTime(18517);
    CHECK(sim.engine->halfSteps == 54'000'001);
    sim.stepTime(1);
    CHECK(sim.engine->halfSteps == 54'000'002);
}

TEST_CASE("длинный шаг делится на порции по бюджету настоящего времени, кадр один", "[scheduler]") {
    Sim sim(1u << 30);
    sim.configure();
    sim.host.perCallMs = 5;  // each clock poll costs 5 ms: the chunk ends after three packets
    sim.host.clear();
    REQUIRE(isOk(sim.cmd(Json{{"t", "step"}, {"unit", "cycle"}, {"count", 1'000'000}})));
    int ticks = 0;
    while (sim.host.frames.empty()) {
        sim.tick(16);
        ++ticks;
        REQUIRE(ticks < 1000);
    }
    CHECK(ticks > 5);
    CHECK(sim.host.frames.size() == 1);
    CHECK(sim.frame().cycle == 1'000'000);
    CHECK(sim.frame().spanPs == halfStart(kHz, 2'000'000));
    CHECK(sim.frame().realUs > 0);
    CHECK(sim.host.ofType("state").size() == 1);
    // While a step runs, a new step is not accepted; pause interrupts it.
    sim.cmd(Json{{"t", "step"}, {"unit", "cycle"}, {"count", 1'000'000}});
    sim.tick(16);
    CHECK(errorCode(sim.cmd(Json{{"t", "step"}, {"unit", "cycle"}, {"count", 1}})) == "BAD_STATE");
    sim.host.clear();
    REQUIRE(isOk(sim.cmd(Json{{"t", "pause"}})));
    CHECK(sim.host.frames.size() == 1);
    CHECK(sim.frame().cycle > 1'000'000);
    CHECK(sim.frame().cycle < 2'000'000);
    sim.tick(16);
    CHECK(sim.host.frames.size() == 1);
}

TEST_CASE("шаг до изменения останавливается на первом переключении выхода", "[scheduler]") {
    Sim sim(1000);
    sim.configure();
    sim.step(Json{{"unit", "change"}});
    // q toggles at clock 1000: that is a rising edge, half-cycle number 1998.
    CHECK(sim.frame().cycle == 1000);
    CHECK(sim.frameTime() == halfStart(kHz, 1998));
    CHECK(sim.frame().nets[kNetLed2].level == 1);
    CHECK(sim.frame().nets[kNetLed2].toggles == 1);
    sim.step(Json{{"unit", "change"}});
    CHECK(sim.frame().cycle == 2000);
    CHECK(sim.frame().nets[kNetLed2].level == 0);

    // Without changes a step runs at most 1 s of simulation time.
    Sim quiet(1u << 30);
    quiet.configure();
    quiet.step(Json{{"unit", "change"}});
    CHECK(quiet.frameTime() == kPsPerSecond);
    CHECK(quiet.frame().nets[kNetLed2].toggles == 0);

    // An input change from a part also stops the step.
    Sim pressed(1u << 30);
    Json cfg = defaultConfigure();
    cfg["parts"][1]["settings"]["bounceMs"] = 5;
    pressed.configure(cfg);
    pressed.part("s1", "press");
    pressed.step(Json{{"unit", "change"}});
    CHECK(pressed.frameTime() > 0);
    CHECK(pressed.frameTime() <= 2'000'000'000ull);      // first bounce toggle, no later than 2 ms
    CHECK(pressed.frame().nets[kNetLed0].toggles == 2);  // the press itself and the first bounce toggle
}

TEST_CASE("доля времени в единице за целое число периодов равна 0,5", "[scheduler]") {
    Sim sim(4);  // q: period of 8 clocks
    sim.configure();
    sim.stepCycles(8000);
    const FrameNet& q = sim.frame().nets[kNetLed2];
    CHECK(q.toggles == 2000);
    CHECK(std::fabs(q.duty - 0.5f) < 0.001f);
    CHECK(q.flags == kNetFpga);
    // Unchanged output: the fraction equals the level.
    CHECK(sim.frame().nets[kNetLed0].duty == 1.0f);
    CHECK(sim.frame().nets[kNetLed0].toggles == 0);
    CHECK(sim.frame().nets[kNetLed3].duty == 0.0f);
    // A quarter period: the output is at zero all the time, then three quarters: fraction 2/3.
    sim.cmd(Json{{"t", "reset"}});
    sim.stepCycles(2);
    CHECK(sim.frame().nets[kNetLed2].duty == 0.0f);
    sim.stepCycles(6);
    CHECK(std::fabs(sim.frame().nets[kNetLed2].duty - 4.0f / 6.0f) < 0.01f);
}

TEST_CASE("ход с множителем: цель — настоящее время на множитель, остаток переносится", "[scheduler]") {
    Sim sim(1u << 30);
    sim.configure();
    sim.cmd(Json{{"t", "run"}, {"speed", 1}});
    sim.host.clear();
    sim.tick(16);
    REQUIRE(sim.host.frames.size() == 1);
    CHECK(sim.frameTime() == 16'000'000'000ull);
    CHECK(sim.frame().spanPs == 16'000'000'000ull);
    CHECK(sim.engine->halfSteps == halfAtOrAfter(kHz, 16'000'000'000ull));
    CHECK(sim.frame().cycle == 432'000);
    for (int i = 0; i < 61; ++i) sim.tick(16);
    CHECK(sim.host.frames.size() == 62);  // a frame for every chunk
    CHECK(sim.frameTime() == 62 * 16'000'000'000ull);
    CHECK(std::fabs(sim.frame().ratio - 1.0f) < 0.01f);
    CHECK(sim.host.frames[10].header.seq == sim.host.frames[9].header.seq + 1);

    // Multiplier 10^-6: 27 clocks per second, less than a half-cycle passes per chunk.
    sim.cmd(Json{{"t", "reset"}});
    sim.cmd(Json{{"t", "run"}, {"speed", 1e-6}});
    const uint64_t before = sim.engine->halfSteps;
    sim.tick(16);
    CHECK(sim.frameTime() == 16000);
    CHECK(sim.engine->halfSteps == before + 1);  // half-cycle 0 starts at time 0
    sim.tick(16);
    CHECK(sim.engine->halfSteps == before + 2);  // half-cycle 1 starts at 18,518 ps
    for (int i = 0; i < 123; ++i) sim.tick(16);  // 2 s of real time in total
    CHECK(sim.frameTime() == 2'000'000);
    CHECK(sim.engine->halfSteps == before + halfAtOrAfter(kHz, 2'000'000));
    CHECK(std::fabs(sim.frame().ratio - 1e-6f) < 1e-8f);

    // The fractional remainder of the target is not lost: 0.5 ps per chunk gives 5 ps per ten chunks.
    sim.cmd(Json{{"t", "reset"}});
    sim.cmd(Json{{"t", "run"}, {"speed", 0.5e-9}});
    sim.tick(1);
    CHECK(sim.frameTime() == 0);
    for (int i = 0; i < 9; ++i) sim.tick(1);
    CHECK(sim.frameTime() >= 4);  // 4 or 5: addends of 0.5 are inexact in binary
    CHECK(sim.frameTime() <= 5);
}

TEST_CASE("скорость max: порция ограничена бюджетом, отставание не копится", "[scheduler]") {
    Sim sim(1u << 30);
    sim.configure();
    sim.host.perCallMs = 1;  // each packet "costs" 1 ms of real time
    sim.cmd(Json{{"t", "run"}, {"speed", "max"}});
    sim.host.clear();
    sim.tick(16);
    REQUIRE(sim.host.frames.size() == 1);
    // Budget of 12 ms: about twelve packets of 40,000 half-cycles.
    CHECK(sim.engine->halfSteps >= 10 * kPacketHalfSteps);
    CHECK(sim.engine->halfSteps <= 13 * kPacketHalfSteps);
    CHECK(sim.engine->halfSteps % kPacketHalfSteps == 0);
    CHECK(sim.frame().realUs >= 10'000);
    CHECK(sim.frame().realUs <= 14'000);
    CHECK(sim.host.noticeCodes().empty());

    // A set speed the core cannot keep up with: the target is not reached, and time runs from the actual value.
    sim.cmd(Json{{"t", "speed"}, {"speed", 100}});
    const Time before = sim.frameTime();
    sim.host.clear();
    sim.tick(16);
    CHECK(sim.frameTime() - before < 16'000'000'000ull * 100);
    const Time perTick = sim.frameTime() - before;
    sim.tick(16);
    CHECK(sim.host.frames.back().header.time - sim.host.frames.front().header.time <= perTick + 20'000'000);
    // After three seconds the SLOW notice arrives, once, although the lag lasts two windows.
    for (int i = 0; i < 400; ++i) sim.tick(16);
    CHECK(sim.host.noticeCodes() == std::vector<std::string>{"SLOW"});
    // Core limit: the ratio of simulation time to real time with an unreachable target. The host clock
    // runs during the counting too, so the limit is measured by it and not by the tick step.
    const Time simFrom = sim.frameTime();
    const double clockFrom = sim.host.clock;
    for (int i = 0; i < 100; ++i) sim.tick(16);
    const double maxRatio = static_cast<double>(sim.frameTime() - simFrom) / 1e9 / (sim.host.clock - clockFrom);
    // A lag under 10% does not count as a notice (decision 109): the target is 5% above the core limit.
    sim.cmd(Json{{"t", "speed"}, {"speed", maxRatio / 0.95}});
    sim.host.clear();
    for (int i = 0; i < 400; ++i) sim.tick(16);
    CHECK(sim.host.noticeCodes().empty());
    // A target 25% above the limit: the lag is over 10%, so the notice arrives.
    sim.cmd(Json{{"t", "speed"}, {"speed", maxRatio / 0.8}});
    sim.host.clear();
    for (int i = 0; i < 400; ++i) sim.tick(16);
    CHECK(sim.host.noticeCodes() == std::vector<std::string>{"SLOW"});
    // When the core keeps up again, the notice re-arms.
    sim.cmd(Json{{"t", "speed"}, {"speed", 1e-6}});
    sim.tick(16);
    sim.cmd(Json{{"t", "speed"}, {"speed", 100}});
    sim.host.clear();
    for (int i = 0; i < 400; ++i) sim.tick(16);
    CHECK(sim.host.noticeCodes() == std::vector<std::string>{"SLOW"});
}

TEST_CASE("схема без такта: время идёт по настоящему, модель пересчитывается при изменении входа", "[scheduler]") {
    Sim sim;
    Json cfg = defaultConfigure();
    cfg["clock"] = nullptr;
    cfg["nets"][0]["pull"] = "down";
    sim.configure(cfg);
    const int settles = sim.engine->settles;
    sim.cmd(Json{{"t", "run"}, {"speed", 1}});
    for (int i = 0; i < 10; ++i) sim.tick(16);
    CHECK(sim.frameTime() == 160'000'000'000ull);
    CHECK(sim.frame().cycle == 0);
    CHECK(sim.engine->halfSteps == 0);
    CHECK(sim.engine->settles == settles);  // inputs did not change, so the model was not recomputed
    sim.part("s1", "press");
    CHECK(sim.engine->settles == settles + 1);
    sim.tick(16);
    CHECK(sim.frame().nets[kNetLed0].level == 0);
    CHECK(sim.frame().nets[kNetLed0].toggles == 1);
    CHECK(sim.frame().nets[kNetLed0].duty == 0.0f);
}

TEST_CASE("схема без такта на скорости max идёт по настоящему времени", "[scheduler]") {
    Sim sim;
    Json cfg = defaultConfigure();
    cfg["clock"] = nullptr;
    cfg["nets"][0]["pull"] = "down";
    sim.configure(cfg);
    sim.cmd(Json{{"t", "run"}, {"speed", "max"}});
    for (int i = 0; i < 5; ++i) sim.tick(16);
    CHECK(sim.frameTime() == 80'000'000'000ull);
    CHECK(sim.frame().spanPs == 16'000'000'000ull);
    CHECK(sim.lastState()["speed"] == "max");
    CHECK(sim.host.noticeCodes().empty());
}

TEST_CASE("доля тактовой сети не выходит за границы на коротких порциях", "[scheduler]") {
    Sim sim(1u << 30);
    sim.configure();
    // Chunks that start and end between half-cycles: the approximate calculation
    // of the time at one must not give a negative fraction or a fraction above one.
    for (const Time step : {537'037ull, 1000ull, 18'518ull, 1ull, 37'036ull, 5ull, 18'519ull, 100'000ull}) {
        sim.stepTime(step);
        const FrameNet& clk = sim.frame().nets[kNetClk];
        INFO("шаг " << step << " пс, уровень " << int(clk.level) << ", доля " << clk.duty);
        CHECK(clk.duty >= 0.0f);
        CHECK(clk.duty <= 1.0f);
        // A chunk shorter than a half-cycle with no edge inside: the fraction equals the level to within 1 ps.
        if (clk.toggles == 0 && step >= 1000) CHECK(std::fabs(clk.duty - static_cast<float>(clk.level)) < 0.01f);
    }
}

TEST_CASE("$finish: замечание MODEL_FINISH, состояние finished, нужен reset", "[scheduler]") {
    auto engine = std::make_unique<FakeEngine>(1u << 30);
    engine->finishAtCycle = 100;
    Sim sim(std::move(engine));
    sim.configure();
    sim.cmd(Json{{"t", "run"}, {"speed", 1}});
    sim.host.clear();
    sim.tick(16);
    CHECK(sim.host.noticeCodes() == std::vector<std::string>{"MODEL_FINISH"});
    CHECK(sim.lastState()["run"] == "finished");
    CHECK(sim.lastState()["cycle"] == 100);
    REQUIRE(sim.host.frames.size() == 1);
    CHECK(sim.frame().cycle == 100);
    sim.tick(16);
    CHECK(sim.host.frames.size() == 1);  // no chunks after the finish
    CHECK(errorCode(sim.cmd(Json{{"t", "run"}})) == "BAD_STATE");
    CHECK(errorCode(sim.cmd(Json{{"t", "pause"}})) == "BAD_STATE");
    CHECK(errorCode(sim.stepCycles(1)) == "BAD_STATE");
    REQUIRE(isOk(sim.cmd(Json{{"t", "reset"}})));
    CHECK(sim.lastState()["run"] == "paused");
    // Finish during a step.
    sim.host.clear();
    sim.stepCycles(500);
    CHECK(sim.host.noticeCodes() == std::vector<std::string>{"MODEL_FINISH"});
    CHECK(sim.lastState()["run"] == "finished");
    CHECK(sim.host.ofType("state").size() == 1);
    CHECK(sim.frame().cycle == 100);
}

TEST_CASE("порядок обмена раздела 4.7", "[scheduler]") {
    Sim sim(1u << 30);
    sim.rt.tick(0);  // no chunks before configure
    CHECK(sim.host.frames.empty());
    sim.hello();
    const std::vector<Json> idle = sim.host.ofType("state");
    CHECK(idle.empty());
    sim.cmd(Json{{"t", "speed"}, {"speed", 2}});
    CHECK(sim.lastState()["run"] == "idle");  // before configure the state is idle
    sim.cmd(defaultConfigure());
    CHECK(sim.lastState()["run"] == "paused");
    CHECK(sim.lastState()["speed"] == 2);
    sim.cmd(Json{{"t", "run"}});
    sim.tick(16);
    CHECK(sim.frame().spanPs == 32'000'000'000ull);
    // A repeated configure while running resets the simulation to the start and sets pause.
    sim.host.clear();
    sim.cmd(defaultConfigure());
    CHECK(sim.lastState()["run"] == "paused");
    CHECK(sim.lastState()["time"] == "0");
    CHECK(sim.frameTime() == 0);
    sim.tick(16);
    CHECK(sim.host.frames.size() == 1);
    CHECK(sim.host.badBinary == 0);
}
