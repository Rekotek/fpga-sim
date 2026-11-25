// Commands of spec section 4.2: each has a success test and a refusal test.
#include <catch2/catch_test_macros.hpp>

#include "harness.h"

using namespace fpgasim;
using namespace fpgasim::test;

TEST_CASE("hello: ready с версиями и портами; чужая версия протокола отклоняется", "[commands]") {
    Sim sim;
    const Json reply = sim.cmd(Json{{"t", "hello"}, {"protocol", 1}});
    CHECK(isOk(reply));
    const std::vector<Json> ready = sim.host.ofType("ready");
    REQUIRE(ready.size() == 1);
    CHECK(ready[0]["protocol"] == 1);
    CHECK(ready[0]["runtime"].get<std::string>().size() > 0);
    CHECK(ready[0]["engine"]["name"] == "verilator");
    CHECK(ready[0]["top"] == "top");
    REQUIRE(ready[0]["ports"].size() == 5);
    CHECK(ready[0]["ports"][0] == Json{{"name", "clk"}, {"dir", "in"}, {"width", 1}});
    CHECK(ready[0]["ports"][2] == Json{{"name", "led"}, {"dir", "out"}, {"width", 6}});
    CHECK(ready[0]["ports"][3]["dir"] == "inout");
    CHECK(ready[0]["partTypes"] == Json::array({"button", "led", "probe", "switch", "uart", "ws2812"}));

    Sim other;
    CHECK(errorCode(other.cmd(Json{{"t", "hello"}, {"protocol", 2}})) == "PROTOCOL_MISMATCH");
    CHECK(other.host.ofType("ready").empty());
    CHECK(errorCode(other.cmd(Json{{"t", "hello"}})) == "BAD_MESSAGE");
    // Without hello the other commands are not accepted.
    CHECK(errorCode(other.cmd(Json{{"t", "signals"}})) == "HELLO_REQUIRED");
}

TEST_CASE("разбор сообщений: не JSON, без типа, неизвестная команда", "[commands]") {
    Sim sim;
    sim.rt.json("{не json");
    sim.rt.json("[1,2]");
    sim.rt.json(R"({"id":1})");
    sim.rt.json(R"({"t":"hello","protocol":1,"id":-5})");
    const std::vector<Json> errors = sim.host.ofType("error");
    REQUIRE(errors.size() == 4);
    for (const Json& e : errors) {
        CHECK(e["code"] == "BAD_MESSAGE");
        CHECK_FALSE(e.contains("id"));
    }
    sim.hello();
    sim.host.clear();
    CHECK(errorCode(sim.cmd(Json{{"t", "teleport"}})) == "UNKNOWN_COMMAND");
    // A message of unknown type without an id is skipped silently.
    sim.host.clear();
    sim.rt.json(R"({"t":"teleport"})");
    CHECK(sim.host.msgs.empty());
    // A command without an id runs but gets no reply.
    sim.rt.json(R"({"t":"signals"})");
    CHECK(sim.host.msgs.empty());
}

