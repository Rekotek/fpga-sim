// Runtime: scheduler, nets, parts and command parsing (spec sections 4 and 5).
#include "fpgasim/runtime.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <deque>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "fpgasim/clock.h"
#include "fpgasim/json.h"
#include "fpgasim/protocol.h"
#include "recorder.h"
#include "registry.h"

#ifndef FPGASIM_RUNTIME_VERSION
#define FPGASIM_RUNTIME_VERSION "0.0.0"
#endif

namespace fpgasim {

namespace {

constexpr int kMaxWakesPerCall = 1024;
constexpr int kMaxSettleRounds = 16;            // settle rounds in a row at most: guards against a loop through parts
constexpr Time kNoticePeriodPs = kPsPerSecond;  // one notice per net at most once per second of simulation
constexpr Time kStepChangeLimitPs = kPsPerSecond;  // the "until change" step runs at most 1 s of simulation time
constexpr uint64_t kMaxClockHz = 1'000'000'000ull;
constexpr double kRatioWindowMs = 500.0;
constexpr double kSlowAfterMs = 3000.0;
constexpr double kSlowRatio = 0.9;  // share of the set speed below which a window counts as lagging
constexpr double kRecordStatePeriodMs = 1000.0;

uint64_t hashId(std::string_view text) {
    uint64_t h = 0xcbf29ce484222325ull;  // FNV-1a
    for (const char c : text) {
        h ^= static_cast<uint8_t>(c);
        h *= 0x100000001b3ull;
    }
    return h ? h : 0x9e3779b97f4a7c15ull;
}

const Json* field(const Json& obj, const char* name) {
    const auto it = obj.find(name);
    return it == obj.end() ? nullptr : &*it;
}

// An integer within the given bounds.
std::optional<int64_t> intField(const Json& obj, const char* name, int64_t min, int64_t max) {
    const Json* v = field(obj, name);
    if (!v || !v->is_number_integer()) return std::nullopt;
    if (v->is_number_unsigned() && v->get<uint64_t>() > static_cast<uint64_t>(max)) return std::nullopt;
    const int64_t n = v->get<int64_t>();
    if (n < min || n > max) return std::nullopt;
    return n;
}

const std::string* stringField(const Json& obj, const char* name) {
    const Json* v = field(obj, name);
    return v && v->is_string() ? &v->get_ref<const std::string&>() : nullptr;
}

std::string pinName(int pin) { return "pin:" + std::to_string(pin); }

std::optional<int> parsePinName(const std::string& text) {
    if (text.rfind("pin:", 0) != 0) return std::nullopt;
    const std::optional<Time> n = parseTime(std::string_view(text).substr(4));
    if (!n || *n == 0 || *n > 1'000'000) return std::nullopt;
    return static_cast<int>(*n);
}

const char* kindName(SignalKind kind) {
    switch (kind) {
        case SignalKind::Port:
            return "port";
        case SignalKind::Wire:
            return "wire";
        case SignalKind::Reg:
            return "reg";
        case SignalKind::Memory:
            return "memory";
        case SignalKind::Param:
            return "param";
    }
    return "wire";
}

}  // namespace

class Runtime::Impl {
public:
    Impl(std::unique_ptr<Engine> engine, Host& host) : engine_(std::move(engine)), host_(host) {
        registerBuiltinParts();
        uint32_t maxWords = 1;
        for (const SignalInfo& s : engine_->signals()) maxWords = std::max(maxWords, wordsFor(s.width));
        for (const PortInfo& p : engine_->ports()) maxWords = std::max(maxWords, wordsFor(p.width));
        words_.assign(maxWords, 0);
    }

    void json(std::string_view text);
    void binary(std::span<const uint8_t> bytes);
    void tick(double nowMs);

private:
    enum class Run { Idle, Running, Paused, Finished };
    enum class Pull { None, Up, Down };
    using Id = std::optional<int64_t>;

    struct Driver {
        int part;
        int role;
        bool active;
        bool level;
    };
    struct Reader {
        int part;
        int role;
        bool edges;
    };
    struct Net {
        int pin = 0;
        int port = -1;  // FPGA port or -1
        uint32_t bit = 0;
        PortDir dir = PortDir::In;
        bool isClock = false;  // net of the clock port: the board generator drives it
        Pull pull = Pull::None;
        bool level = false;
        bool fpgaLevel = false;  // value of an FPGA output port
        uint8_t flags = 0;
        bool queued = false;
        std::vector<Driver> drivers;
        std::vector<Reader> readers;
        // Statistics of the current chunk; updated only when the level changes.
        uint32_t toggles = 0;
        Time highTime = 0;  // time at one up to lastMark
        Time lastMark = 0;
        Time lastNotice[2] = {kNever, kNever};  // INPUT_FLOATING, NET_CONFLICT
    };

    // Runtime services for one part.
    struct Slot final : PartHost {
        Impl* rt = nullptr;
        int index = 0;
        std::string id;
        const PartType* type = nullptr;
        std::unique_ptr<Part> part;
        std::vector<int> roleNet;  // role -> net index or -1
        Json settings;
        uint64_t rng = 1;
        bool attached = false;
        bool dirty = true;
        mutable NetStats scratch{};

        Time now() const override { return rt->now_; }
        bool level(int role) const override {
            const int net = netOf(role);
            return net >= 0 && rt->nets_[net].level;
        }
        void drive(int role, bool level) override { rt->driveNet(*this, role, true, level); }
        void release(int role) override { rt->driveNet(*this, role, false, false); }
        void wakeAt(Time t, uint32_t tag) override { rt->addWake(index, std::max(t, rt->now_), tag); }
        void cancelWake(uint32_t tag) override { rt->cancelWake(index, tag); }
        const NetStats& stats(int role) const override {
            const int net = netOf(role);
            scratch = {};
            if (net >= 0) {
                const Net& n = rt->nets_[net];
                scratch.level = n.level;
                scratch.toggles = n.toggles;
                scratch.highTime = n.highTime + (n.level ? rt->now_ - n.lastMark : 0);
                scratch.span = rt->now_ - rt->chunkStart_;
            }
            return scratch;
        }
        void emitEvent(std::string_view event, const Json& data) override {
            rt->send(Json{{"t", "partEvent"},
                          {"part", id},
                          {"event", std::string(event)},
                          {"data", data.is_object() ? data : Json::object()},
                          {"time", timeToString(rt->now_)}});
        }
        void emitData(uint16_t channel, std::span<const uint8_t> bytes) override {
            encodePartData(rt->out_, rt->partDataSeq_++, rt->now_, static_cast<uint16_t>(index), channel, bytes);
            rt->host_.emitBinary(rt->out_);
        }
        void markDirty() override { dirty = true; }
        uint64_t random() override {  // xorshift64*
            rng ^= rng >> 12;
            rng ^= rng << 25;
            rng ^= rng >> 27;
            return rng * 0x2545f4914f6cdd1dull;
        }
        int netOf(int role) const { return role >= 0 && role < static_cast<int>(roleNet.size()) ? roleNet[role] : -1; }
    };