TEST_CASE("configure: ok, state paused и кадр; ошибки дают CONFIG_INVALID", "[commands]") {
    Sim sim;
    sim.hello();
    sim.host.clear();
    const Json reply = sim.cmd(defaultConfigure());
    REQUIRE(isOk(reply));
    CHECK(reply["warnings"] == Json::array());
    // Order of spec section 4.7: ok, state (paused), FRAME.
    REQUIRE(sim.host.msgs.size() == 2);
    CHECK(sim.host.msgs[0]["t"] == "ok");
    CHECK(sim.host.msgs[1]["t"] == "state");
    CHECK(sim.host.msgs[1]["run"] == "paused");
    CHECK(sim.host.msgs[1]["time"] == "0");
    CHECK(sim.host.msgs[1]["cycle"] == 0);
    REQUIRE(sim.host.frames.size() == 1);
    CHECK(sim.frame().nets.size() == 7);
    CHECK(sim.frame().spanPs == 0);
    CHECK(sim.host.badBinary == 0);

    const auto invalid = [&](const char* pointer, Json value, bool remove = false) {
        Json cfg = defaultConfigure();
        const Json::json_pointer ptr(pointer);
        if (remove) {
            cfg[ptr.parent_pointer()].erase(ptr.back());
        } else {
            cfg[ptr] = std::move(value);
        }
        const size_t frames = sim.host.frames.size();
        const std::string code = errorCode(sim.cmd(cfg));
        CHECK(sim.host.frames.size() == frames);  // a refusal changes nothing and sends no frame
        return code;
    };
    CHECK(invalid("/nets/1/port", "nosuch") == "CONFIG_INVALID");  // no such port
    CHECK(invalid("/nets/1/bit", 6) == "CONFIG_INVALID");          // no such bit
    CHECK(invalid("/nets/2/pin", 15) == "CONFIG_INVALID");         // pin twice
    CHECK(invalid("/nets/2/bit", 0) == "CONFIG_INVALID");          // port bit twice
    CHECK(invalid("/nets/1/pull", "sideways") == "CONFIG_INVALID");
    CHECK(invalid("/nets/1/bit", nullptr, true) == "CONFIG_INVALID");          // port without bit
    CHECK(invalid("/parts/0/type", "teapot") == "CONFIG_INVALID");             // part type unknown
    CHECK(invalid("/parts/0/pins", Json{{"anode", 15}}) == "CONFIG_INVALID");  // no such role
    CHECK(invalid("/parts/0/pins", Json{{"in", 99}}) == "CONFIG_INVALID");     // pin is not in nets
    CHECK(invalid("/parts/1/id", "s-1") == "CONFIG_INVALID");                  // id: Latin letters, digits and _
    CHECK(invalid("/parts/1/id", "led0") == "CONFIG_INVALID");                 // part twice
    CHECK(invalid("/parts/0/settings", Json{{"activeLevel", 7}}) == "CONFIG_INVALID");
    CHECK(invalid("/parts/0/settings", Json{{"glow", true}}) == "CONFIG_INVALID");
    CHECK(invalid("/clock/port", "led") == "CONFIG_INVALID");  // clock not on an input
    CHECK(invalid("/clock/port", "nosuch") == "CONFIG_INVALID");
    CHECK(invalid("/clock/hz", 0) == "CONFIG_INVALID");
    CHECK(invalid("/watch", Json::array({99})) == "CONFIG_INVALID");
    CHECK(invalid("/board", nullptr, true) == "CONFIG_INVALID");
    CHECK(invalid("/nets", nullptr, true) == "CONFIG_INVALID");
    // After refusals the previous configuration stays in effect.
    CHECK(isOk(sim.stepCycles(1)));
}

TEST_CASE("отказы по ошибке в fpgasim.json несут причину и значения для интерфейса", "[commands]") {
    Sim sim;
    sim.configure();
    const auto args = [&](const char* pointer, Json value) {
        Json cfg = defaultConfigure();
        cfg[Json::json_pointer(pointer)] = std::move(value);
        const Json reply = sim.cmd(cfg);
        CHECK(errorCode(reply) == "CONFIG_INVALID");
        CHECK(reply["text"].get<std::string>().size() > 0);  // the Russian text stays for the logs
        return reply.value("args", Json());
    };
    CHECK(args("/parts/0/type", "teapot") == Json{{"reason", "partTypeUnknown"}, {"part", "led0"}, {"type", "teapot"}});
    CHECK(args("/parts/0/pins", Json{{"anode", 15}}) == Json{{"reason", "partRoleUnknown"}, {"part", "led0"}, {"role", "anode"}});
    CHECK(args("/parts/0/pins", Json{{"in", 99}}) ==
          Json{{"reason", "partPinMissing"}, {"part", "led0"}, {"role", "in"}, {"pin", "99"}});
    CHECK(args("/parts/1/id", "s-1") == Json{{"reason", "partIdBad"}, {"part", "s-1"}});
    CHECK(args("/parts/1/id", "led0") == Json{{"reason", "partTwice"}, {"part", "led0"}});
    CHECK(args("/parts/0/settings", Json{{"glow", true}}) ==
          Json{{"reason", "settingUnknown"}, {"setting", "glow"}, {"part", "led0"}});
    CHECK(args("/parts/0/settings", Json{{"activeLevel", 7}})["reason"] == "settingEnum");
    // A refusal that only a defect of the interface causes has no args: the interface shows it by the code.
    CHECK_FALSE(args("/clock/hz", 0).is_object());

    const Json settings = sim.cmd(Json{{"t", "partSettings"}, {"part", "led0"}, {"settings", Json{{"activeLevel", "x"}}}});
    CHECK(errorCode(settings) == "SETTINGS_INVALID");
    CHECK(settings["args"]["part"] == "led0");
    CHECK(settings["args"]["setting"] == "activeLevel");

    Json withSwitch = defaultConfigure();
    withSwitch["parts"][2] = Json{{"id", "sw"}, {"type", "switch"}, {"pins", Json{{"out", 87}}}};
    REQUIRE(isOk(sim.cmd(withSwitch)));
    CHECK(sim.part("s1", "toggle")["args"] == Json{{"reason", "commandUnknown"}, {"command", "toggle"}, {"part", "s1"}});
    const Json missing = sim.part("sw", "set");
    CHECK(missing["args"] == Json{{"reason", "argMissing"}, {"command", "set"}, {"arg", "on"}, {"part", "sw"}});
    const Json type = sim.part("sw", "set", Json{{"on", 1}});
    CHECK(type["args"] == Json{{"reason", "argType"}, {"kind", "boolean"}, {"command", "set"}, {"arg", "on"}, {"part", "sw"}});
}