    struct Wake {
        Time t;
        uint64_t seq;
        int part;
        uint32_t tag;
        bool operator>(const Wake& o) const { return t != o.t ? t > o.t : seq > o.seq; }
    };

    // Parsed content of configure; takes effect only as a whole.
    struct Config {
        bool clocked = false;
        int clockPort = -1;
        uint64_t hz = 0;
        std::vector<Net> nets;
        std::vector<std::unique_ptr<Slot>> slots;
        std::vector<std::vector<int>> portNets;  // output port -> its nets
        std::vector<uint32_t> watch;
        Json warnings = Json::array();
    };

    // --- sending ---
    void send(const Json& msg) {
        if (deferring_ && msg.value("t", "") == "notice") {
            deferred_.push_back(msg);
            return;
        }
        host_.emitJson(msg.dump(-1, ' ', false, Json::error_handler_t::replace));
    }
    void flushDeferred() {
        deferring_ = false;
        for (const Json& msg : deferred_) send(msg);
        deferred_.clear();
    }
    void ok(const Id& id, Json extra = Json::object()) {
        if (!id) return;
        extra["t"] = "ok";
        extra["id"] = *id;
        send(extra);
    }
    void fail(const Id& id, const char* code, const std::string& text, const Json& args = Json()) {
        Json msg{{"t", "error"}, {"code", code}, {"text", text}};
        if (id) msg["id"] = *id;
        if (args.is_object()) msg["args"] = args;
        send(msg);
    }
    // A part refusal: the text names the part, and args gets the part id.
    void failPart(const Id& id, const char* code, const std::string& partId, Refusal err) {
        if (err.args.is_object()) err.args["part"] = partId;
        fail(id, code, "деталь " + partId + ": " + err.text, err.args);
    }
    void notice(const char* code, const std::string& text, int pin = 0) {
        Json msg{{"t", "notice"}, {"code", code}, {"text", text}, {"time", timeToString(now_)}};
        if (pin > 0) msg["net"] = pinName(pin);
        send(msg);
    }
    Json speedJson() const { return speedMax_ ? Json("max") : Json(speed_); }
    // Cycle index since the start: the number of rising edges executed.
    uint64_t cycle() const { return clocked_ ? (clocks_.half(0) + 1) / 2 : 0; }
    void sendState() {
        const char* run = "idle";
        if (run_ == Run::Running) run = "running";
        if (run_ == Run::Paused) run = "paused";
        if (run_ == Run::Finished) run = "finished";
        send(Json{
            {"t", "state"}, {"run", run}, {"time", timeToString(now_)}, {"cycle", cycle()}, {"speed", speedJson()}});
    }

    // --- commands ---
    void onHello(const Json& msg, const Id& id);
    void onConfigure(const Json& msg, const Id& id);
    void onSignals(const Id& id);
    void onRun(const Json& msg, const Id& id);
    void onPause(const Id& id);
    void onStep(const Json& msg, const Id& id);
    void onSpeed(const Json& msg, const Id& id);
    void onReset(const Id& id);
    void onWatch(const Json& msg, const Id& id);
    void onPart(const Json& msg, const Id& id);
    void onPartSettings(const Json& msg, const Id& id);
    void onRecordStart(const Json& msg, const Id& id);
    void onRecordStop(const Id& id);
    void onRecordFetch(const Json& msg, const Id& id);

    Refusal buildConfig(const Json& msg, Config& cfg);
    std::string checkWatch(const Json& list, std::vector<uint32_t>& out) const;
    bool parseSpeed(const Json& value, bool& isMax, double& speed) const;
    bool recordItem(const Json& ref, Recorder::Item& item, std::string& err) const;
    Slot* findSlot(const std::string& id) {
        for (auto& s : slots_) {
            if (s->id == id) return s.get();
        }
        return nullptr;
    }

    // --- simulation ---
    void restart();
    void enqueue(int net) {
        if (nets_[net].queued) return;
        nets_[net].queued = true;
        queue_.push_back(net);
    }
    void driveNet(Slot& slot, int role, bool active, bool level);
    void resolve(int netIndex);
    void noticeFlags(Net& net, uint8_t flags);
    bool settleAll();
    void addWake(int part, Time t, uint32_t tag);
    void cancelWake(int part, uint32_t tag);
    void runWakes();
    bool advance(Time target, bool stopOnChange, double deadlineMs);
    void finishModel();
    void finishStep();
    void endChunk(uint32_t realUs);
    void flushRecorder();
    Time clockHigh(Time t, uint64_t halves) const;

    std::unique_ptr<Engine> engine_;
    Host& host_;

    bool helloDone_ = false;
    bool configured_ = false;
    Run run_ = Run::Idle;
    bool speedMax_ = false;
    double speed_ = 1.0;

    Time now_ = 0;
    ClockList clocks_;
    bool clocked_ = false;
    int clockPort_ = -1;
    std::vector<Net> nets_;
    std::vector<std::unique_ptr<Slot>> slots_;
    std::vector<std::vector<int>> portNets_;
    std::vector<uint32_t> watch_;
    std::vector<Wake> wakes_;  // heap: the nearest wakeup first
    uint64_t wakeSeq_ = 0;
    std::vector<int> queue_;  // nets whose level must be recomputed
    bool inputsDirty_ = false;
    bool initializing_ = false;  // initial setting of levels: no switching and no edges

    Time chunkStart_ = 0;
    uint64_t chunkHalfStart_ = 0;
    bool stepping_ = false;
    Time stepTarget_ = 0;
    bool stepOnChange_ = false;
    double stepRealMs_ = 0;

    double lastTickMs_ = 0;
    double carry_ = 0;                             // fractional remainder of the target, ps
    std::deque<std::pair<double, Time>> samples_;  // real time, simulation time
    float ratio_ = 0;
    double slowFromMs_ = -1;  // start of the SLOW estimation window, ms of real time; -1 means no window
    Time slowFromTime_ = 0;   // simulation time at the window start
    bool slowNotified_ = false;

    Recorder recorder_;
    double recordStateMs_ = 0;