TEST_CASE("configure: порт inout к сети не подключается и даёт предупреждение", "[commands]") {
    Sim sim;
    Json cfg = defaultConfigure();
    cfg["nets"].push_back(Json{{"pin", 73}, {"port", "io"}, {"bit", 0}, {"pull", "none"}});
    const Json reply = sim.configure(cfg);
    REQUIRE(isOk(reply));
    REQUIRE(reply["warnings"].size() == 1);
    CHECK(reply["warnings"][0]["code"] == "INOUT_UNSUPPORTED");
    CHECK(reply["warnings"][0]["port"] == "io");
    CHECK(reply["warnings"][0]["net"] == "pin:73");
    CHECK(sim.frame().nets.size() == 8);
}

TEST_CASE("signals: список с портами впереди; до hello — отказ", "[commands]") {
    Sim sim;
    CHECK(errorCode(sim.cmd(Json{{"t", "signals"}})) == "HELLO_REQUIRED");
    sim.hello();
    const Json reply = sim.cmd(Json{{"t", "signals"}});
    REQUIRE(isOk(reply));
    const Json& list = reply["signals"];
    REQUIRE(list.size() == 10);
    CHECK(list[0] == Json{{"sig", 0}, {"path", "top.clk"}, {"width", 1}, {"kind", "port"}});
    CHECK(list[5] == Json{{"sig", 5}, {"path", "top.cnt"}, {"width", 32}, {"kind", "reg"}});
    CHECK(list[6] == Json{{"sig", 6}, {"path", "top.mem"}, {"width", 8}, {"kind", "memory"}, {"depth", 16}});
    CHECK(list[7]["kind"] == "param");
    CHECK(list[8]["kind"] == "wire");
}

TEST_CASE("run и pause: смена состояния и кадр; до configure — отказ", "[commands]") {
    Sim sim(1u << 30);
    sim.hello();
    CHECK(errorCode(sim.cmd(Json{{"t", "run"}})) == "NOT_CONFIGURED");
    CHECK(errorCode(sim.cmd(Json{{"t", "pause"}})) == "NOT_CONFIGURED");
    sim.cmd(defaultConfigure());

    CHECK(errorCode(sim.cmd(Json{{"t", "run"}, {"speed", 0}})) == "BAD_MESSAGE");
    CHECK(errorCode(sim.cmd(Json{{"t", "run"}, {"speed", "fast"}})) == "BAD_MESSAGE");
    CHECK(sim.lastState()["run"] == "paused");

    sim.host.clear();
    REQUIRE(isOk(sim.cmd(Json{{"t", "run"}, {"speed", 0.5}})));
    REQUIRE(sim.host.msgs.size() == 2);
    CHECK(sim.host.msgs[1]["run"] == "running");
    CHECK(sim.host.msgs[1]["speed"] == 0.5);
    CHECK(sim.host.frames.empty());
    sim.tick(16);
    CHECK(sim.host.frames.size() == 1);

    sim.host.clear();
    REQUIRE(isOk(sim.cmd(Json{{"t", "pause"}})));
    REQUIRE(sim.host.msgs.size() == 2);
    CHECK(sim.host.msgs[1]["run"] == "paused");
    CHECK(sim.host.msgs[1]["time"] == "8000000000");  // 16 ms at half speed
    REQUIRE(sim.host.frames.size() == 1);             // one frame after pause
    CHECK(sim.frame().spanPs == 0);
    sim.tick(16);
    CHECK(sim.host.frames.size() == 1);  // no frames on pause

    // run without speed keeps the previous multiplier; "max" is accepted.
    REQUIRE(isOk(sim.cmd(Json{{"t", "run"}})));
    CHECK(sim.lastState()["speed"] == 0.5);
    REQUIRE(isOk(sim.cmd(Json{{"t", "run"}, {"speed", "max"}})));
    CHECK(sim.lastState()["speed"] == "max");
}