    bool deferring_ = false;  // notices accumulate until the reply to the command is sent
    std::vector<Json> deferred_;
    uint32_t frameSeq_ = 0;
    uint32_t traceSeq_ = 0;
    uint32_t partDataSeq_ = 0;
    Frame frame_;
    std::vector<uint8_t> out_;
    std::vector<uint8_t> stateBuf_;
    std::vector<uint32_t> words_;
};

// ---------------------------------------------------------------------------------------------
// Message parsing
// ---------------------------------------------------------------------------------------------

void Runtime::Impl::json(std::string_view text) {
    const Json msg = Json::parse(text, nullptr, false);
    const std::string* type = msg.is_object() ? stringField(msg, "t") : nullptr;
    if (!type) return fail(std::nullopt, "BAD_MESSAGE", "сообщение не является объектом JSON с полем t");
    Id id;
    if (msg.contains("id")) {
        id = intField(msg, "id", 0, (int64_t{1} << 53));
        if (!id) return fail(std::nullopt, "BAD_MESSAGE", "поле id должно быть целым неотрицательным числом");
    }
    const std::string& t = *type;
    if (t == "hello") return onHello(msg, id);
    if (!helloDone_) return fail(id, "HELLO_REQUIRED", "первым сообщением должно быть hello");
    if (t == "configure") return onConfigure(msg, id);
    if (t == "signals") return onSignals(id);
    if (t == "speed") return onSpeed(msg, id);
    if (t == "watch") return onWatch(msg, id);
    const bool known = t == "run" || t == "pause" || t == "step" || t == "reset" || t == "part" ||
                       t == "partSettings" || t == "recordStart" || t == "recordStop" || t == "recordFetch";
    if (!known) {
        // A message of unknown type is skipped (spec section 4.7); a command with an id gets a refusal.
        if (id) fail(id, "UNKNOWN_COMMAND", "неизвестная команда \"" + t + "\"");
        return;
    }
    if (!configured_) return fail(id, "NOT_CONFIGURED", "команда допустима только после configure");
    if (t == "run") return onRun(msg, id);
    if (t == "pause") return onPause(id);
    if (t == "step") return onStep(msg, id);
    if (t == "reset") return onReset(id);
    if (t == "part") return onPart(msg, id);
    if (t == "partSettings") return onPartSettings(msg, id);
    if (t == "recordStart") return onRecordStart(msg, id);
    if (t == "recordStop") return onRecordStop(id);
    return onRecordFetch(msg, id);
}

void Runtime::Impl::binary(std::span<const uint8_t> bytes) {
    const std::optional<BinaryHeader> header = decodeHeader(bytes);
    if (!header || header->kind != BinaryKind::PartData)
        return fail(std::nullopt, "BAD_MESSAGE", "двоичное сообщение не является PART_DATA версии 1");
    const std::optional<PartData> data = decodePartData(bytes.subspan(kBinaryHeaderSize));
    if (!data) return fail(std::nullopt, "BAD_MESSAGE", "содержимое PART_DATA короче заявленного");
    if (!configured_ || data->part >= slots_.size())
        return fail(std::nullopt, "UNKNOWN_PART", "в PART_DATA указан несуществующий номер детали");
    slots_[data->part]->part->onData(data->channel, data->bytes);
    settleAll();
    flushRecorder();
}

void Runtime::Impl::onHello(const Json& msg, const Id& id) {
    const std::optional<int64_t> protocol = intField(msg, "protocol", 1, 1'000'000);
    if (!protocol) return fail(id, "BAD_MESSAGE", "в hello нет поля protocol");
    if (*protocol != kProtocolVersion)
        return fail(id, "PROTOCOL_MISMATCH",
                    "ядро работает по протоколу версии " + std::to_string(kProtocolVersion) + ", интерфейс — версии " +
                        std::to_string(*protocol));
    helloDone_ = true;
    const EngineInfo info = engine_->info();
    Json ports = Json::array();
    for (const PortInfo& p : engine_->ports()) {
        const char* dir = p.dir == PortDir::In ? "in" : p.dir == PortDir::Out ? "out" : "inout";
        ports.push_back(Json{{"name", p.name}, {"dir", dir}, {"width", p.width}});
    }
    send(Json{{"t", "ready"},
              {"protocol", kProtocolVersion},
              {"runtime", FPGASIM_RUNTIME_VERSION},
              {"engine", Json{{"name", info.name}, {"version", info.version}}},
              {"top", info.top},
              {"ports", ports},
              {"partTypes", partTypeNames()}});
    ok(id);
}

std::string Runtime::Impl::checkWatch(const Json& list, std::vector<uint32_t>& out) const {
    if (!list.is_array()) return "список наблюдения должен быть массивом";
    if (list.size() > 65535) return "в списке наблюдения больше 65 535 сигналов";
    const std::vector<SignalInfo>& signals = engine_->signals();
    out.clear();
    for (const Json& item : list) {
        if (!item.is_number_unsigned() || item.get<uint64_t>() >= signals.size())
            return "в списке наблюдения нет такого сигнала: " + item.dump();
        const uint32_t sig = item.get<uint32_t>();
        if (signals[sig].kind == SignalKind::Memory) return "память не наблюдается: " + signals[sig].path;
        out.push_back(sig);
    }
    return {};
}

Refusal Runtime::Impl::buildConfig(const Json& msg, Config& cfg) {
    const std::vector<PortInfo>& ports = engine_->ports();
    const auto findPort = [&](const std::string& name) {
        for (size_t i = 0; i < ports.size(); ++i) {
            if (ports[i].name == name) return static_cast<int>(i);
        }
        return -1;
    };
    if (!stringField(msg, "board")) return "нет поля board";

    const Json* clock = field(msg, "clock");
    if (!clock) return "нет поля clock";
    if (!clock->is_null()) {
        const std::string* name = clock->is_object() ? stringField(*clock, "port") : nullptr;
        const std::optional<int64_t> hz =
            clock->is_object() ? intField(*clock, "hz", 1, kMaxClockHz) : std::optional<int64_t>();
        if (!name || !hz) return "поле clock: нужны port и hz от 1 до 10^9";
        cfg.clockPort = findPort(*name);
        if (cfg.clockPort < 0) return "тактового порта \"" + *name + "\" нет у верхнего модуля";
        if (ports[cfg.clockPort].dir != PortDir::In || ports[cfg.clockPort].width != 1)
            return "тактовый порт \"" + *name + "\" должен быть одноразрядным входом";
        cfg.clocked = true;
        cfg.hz = static_cast<uint64_t>(*hz);
    }

    const Json* nets = field(msg, "nets");
    if (!nets || !nets->is_array()) return "нет массива nets";
    if (nets->size() > 65535) return "слишком много сетей";
    cfg.portNets.assign(ports.size(), {});
    for (const Json& item : *nets) {
        if (!item.is_object()) return "элемент nets должен быть объектом";
        const std::optional<int64_t> pin = intField(item, "pin", 1, 1'000'000);
        const std::string* pull = stringField(item, "pull");
        if (!pin) return "у сети нет номера вывода pin";
        Net net;
        net.pin = static_cast<int>(*pin);
        const std::string where = "вывод " + std::to_string(net.pin);
        if (!pull || (*pull != "up" && *pull != "down" && *pull != "none")) return where + ": pull — up, down или none";
        net.pull = *pull == "up" ? Pull::Up : *pull == "down" ? Pull::Down : Pull::None;
        for (const Net& other : cfg.nets) {
            if (other.pin == net.pin) return where + " указан дважды";
        }
        const bool hasPort = item.contains("port");
        if (hasPort != item.contains("bit")) return where + ": поля port и bit задаются вместе";
        if (hasPort) {
            const std::string* name = stringField(item, "port");
            if (!name) return where + ": port должен быть строкой";
            const int port = findPort(*name);
            if (port < 0) return where + ": порта \"" + *name + "\" нет у верхнего модуля";
            const std::optional<int64_t> bit = intField(item, "bit", 0, static_cast<int64_t>(ports[port].width) - 1);
            if (!bit) return where + ": у порта \"" + *name + "\" нет такого разряда";
            for (const Net& other : cfg.nets) {
                if (other.port == port && other.bit == static_cast<uint32_t>(*bit))
                    return where + ": разряд порта \"" + *name + "\" уже привязан к выводу " +
                           std::to_string(other.pin);
            }
            if (ports[port].dir == PortDir::InOut) {
                cfg.warnings.push_back(Json{{"code", "INOUT_UNSUPPORTED"},
                                            {"text", "двунаправленный порт к сети не подключается"},
                                            {"port", *name},
                                            {"net", pinName(net.pin)}});
            } else {
                net.port = port;
                net.bit = static_cast<uint32_t>(*bit);
                net.dir = ports[port].dir;
                net.isClock = cfg.clocked && port == cfg.clockPort;
                if (net.dir == PortDir::Out) cfg.portNets[port].push_back(static_cast<int>(cfg.nets.size()));
            }
        }
        cfg.nets.push_back(std::move(net));
    }

    const Json* parts = field(msg, "parts");
    if (!parts || !parts->is_array()) return "нет массива parts";
    if (parts->size() > 65535) return "слишком много деталей";
    for (const Json& item : *parts) {
        if (!item.is_object()) return "элемент parts должен быть объектом";
        const std::string* id = stringField(item, "id");
        const std::string* typeName = stringField(item, "type");
        const Json* pins = field(item, "pins");
        if (!id || id->empty() || !typeName || !pins || !pins->is_object()) return "у детали нужны id, type и pins";
        const std::string where = "деталь " + *id;
        const bool idOk =
            std::all_of(id->begin(), id->end(), [](unsigned char c) { return std::isalnum(c) || c == '_'; });
        if (!idOk) return {where + ": в id допустимы латиница, цифры и _", Json{{"reason", "partIdBad"}, {"part", *id}}};
        for (const auto& other : cfg.slots) {
            if (other->id == *id) return {where + " указана дважды", Json{{"reason", "partTwice"}, {"part", *id}}};
        }
        const PartType* type = findPartType(*typeName);
        if (!type)
            return {where + ": тип детали \"" + *typeName + "\" неизвестен",
                    Json{{"reason", "partTypeUnknown"}, {"part", *id}, {"type", *typeName}}};
        auto slot = std::make_unique<Slot>();
        slot->rt = this;
        slot->index = static_cast<int>(cfg.slots.size());
        slot->id = *id;
        slot->type = type;
        slot->roleNet.assign(type->pins.size(), -1);
        const Json* settings = field(item, "settings");
        if (Refusal err = resolveSettings(*type, settings ? *settings : Json(), slot->settings); err.failed()) {
            err.args["part"] = *id;
            return {where + ": " + err.text, std::move(err.args)};
        }
        for (const auto& [roleName, pinValue] : pins->items()) {
            int role = -1;
            for (size_t i = 0; i < type->pins.size(); ++i) {
                if (type->pins[i].role == roleName) role = static_cast<int>(i);
            }
            if (role < 0)
                return {where + ": роли вывода \"" + roleName + "\" не существует",
                        Json{{"reason", "partRoleUnknown"}, {"part", *id}, {"role", roleName}}};
            int net = -1;
            for (size_t i = 0; i < cfg.nets.size(); ++i) {
                if (pinValue.is_number_integer() && cfg.nets[i].pin == pinValue.get<int64_t>())
                    net = static_cast<int>(i);
            }
            if (net < 0)
                return {where + ": вывода " + pinValue.dump() + " нет в списке nets",
                        Json{{"reason", "partPinMissing"}, {"part", *id}, {"role", roleName}, {"pin", pinValue.dump()}}};
            slot->roleNet[role] = net;
            if (type->pins[role].out) {
                cfg.nets[net].drivers.push_back({slot->index, role, false, false});
            } else {
                cfg.nets[net].readers.push_back({slot->index, role, type->pins[role].edges});
            }
        }
        slot->part = type->factory();
        cfg.slots.push_back(std::move(slot));
    }

    const Json* watch = field(msg, "watch");
    if (!watch) return "нет поля watch";
    return checkWatch(*watch, cfg.watch);
}

void Runtime::Impl::onConfigure(const Json& msg, const Id& id) {
    Config cfg;
    if (Refusal err = buildConfig(msg, cfg); err.failed()) return fail(id, "CONFIG_INVALID", err.text, err.args);
    clocked_ = cfg.clocked;
    clockPort_ = cfg.clockPort;
    clocks_.clear();
    if (clocked_) clocks_.add(cfg.hz);
    nets_ = std::move(cfg.nets);
    slots_ = std::move(cfg.slots);
    portNets_ = std::move(cfg.portNets);
    watch_ = std::move(cfg.watch);
    configured_ = true;
    stepping_ = false;
    deferring_ = true;
    recorder_.clear();
    restart();
    run_ = Run::Paused;
    ok(id, Json{{"warnings", cfg.warnings}});
    sendState();
    flushDeferred();
    endChunk(0);
}

void Runtime::Impl::onSignals(const Id& id) {
    Json list = Json::array();
    uint32_t sig = 0;
    for (const SignalInfo& s : engine_->signals()) {
        Json item{{"sig", sig++}, {"path", s.path}, {"width", s.width}, {"kind", kindName(s.kind)}};
        if (s.kind == SignalKind::Memory) item["depth"] = std::max<uint32_t>(s.depth, 1);
        list.push_back(std::move(item));
    }
    ok(id, Json{{"signals", std::move(list)}});
}

bool Runtime::Impl::parseSpeed(const Json& value, bool& isMax, double& speed) const {
    if (value.is_string() && value.get_ref<const std::string&>() == "max") {
        isMax = true;
        return true;
    }
    if (!value.is_number()) return false;
    const double v = value.get<double>();
    if (!std::isfinite(v) || v <= 0) return false;
    isMax = false;
    speed = v;
    return true;
}

void Runtime::Impl::onRun(const Json& msg, const Id& id) {
    if (run_ == Run::Finished) return fail(id, "BAD_STATE", "модель завершилась; нужен reset");
    if (const Json* speed = field(msg, "speed")) {
        if (!parseSpeed(*speed, speedMax_, speed_))
            return fail(id, "BAD_MESSAGE", "speed — положительное число или max");
    }
    stepping_ = false;
    run_ = Run::Running;
    lastTickMs_ = host_.nowMs();
    carry_ = 0;
    samples_.clear();
    samples_.emplace_back(lastTickMs_, now_);
    slowFromMs_ = -1;
    slowNotified_ = false;
    ok(id);
    sendState();
}

void Runtime::Impl::onPause(const Id& id) {
    if (run_ == Run::Finished) return fail(id, "BAD_STATE", "модель завершилась; нужен reset");
    stepping_ = false;
    run_ = Run::Paused;
    ok(id);
    sendState();
    endChunk(0);
}

void Runtime::Impl::onStep(const Json& msg, const Id& id) {
    if (run_ != Run::Paused || stepping_) return fail(id, "BAD_STATE", "шаг допустим только на паузе");
    const std::string* unit = stringField(msg, "unit");
    if (!unit) return fail(id, "BAD_MESSAGE", "в step нет поля unit");
    Time target = 0;
    bool onChange = false;
    if (*unit == "cycle") {
        const std::optional<int64_t> count = intField(msg, "count", 1, int64_t{1} << 40);
        if (!count) return fail(id, "BAD_MESSAGE", "для шага по тактам нужно поле count от 1");
        if (!clocked_) return fail(id, "BAD_STATE", "у схемы нет такта: шаг по тактам невозможен");
        target = halfStart(clocks_.hz(0), clocks_.half(0) + 2 * static_cast<uint64_t>(*count));
    } else if (*unit == "time") {
        const std::string* text = stringField(msg, "ps");
        const std::optional<Time> ps = text ? parseTime(*text) : std::nullopt;
        if (!ps) return fail(id, "BAD_MESSAGE", "для шага по времени нужно поле ps — строка цифр");
        target = *ps > kNever - 1 - now_ ? kNever - 1 : now_ + *ps;
    } else if (*unit == "change") {
        target = now_ + kStepChangeLimitPs;
        onChange = true;
    } else {
        return fail(id, "BAD_MESSAGE", "unit — cycle, time или change");
    }
    stepping_ = true;
    stepTarget_ = std::max(target, now_);
    stepOnChange_ = onChange;
    stepRealMs_ = 0;
    ok(id);
}

void Runtime::Impl::onSpeed(const Json& msg, const Id& id) {
    const Json* speed = field(msg, "speed");
    if (!speed || !parseSpeed(*speed, speedMax_, speed_))
        return fail(id, "BAD_MESSAGE", "speed — положительное число или max");
    carry_ = 0;
    slowFromMs_ = -1;
    slowNotified_ = false;
    ok(id);
    sendState();
}

void Runtime::Impl::onReset(const Id& id) {
    stepping_ = false;
    deferring_ = true;
    recorder_.clear();
    restart();
    run_ = Run::Paused;
    ok(id);
    sendState();
    flushDeferred();
    endChunk(0);
}

void Runtime::Impl::onWatch(const Json& msg, const Id& id) {
    const Json* list = field(msg, "signals");
    std::vector<uint32_t> watch;
    if (!list) return fail(id, "BAD_MESSAGE", "в watch нет поля signals");
    if (std::string err = checkWatch(*list, watch); !err.empty()) return fail(id, "UNKNOWN_SIGNAL", err);
    watch_ = std::move(watch);
    ok(id);
}

void Runtime::Impl::onPart(const Json& msg, const Id& id) {
    const std::string* partId = stringField(msg, "part");
    const std::string* cmd = stringField(msg, "cmd");
    if (!partId || !cmd) return fail(id, "BAD_MESSAGE", "в команде детали нужны поля part и cmd");
    Slot* slot = findSlot(*partId);
    if (!slot) return fail(id, "UNKNOWN_PART", "детали \"" + *partId + "\" нет");
    const Json* given = field(msg, "args");
    const Json args = given ? *given : Json::object();
    if (Refusal err = checkCommand(*slot->type, *cmd, args); err.failed())
        return failPart(id, "PART_COMMAND_INVALID", *partId, std::move(err));
    slot->part->onCommand(*cmd, args);
    settleAll();
    flushRecorder();
    ok(id);
}

void Runtime::Impl::onPartSettings(const Json& msg, const Id& id) {
    const std::string* partId = stringField(msg, "part");
    const Json* given = field(msg, "settings");
    if (!partId || !given || !given->is_object())
        return fail(id, "BAD_MESSAGE", "в partSettings нужны поля part и settings");
    Slot* slot = findSlot(*partId);
    if (!slot) return fail(id, "UNKNOWN_PART", "детали \"" + *partId + "\" нет");
    Json wanted = slot->settings;
    wanted.update(*given);
    Json merged;
    if (Refusal err = resolveSettings(*slot->type, wanted, merged); err.failed())
        return failPart(id, "SETTINGS_INVALID", *partId, std::move(err));
    slot->settings = std::move(merged);
    slot->part->onSettings(slot->settings);
    settleAll();
    flushRecorder();
    ok(id);
}

bool Runtime::Impl::recordItem(const Json& ref, Recorder::Item& item, std::string& err) const {
    const std::vector<SignalInfo>& signals = engine_->signals();
    if (ref.is_number_unsigned()) {
        if (ref.get<uint64_t>() >= signals.size()) {
            err = "нет сигнала с номером " + ref.dump();
            return false;
        }
        const uint32_t sig = ref.get<uint32_t>();
        if (signals[sig].kind == SignalKind::Memory) {
            err = "память не записывается: " + signals[sig].path;
            return false;
        }
        item = {false, sig, signals[sig].path, signals[sig].width};
        return true;
    }
    const std::optional<int> pin = ref.is_string() ? parsePinName(ref.get_ref<const std::string&>()) : std::nullopt;
    if (!pin) {
        err = "сигнал записи — номер sig или строка pin:N";
        return false;
    }
    for (size_t i = 0; i < nets_.size(); ++i) {
        if (nets_[i].pin != *pin) continue;
        // The engine drives the clock net: its edges are visible only as the signal of the clock port.
        if (nets_[i].isClock) {
            item = {false, static_cast<uint32_t>(nets_[i].port), pinName(*pin), 1};
        } else {
            item = {true, static_cast<uint32_t>(i), pinName(*pin), 1};
        }
        return true;
    }
    err = "сети " + pinName(*pin) + " нет в configure";
    return false;
}

void Runtime::Impl::onRecordStart(const Json& msg, const Id& id) {
    Recorder::Options opt;
    std::string err;
    const Json* list = field(msg, "signals");
    if (!list || !list->is_array() || list->empty() || list->size() > 64)
        return fail(id, "RECORD_INVALID", "signals — массив от 1 до 64 сигналов");
    for (const Json& ref : *list) {
        Recorder::Item item;
        if (!recordItem(ref, item, err)) return fail(id, "RECORD_INVALID", err);
        opt.items.push_back(std::move(item));
    }
    const std::string* mode = stringField(msg, "mode");
    if (!mode || (*mode != "ring" && *mode != "window")) return fail(id, "RECORD_INVALID", "mode — ring или window");
    opt.mode = *mode == "ring" ? Recorder::Mode::Ring : Recorder::Mode::Window;
    if (msg.contains("depth")) {
        const std::optional<int64_t> depth = intField(msg, "depth", 1, 2'000'000);
        if (!depth) return fail(id, "RECORD_INVALID", "depth — от 1 до 2 000 000 изменений");
        opt.depth = static_cast<uint32_t>(*depth);
    }
    if (msg.contains("windowPs")) {
        const std::string* text = stringField(msg, "windowPs");
        const std::optional<Time> window = text ? parseTime(*text) : std::nullopt;
        if (!window) return fail(id, "RECORD_INVALID", "windowPs — строка цифр");
        opt.windowPs = *window;
    }
    if (const Json* trigger = field(msg, "trigger"); trigger && !trigger->is_null()) {
        const Json* signal = trigger->is_object() ? field(*trigger, "signal") : nullptr;
        const std::string* edge = trigger->is_object() ? stringField(*trigger, "edge") : nullptr;
        if (!signal || !edge) return fail(id, "RECORD_INVALID", "в trigger нужны поля signal и edge");
        if (!recordItem(*signal, opt.trigger, err)) return fail(id, "RECORD_INVALID", "trigger: " + err);
        if (*edge == "rise") {
            opt.edge = Recorder::Edge::Rise;
        } else if (*edge == "fall") {
            opt.edge = Recorder::Edge::Fall;
        } else if (*edge == "change") {
            opt.edge = Recorder::Edge::Change;
        } else {
            return fail(id, "RECORD_INVALID", "edge — rise, fall или change");
        }
        opt.hasTrigger = true;
    }
    Refusal refused = recorder_.start(std::move(opt), now_, [this](const Recorder::Item& item, uint32_t* words) {
        if (item.isNet) {
            words[0] = nets_[item.ref].level ? 1 : 0;
        } else {
            engine_->readSignal(item.ref, words);
        }
    });
    if (refused.failed()) return fail(id, "RECORD_INVALID", refused.text, refused.args);
    ok(id, Json{{"record", recorder_.id()}});
    flushRecorder();
}

void Runtime::Impl::onRecordStop(const Id& id) {
    if (!recorder_.active()) return fail(id, "NO_RECORD", "запись не идёт");
    recorder_.stop(now_);
    ok(id);
    flushRecorder();
}

void Runtime::Impl::onRecordFetch(const Json& msg, const Id& id) {
    const std::optional<int64_t> record = intField(msg, "record", 0, int64_t{1} << 32);
    if (!record) return fail(id, "BAD_MESSAGE", "в recordFetch нет поля record");
    if (!recorder_.exists() || recorder_.id() != static_cast<uint64_t>(*record))
        return fail(id, "UNKNOWN_RECORD", "записи с номером " + std::to_string(*record) + " нет");
    std::optional<Time> from;
    std::optional<Time> to;
    if (msg.contains("fromPs")) {
        const std::string* text = stringField(msg, "fromPs");
        from = text ? parseTime(*text) : std::nullopt;
        if (!from) return fail(id, "BAD_MESSAGE", "fromPs — строка цифр");
    }
    if (msg.contains("toPs")) {
        const std::string* text = stringField(msg, "toPs");
        to = text ? parseTime(*text) : std::nullopt;
        if (!to) return fail(id, "BAD_MESSAGE", "toPs — строка цифр");
    }
    recorder_.chunkEnd(now_);
    flushRecorder();
    ok(id, Json{{"info", recorder_.infoJson()}});
    recorder_.fetch(from ? &*from : nullptr, to ? &*to : nullptr, now_, [this](const Trace& trace) {
        encodeTrace(out_, traceSeq_++, now_, trace);
        host_.emitBinary(out_);
    });
    send(Json{{"t", "recordEnd"}, {"record", recorder_.id()}});
}

// ---------------------------------------------------------------------------------------------
// Nets
// ---------------------------------------------------------------------------------------------

void Runtime::Impl::driveNet(Slot& slot, int role, bool active, bool level) {
    const int netIndex = slot.netOf(role);
    if (netIndex < 0 || !slot.type->pins[role].out) return;
    for (Driver& d : nets_[netIndex].drivers) {
        if (d.part != slot.index || d.role != role) continue;
        if (d.active == active && (!active || d.level == level)) return;
        d.active = active;
        d.level = level;
        enqueue(netIndex);
        return;
    }
}

void Runtime::Impl::noticeFlags(Net& net, uint8_t flags) {
    const auto emit = [&](int slot, const char* code, const char* text) {
        if (net.lastNotice[slot] != kNever && now_ - net.lastNotice[slot] < kNoticePeriodPs) return;
        net.lastNotice[slot] = now_;
        notice(code, text, net.pin);
    };
    if ((flags & kNetFloating) && net.port >= 0 && net.dir == PortDir::In)
        emit(0, "INPUT_FLOATING", "вход ПЛИС ни к чему не подключён и не подтянут: на плате его уровень непредсказуем");
    if (flags & kNetConflict) emit(1, "NET_CONFLICT", "сетью управляют два источника с разными уровнями");
}

// Net level rules (spec section 5.4).
void Runtime::Impl::resolve(int netIndex) {
    Net& net = nets_[netIndex];
    if (net.isClock) return;
    int active = 0;
    bool first = false;
    bool differ = false;
    for (const Driver& d : net.drivers) {
        if (!d.active) continue;
        if (active == 0) first = d.level;
        differ = differ || d.level != first;
        ++active;
    }
    bool level = false;
    uint8_t flags = 0;
    if (net.port >= 0 && net.dir == PortDir::Out) {
        level = net.fpgaLevel;
        flags = kNetFpga;
        if (active > 0) {
            flags |= kNetPart;
            if (differ || first != level) flags |= kNetConflict;
        }
    } else if (active > 0) {
        level = first;
        flags = kNetPart;
        if (differ) flags |= kNetConflict;
    } else if (net.pull == Pull::None) {
        flags = kNetFloating;
    } else {
        level = net.pull == Pull::Up;
    }
    const uint8_t raised = flags & ~net.flags;
    net.flags = flags;
    if (!initializing_ && raised) noticeFlags(net, raised);
    if (level == net.level) return;
    if (!initializing_) {
        if (net.level) net.highTime += now_ - net.lastMark;
        net.lastMark = now_;
        ++net.toggles;
    }
    net.level = level;
    if (net.port >= 0 && net.dir == PortDir::In) {
        engine_->setInputBit(net.port, net.bit, level);
        inputsDirty_ = true;
    }
    if (initializing_) return;
    recorder_.onNet(static_cast<uint32_t>(netIndex), level, now_);
    for (const Reader& r : net.readers) {
        if (r.edges) slots_[r.part]->part->onEdge(r.role, level, now_);
    }
}

// Brings the nets and the model to a stable state at the current moment.
// Returns true if at least one FPGA output changed.
bool Runtime::Impl::settleAll() {
    bool outputsChanged = false;
    for (int round = 0; round < kMaxSettleRounds; ++round) {
        while (!queue_.empty()) {
            const int net = queue_.back();
            queue_.pop_back();
            nets_[net].queued = false;
            resolve(net);
        }
        if (inputsDirty_) {
            engine_->settle();
            inputsDirty_ = false;
        }
        const std::span<const int> changed = engine_->changedOutputs();
        if (changed.empty()) break;
        outputsChanged = true;
        for (const int port : changed) {
            if (portNets_[port].empty()) continue;
            engine_->readPort(port, words_.data());
            for (const int netIndex : portNets_[port]) {
                Net& net = nets_[netIndex];
                const bool bit = (words_[net.bit / 32] >> (net.bit % 32)) & 1u;
                if (bit == net.fpgaLevel) continue;
                net.fpgaLevel = bit;
                enqueue(netIndex);
            }
        }
    }
    if (recorder_.active()) recorder_.poll(now_);
    // A recording state change goes out at once: this keeps "recording" and "done" from merging into one message,
    // and the engine stops tracking signals as soon as the recording ends.
    if (recorder_.pending() && !initializing_) flushRecorder();
    return outputsChanged;
}

void Runtime::Impl::addWake(int part, Time t, uint32_t tag) {
    wakes_.push_back({t, wakeSeq_++, part, tag});
    std::push_heap(wakes_.begin(), wakes_.end(), std::greater<>());
}

void Runtime::Impl::cancelWake(int part, uint32_t tag) {
    const auto end =
        std::remove_if(wakes_.begin(), wakes_.end(), [&](const Wake& w) { return w.part == part && w.tag == tag; });
    if (end == wakes_.end()) return;
    wakes_.erase(end, wakes_.end());
    std::make_heap(wakes_.begin(), wakes_.end(), std::greater<>());
}

void Runtime::Impl::runWakes() {
    // Per-call limit: a part that asks for a wakeup at the current moment must not
    // loop the core past the chunk budget. The next round of advance() does the rest.
    for (int n = 0; n < kMaxWakesPerCall && !wakes_.empty() && wakes_.front().t <= now_; ++n) {
        std::pop_heap(wakes_.begin(), wakes_.end(), std::greater<>());
        const Wake w = wakes_.back();
        wakes_.pop_back();
        slots_[w.part]->part->onWake(w.tag, w.t);
    }
}

// ---------------------------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------------------------

// Return to the start: time 0, the model is created anew, the parts reset.
void Runtime::Impl::restart() {
    now_ = 0;
    ratio_ = 0;
    clocks_.rewind();
    wakes_.clear();
    queue_.clear();
    inputsDirty_ = false;
    carry_ = 0;
    engine_->reset();
    engine_->setClockPort(clocked_ ? clockPort_ : -1);
    engine_->setTracked({});
    for (Net& net : nets_) {
        net.level = false;
        net.fpgaLevel = false;
        net.flags = 0;
        net.queued = false;
        net.toggles = 0;
        net.highTime = 0;
        net.lastMark = 0;
        net.lastNotice[0] = net.lastNotice[1] = kNever;
        for (Driver& d : net.drivers) d.active = false;
    }
    initializing_ = true;
    for (auto& slot : slots_) {
        slot->rng = hashId(slot->id);  // a rerun gives the same sequence
        slot->dirty = true;
        if (!slot->attached) {
            slot->part->attach(*slot, slot->settings);
            slot->attached = true;
        }
        slot->part->reset();
    }
    for (size_t i = 0; i < nets_.size(); ++i) enqueue(static_cast<int>(i));
    inputsDirty_ = true;  // the first model evaluation already uses the initial input levels
    settleAll();
    initializing_ = false;
    for (Net& net : nets_) noticeFlags(net, net.flags);
    chunkStart_ = 0;
    chunkHalfStart_ = 0;
}

void Runtime::Impl::finishModel() {
    run_ = Run::Finished;
    stepping_ = false;
    notice("MODEL_FINISH", "модель завершила работу ($finish)");
    sendState();
}

// Counts up to the target. Invariant: all half-cycles that started strictly before now_ are executed.
// Returns true if the target is reached (or a stop condition fired), and false
// if the real-time budget ran out.
bool Runtime::Impl::advance(Time target, bool stopOnChange, double deadlineMs) {
    while (run_ != Run::Finished) {
        Time stop = target;
        if (!wakes_.empty() && wakes_.front().t < stop) stop = wakes_.front().t;
        if (clocked_) {
            const uint64_t hz = clocks_.hz(0);
            const uint64_t half = clocks_.half(0);
            const uint64_t halfStop = halfAtOrAfter(hz, stop);
            if (half < halfStop) {
                const RunResult r = engine_->run(std::min(halfStop - half, kPacketHalfSteps));
                clocks_.advance(0, r.halfSteps);
                if (r.halfSteps > 0) now_ = std::max(now_, halfStart(hz, clocks_.half(0) - 1));
                const bool outputsChanged = r.changed && settleAll();
                if (r.finished) {
                    finishModel();
                    return true;
                }
                if (stopOnChange && outputsChanged) return true;
                if (host_.nowMs() >= deadlineMs) return false;
                continue;
            }
        }
        now_ = std::max(now_, stop);
        if (!wakes_.empty() && wakes_.front().t <= now_) {
            runWakes();
            if (settleAll() && stopOnChange) return true;
            if (host_.nowMs() >= deadlineMs) return false;
            continue;
        }
        if (now_ >= target) return true;
    }
    return true;
}

void Runtime::Impl::finishStep() {
    stepping_ = false;
    if (run_ != Run::Finished) sendState();
    endChunk(static_cast<uint32_t>(std::min(stepRealMs_ * 1000.0, 4.0e9)));
}

// Time the clock spent high up to time t, when halves half-cycles are executed.
Time Runtime::Impl::clockHigh(Time t, uint64_t halves) const {
    const uint64_t hz = clocks_.hz(0);
    if (halves % 2 == 0) return halfStart(hz, halves) / 2;
    const Time rise = halfStart(hz, halves - 1);
    return rise / 2 + (t > rise ? t - rise : 0);
}

// Ends a chunk: closes net statistics, calls onChunkEnd on the parts, sends FRAME.
void Runtime::Impl::endChunk(uint32_t realUs) {
    const Time span = now_ - chunkStart_;
    for (auto& slot : slots_) slot->part->onChunkEnd();

    frame_.spanPs = span;
    frame_.cycle = cycle();
    frame_.realUs = realUs;
    frame_.ratio = ratio_;
    frame_.nets.clear();
    for (Net& net : nets_) {
        FrameNet out{};
        if (net.isClock) {
            const uint64_t half = clocks_.half(0);
            // Both values are approximate (to 1 ps), so the difference is taken without going below zero.
            const Time highNow = clockHigh(now_, half);
            const Time highStart = clockHigh(chunkStart_, chunkHalfStart_);
            const Time high = std::min(highNow > highStart ? highNow - highStart : 0, span);
            out.level = static_cast<uint8_t>(half & 1);
            out.toggles = static_cast<uint32_t>(std::min<uint64_t>(half - chunkHalfStart_, UINT32_MAX));
            out.duty = span ? static_cast<float>(static_cast<double>(high) / static_cast<double>(span))
                            : static_cast<float>(out.level);
        } else {
            const Time high = net.highTime + (net.level ? now_ - net.lastMark : 0);
            out.level = net.level ? 1 : 0;
            out.flags = net.flags;
            out.toggles = net.toggles;
            out.duty = span ? static_cast<float>(static_cast<double>(high) / static_cast<double>(span))
                            : static_cast<float>(out.level);
        }
        frame_.nets.push_back(out);
        net.toggles = 0;
        net.highTime = 0;
        net.lastMark = now_;
    }

    const std::vector<SignalInfo>& signals = engine_->signals();
    frame_.watch.resize(watch_.size());
    for (size_t i = 0; i < watch_.size(); ++i) {
        FrameWatch& w = frame_.watch[i];
        w.sig = watch_[i];
        w.width = signals[w.sig].width;
        w.words.assign(wordsFor(w.width), 0);
        engine_->readSignal(w.sig, w.words.data());
    }

    frame_.parts.clear();
    for (auto& slot : slots_) {
        if (!slot->dirty) continue;
        slot->dirty = false;
        stateBuf_.clear();
        ByteWriter w(stateBuf_);
        slot->part->writeState(w);
        if (!stateBuf_.empty()) frame_.parts.push_back({static_cast<uint16_t>(slot->index), stateBuf_});
    }

    encodeFrame(out_, frameSeq_++, now_, frame_);
    host_.emitBinary(out_);
    chunkStart_ = now_;
    chunkHalfStart_ = clocked_ ? clocks_.half(0) : 0;

    recorder_.chunkEnd(now_);
    flushRecorder();
}

// Passes out what the recording has accumulated: the tracking list, overflow, the state change.
void Runtime::Impl::flushRecorder() {
    if (recorder_.takeTrackedChanged()) {
        const std::vector<uint32_t> sigs = recorder_.trackedSignals();
        engine_->setTracked(sigs);
    }
    if (recorder_.takeOverflow()) notice("RECORD_OVERFLOW", "запись заполнена раньше конца окна");
    if (recorder_.takeStateChanged()) {
        send(recorder_.stateJson(now_));
        recordStateMs_ = host_.nowMs();
    }
}

void Runtime::Impl::tick(double nowMs) {
    if (!configured_) return;
    if (stepping_) {
        // A long step stretches over several calls; one frame goes out, at the end.
        const double start = host_.nowMs();
        const bool done = advance(stepTarget_, stepOnChange_, start + kChunkBudgetMs);
        stepRealMs_ += host_.nowMs() - start;
        if (done) finishStep();
        return;
    }
    if (run_ != Run::Running) return;

    // Target: current simulation time plus (elapsed real time x speed multiplier).
    const double elapsedMs = std::max(0.0, nowMs - lastTickMs_);
    lastTickMs_ = nowMs;
    // A design without a clock runs in real time (spec section 5.3): "max" equals multiplier 1 for it,
    // otherwise the simulation time in one chunk would run off to infinity.
    const bool unlimited = speedMax_ && clocked_;
    Time target = kNever - 1;
    if (!unlimited) {
        const double want = std::min(elapsedMs * 1e9 * (speedMax_ ? 1.0 : speed_) + carry_, 9.0e18);
        const Time whole = static_cast<Time>(want);
        carry_ = want - static_cast<double>(whole);
        target = whole > kNever - 1 - now_ ? kNever - 1 : now_ + whole;
    }
    const double start = host_.nowMs();
    const bool reached = advance(target, false, start + kChunkBudgetMs);
    const double end = host_.nowMs();
    if (!reached) carry_ = 0;  // lag does not accumulate

    // SLOW notice (decision 109): the simulation time over a three-second window is below 90% of the set speed.
    // The windows run back to back. The notice arrives once and re-arms after a window without lag.
    if (unlimited) {
        slowFromMs_ = -1;
        slowNotified_ = false;
    } else if (slowFromMs_ < 0) {
        slowFromMs_ = nowMs;
        slowFromTime_ = now_;
    } else if (nowMs - slowFromMs_ >= kSlowAfterMs) {
        const double wantPs = (nowMs - slowFromMs_) * 1e9 * (speedMax_ ? 1.0 : speed_);
        const bool slow = static_cast<double>(now_ - slowFromTime_) < kSlowRatio * wantPs;
        if (slow && !slowNotified_) notice("SLOW", "ядро не успевает за заданной скоростью");
        slowNotified_ = slow;
        slowFromMs_ = nowMs;
        slowFromTime_ = now_;
    }

    samples_.emplace_back(nowMs, now_);
    while (samples_.size() > 2 && nowMs - samples_[1].first >= kRatioWindowMs) samples_.pop_front();
    const double realMs = nowMs - samples_.front().first;
    if (realMs > 0) ratio_ = static_cast<float>(static_cast<double>(now_ - samples_.front().second) / 1e9 / realMs);

    endChunk(static_cast<uint32_t>(std::min(std::max(end - start, 0.0) * 1000.0, 4.0e9)));
    if (recorder_.active() && host_.nowMs() - recordStateMs_ >= kRecordStatePeriodMs) {
        send(recorder_.stateJson(now_));
        recordStateMs_ = host_.nowMs();
    }
}

// ---------------------------------------------------------------------------------------------

Runtime::Runtime(std::unique_ptr<Engine> engine, Host& host) : impl_(std::make_unique<Impl>(std::move(engine), host)) {}
Runtime::~Runtime() = default;
void Runtime::json(std::string_view text) { impl_->json(text); }
void Runtime::binary(std::span<const uint8_t> bytes) { impl_->binary(bytes); }
void Runtime::tick(double nowMs) { impl_->tick(nowMs); }

}  // namespace fpgasim