TEST_CASE("step: такты, время и до изменения; на ходу — отказ", "[commands]") {
    Sim sim;
    sim.configure();
    CHECK(errorCode(sim.step(Json{{"unit", "hop"}})) == "BAD_MESSAGE");
    CHECK(errorCode(sim.step(Json{{"unit", "cycle"}})) == "BAD_MESSAGE");
    CHECK(errorCode(sim.step(Json{{"unit", "cycle"}, {"count", 0}})) == "BAD_MESSAGE");
    CHECK(errorCode(sim.step(Json{{"unit", "time"}, {"ps", 5}})) == "BAD_MESSAGE");
    CHECK(errorCode(sim.step(Json{{"unit", "time"}})) == "BAD_MESSAGE");

    sim.host.clear();
    REQUIRE(isOk(sim.stepCycles(1)));
    REQUIRE(sim.host.frames.size() == 1);  // one frame after the step
    CHECK(sim.frame().cycle == 1);
    CHECK(sim.lastState()["run"] == "paused");
    CHECK(sim.lastState()["cycle"] == 1);
    REQUIRE(isOk(sim.stepTime(1'000'000)));
    CHECK(sim.lastState()["time"] == timeToString(halfStart(27'000'000, 2) + 1'000'000));
    REQUIRE(isOk(sim.step(Json{{"unit", "change"}})));

    sim.cmd(Json{{"t", "run"}});
    CHECK(errorCode(sim.cmd(Json{{"t", "step"}, {"unit", "cycle"}, {"count", 1}})) == "BAD_STATE");

    // A design without a clock has no clock step.
    Sim clockless;
    Json cfg = defaultConfigure();
    cfg["clock"] = nullptr;
    cfg["nets"][0]["pull"] = "down";
    clockless.configure(cfg);
    CHECK(errorCode(clockless.stepCycles(1)) == "BAD_STATE");
    CHECK(isOk(clockless.stepTime(1000)));
}

TEST_CASE("speed: смена множителя на ходу; неверное значение — отказ", "[commands]") {
    Sim sim(1u << 30);
    sim.configure();
    sim.cmd(Json{{"t", "run"}, {"speed", 1}});
    sim.host.clear();
    REQUIRE(isOk(sim.cmd(Json{{"t", "speed"}, {"speed", 0.1}})));
    CHECK(sim.lastState()["speed"] == 0.1);
    CHECK(sim.lastState()["run"] == "running");
    sim.tick(16);
    CHECK(sim.frame().spanPs == 1'600'000'000ull);
    REQUIRE(isOk(sim.cmd(Json{{"t", "speed"}, {"speed", "max"}})));
    CHECK(sim.lastState()["speed"] == "max");

    CHECK(errorCode(sim.cmd(Json{{"t", "speed"}})) == "BAD_MESSAGE");
    CHECK(errorCode(sim.cmd(Json{{"t", "speed"}, {"speed", -1}})) == "BAD_MESSAGE");
    CHECK(errorCode(sim.cmd(Json{{"t", "speed"}, {"speed", "slow"}})) == "BAD_MESSAGE");
    CHECK(sim.lastState()["speed"] == "max");
}

TEST_CASE("reset: время и такт в ноль, детали сброшены; до configure — отказ", "[commands]") {
    Sim sim;
    sim.hello();
    CHECK(errorCode(sim.cmd(Json{{"t", "reset"}})) == "NOT_CONFIGURED");
    sim.cmd(defaultConfigure());
    sim.part("s1", "press");
    sim.stepCycles(10);
    CHECK(sim.frame().nets[kNetBtn0].level == 1);
    CHECK(sim.frame().cycle == 10);
    const int resets = sim.engine->resets;

    sim.host.clear();
    REQUIRE(isOk(sim.cmd(Json{{"t", "reset"}})));
    CHECK(sim.engine->resets == resets + 1);  // the model is created anew
    REQUIRE(sim.host.msgs.size() == 2);
    CHECK(sim.host.msgs[1]["run"] == "paused");
    CHECK(sim.host.msgs[1]["time"] == "0");
    CHECK(sim.host.msgs[1]["cycle"] == 0);
    REQUIRE(sim.host.frames.size() == 1);
    CHECK(sim.frameTime() == 0);
    CHECK(sim.frame().cycle == 0);
    CHECK(sim.frame().nets[kNetBtn0].level == 0);  // button released
    CHECK(sim.frame().nets[kNetLed0].level == 1);
    // Part state arrives again in the first frame.
    REQUIRE(sim.frame().parts.size() == 2);
    CHECK(sim.frame().parts[0].state == std::vector<uint8_t>{0});

    // reset while running stops the simulation.
    sim.cmd(Json{{"t", "run"}});
    sim.cmd(Json{{"t", "reset"}});
    CHECK(sim.lastState()["run"] == "paused");
}

TEST_CASE("watch: значения приходят в кадре; неизвестный сигнал и память — отказ", "[commands]") {
    Sim sim;
    sim.configure();
    REQUIRE(isOk(sim.cmd(Json{{"t", "watch"}, {"signals", Json::array({FakeEngine::kCnt, FakeEngine::kWide})}})));
    sim.stepCycles(1000);
    REQUIRE(sim.frame().watch.size() == 2);
    CHECK(sim.frame().watch[0].sig == FakeEngine::kCnt);
    CHECK(sim.frame().watch[0].width == 32);
    CHECK(sim.frame().watch[0].words == std::vector<uint32_t>{1000});
    CHECK(sim.frame().watch[1].width == 70);
    CHECK(sim.frame().watch[1].words == std::vector<uint32_t>{1000, 0, 0x2a});

    CHECK(errorCode(sim.cmd(Json{{"t", "watch"}, {"signals", Json::array({99})}})) == "UNKNOWN_SIGNAL");
    CHECK(errorCode(sim.cmd(Json{{"t", "watch"}, {"signals", Json::array({FakeEngine::kMem})}})) == "UNKNOWN_SIGNAL");
    CHECK(errorCode(sim.cmd(Json{{"t", "watch"}, {"signals", Json::array({"top.cnt"})}})) == "UNKNOWN_SIGNAL");
    CHECK(errorCode(sim.cmd(Json{{"t", "watch"}})) == "BAD_MESSAGE");
    sim.stepCycles(1);
    CHECK(sim.frame().watch.size() == 2);  // a refusal does not change the list

    REQUIRE(isOk(sim.cmd(Json{{"t", "watch"}, {"signals", Json::array()}})));
    sim.stepCycles(1);
    CHECK(sim.frame().watch.empty());

    // Watch list from configure.
    Json cfg = defaultConfigure();
    cfg["watch"] = Json::array({FakeEngine::kLed});
    sim.cmd(cfg);
    REQUIRE(sim.frame().watch.size() == 1);
    CHECK(sim.frame().watch[0].words == std::vector<uint32_t>{0b000011});
}

TEST_CASE("part: команда детали меняет сеть; неизвестные деталь и команда — отказ", "[commands]") {
    Sim sim;
    sim.configure();
    REQUIRE(isOk(sim.part("s1", "press")));
    sim.stepCycles(1);
    CHECK(sim.frame().nets[kNetBtn0].level == 1);
    CHECK(sim.frame().nets[kNetLed0].level == 0);

    CHECK(errorCode(sim.part("s9", "press")) == "UNKNOWN_PART");
    CHECK(errorCode(sim.part("s1", "explode")) == "PART_COMMAND_INVALID");
    CHECK(errorCode(sim.part("s1", "press", Json{{"force", 9}})) == "PART_COMMAND_INVALID");  // extra argument
    CHECK(errorCode(sim.part("led0", "press")) == "PART_COMMAND_INVALID");                    // the LED has no commands
    CHECK(errorCode(sim.cmd(Json{{"t", "part"}, {"part", "s1"}})) == "BAD_MESSAGE");
    // The args field is optional.
    CHECK(isOk(sim.cmd(Json{{"t", "part"}, {"part", "s1"}, {"cmd", "release"}})));
}

TEST_CASE("partSettings: настройка меняется на ходу; неверное значение — отказ", "[commands]") {
    Sim sim;
    sim.configure();
    sim.part("s1", "press");
    sim.stepCycles(1);
    CHECK(sim.frame().nets[kNetBtn0].level == 1);
    // A pressed button with active level 0 pulls the net to zero.
    REQUIRE(isOk(sim.cmd(Json{{"t", "partSettings"}, {"part", "s1"}, {"settings", Json{{"activeLevel", 0}}}})));
    sim.stepCycles(1);
    CHECK(sim.frame().nets[kNetBtn0].level == 0);
    CHECK(sim.frame().nets[kNetBtn0].flags == kNetPart);

    const auto settings = [&](const char* part, Json value) {
        return errorCode(sim.cmd(Json{{"t", "partSettings"}, {"part", part}, {"settings", std::move(value)}}));
    };
    CHECK(settings("s1", Json{{"activeLevel", 2}}) == "SETTINGS_INVALID");
    CHECK(settings("s1", Json{{"bounceMs", 21}}) == "SETTINGS_INVALID");
    CHECK(settings("s1", Json{{"idle", "float"}}) == "SETTINGS_INVALID");
    CHECK(settings("s1", Json{{"key", "ab"}}) == "SETTINGS_INVALID");
    CHECK(settings("s1", Json{{"volume", 3}}) == "SETTINGS_INVALID");
    CHECK(settings("nope", Json{{"activeLevel", 1}}) == "UNKNOWN_PART");
    CHECK(errorCode(sim.cmd(Json{{"t", "partSettings"}, {"part", "s1"}})) == "BAD_MESSAGE");
    // A refusal does not change the settings.
    sim.stepCycles(1);
    CHECK(sim.frame().nets[kNetBtn0].level == 0);
}

TEST_CASE("recordStart, recordStop, recordFetch: успех и отказ", "[commands]") {
    Sim sim;
    sim.hello();
    CHECK(errorCode(sim.cmd(Json{{"t", "recordStart"}, {"signals", Json::array({5})}, {"mode", "ring"}})) ==
          "NOT_CONFIGURED");
    sim.cmd(defaultConfigure());

    const auto start = [&](Json msg) {
        msg["t"] = "recordStart";
        return sim.cmd(std::move(msg));
    };
    CHECK(errorCode(start(Json{{"signals", Json::array()}, {"mode", "ring"}})) == "RECORD_INVALID");
    CHECK(errorCode(start(Json{{"signals", Json::array({99})}, {"mode", "ring"}})) == "RECORD_INVALID");
    CHECK(errorCode(start(Json{{"signals", Json::array({"pin:99"})}, {"mode", "ring"}})) == "RECORD_INVALID");
    CHECK(errorCode(start(Json{{"signals", Json::array({"led"})}, {"mode", "ring"}})) == "RECORD_INVALID");
    CHECK(errorCode(start(Json{{"signals", Json::array({FakeEngine::kMem})}, {"mode", "ring"}})) == "RECORD_INVALID");
    CHECK(errorCode(start(Json{{"signals", Json::array({5})}, {"mode", "tape"}})) == "RECORD_INVALID");
    CHECK(errorCode(start(Json{{"signals", Json::array({5})}, {"mode", "ring"}, {"depth", 0}})) == "RECORD_INVALID");
    CHECK(errorCode(start(Json{{"signals", Json::array({5})}, {"mode", "window"}, {"windowPs", 100}})) ==
          "RECORD_INVALID");
    // For a multi-bit signal the trigger condition is only change (spec section 2.4).
    CHECK(errorCode(start(Json{{"signals", Json::array({5})},
                               {"mode", "window"},
                               {"trigger", Json{{"signal", 5}, {"edge", "rise"}}}})) == "RECORD_INVALID");
    CHECK(errorCode(sim.cmd(Json{{"t", "recordStop"}})) == "NO_RECORD");
    CHECK(errorCode(sim.cmd(Json{{"t", "recordFetch"}, {"record", 0}})) == "UNKNOWN_RECORD");

    sim.host.clear();
    const Json started = start(Json{{"signals", Json::array({FakeEngine::kCnt, "pin:17"})}, {"mode", "ring"}});
    REQUIRE(isOk(started));
    const int record = started["record"];
    REQUIRE(sim.host.ofType("recordState").size() == 1);
    CHECK(sim.host.ofType("recordState")[0]["state"] == "recording");
    CHECK(sim.host.ofType("recordState")[0]["record"] == record);
    sim.stepCycles(8);

    CHECK(errorCode(sim.cmd(Json{{"t", "recordFetch"}, {"record", record + 1}})) == "UNKNOWN_RECORD");
    CHECK(errorCode(sim.cmd(Json{{"t", "recordFetch"}})) == "BAD_MESSAGE");
    CHECK(errorCode(sim.cmd(Json{{"t", "recordFetch"}, {"record", record}, {"fromPs", 12}})) == "BAD_MESSAGE");

    sim.host.clear();
    const Json fetched = sim.cmd(Json{{"t", "recordFetch"}, {"record", record}});
    REQUIRE(isOk(fetched));
    CHECK(fetched["info"] == Json::array({Json{{"index", 0}, {"name", "top.cnt"}, {"width", 32}},
                                          Json{{"index", 1}, {"name", "pin:17"}, {"width", 1}}}));
    // Order: ok with info, TRACE messages, recordEnd.
    REQUIRE(sim.host.msgs.size() == 2);
    CHECK(sim.host.msgs[0]["t"] == "ok");
    CHECK(sim.host.msgs[1] == Json{{"t", "recordEnd"}, {"record", record}});
    REQUIRE(sim.host.traces.size() == 1);
    CHECK(sim.host.traces[0].record == static_cast<uint32_t>(record));
    CHECK(sim.host.traces[0].changes.size() == 2 + 8 + 2);  // initial values, 8 clocks, two edges of q

    sim.host.clear();
    REQUIRE(isOk(sim.cmd(Json{{"t", "recordStop"}})));
    REQUIRE(sim.host.ofType("recordState").size() == 1);
    CHECK(sim.host.ofType("recordState")[0]["state"] == "stopped");
    CHECK(sim.host.ofType("recordState")[0]["changes"] == 10);
    CHECK(errorCode(sim.cmd(Json{{"t", "recordStop"}})) == "NO_RECORD");
    // A stopped recording stays available.
    CHECK(isOk(sim.cmd(Json{{"t", "recordFetch"}, {"record", record}})));
}

TEST_CASE("двоичное сообщение ядру: PART_DATA принимается, прочее отклоняется", "[commands]") {
    Sim sim;
    sim.configure();
    sim.host.clear();
    std::vector<uint8_t> msg;
    const uint8_t bytes[] = {72, 105};
    encodePartData(msg, 0, 0, 1, 0, bytes);
    sim.rt.binary(msg);
    CHECK(sim.host.msgs.empty());

    encodePartData(msg, 0, 0, 50, 0, bytes);  // no such part
    sim.rt.binary(msg);
    REQUIRE(sim.host.ofType("error").size() == 1);
    CHECK(sim.host.ofType("error")[0]["code"] == "UNKNOWN_PART");

    sim.host.clear();
    Frame frame;
    encodeFrame(msg, 0, 0, frame);  // frames come only from the core
    sim.rt.binary(msg);
    sim.rt.binary(std::span(msg).first(7));
    REQUIRE(sim.host.ofType("error").size() == 2);
    CHECK(sim.host.ofType("error")[0]["code"] == "BAD_MESSAGE");
    CHECK(sim.host.ofType("error")[1]["code"] == "BAD_MESSAGE");
}
