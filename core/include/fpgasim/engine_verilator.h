// Shared part of the Verilator engine (spec section 7.2). The template compiles together with the model:
// the shim.cpp shim defines the port list, access to port data and the output comparison.
#pragma once

#include <bit>
#include <cstdint>
#include <cstring>
#include <memory>
#include <span>
#include <string>
#include <type_traits>
#include <vector>

#include "fpgasim/engine.h"
#include "verilated.h"
#include "verilated_syms.h"

namespace fpgasim {

// Model values are read as a sequence of bytes, least significant first.
static_assert(std::endian::native == std::endian::little, "движок рассчитан на прямой порядок байтов");

struct PortDesc {
    const char* name;
    PortDir dir;
    uint32_t width;
};

// Size of a Verilator value in bytes: CData, SData, IData, QData or VlWide.
constexpr uint32_t valueBytes(uint32_t width) {
    return width <= 8 ? 1 : width <= 16 ? 2 : width <= 32 ? 4 : width <= 64 ? 8 : 4 * wordsFor(width);
}

inline void readWords(const void* data, uint32_t width, uint32_t* words) {
    std::memset(words, 0, 4 * wordsFor(width));
    std::memcpy(words, data, valueBytes(width));
}

template <class T>
inline bool differs(const T& a, const T& b) {
    if constexpr (std::is_arithmetic_v<T>) {
        return a != b;
    } else {
        return std::memcmp(&a, &b, sizeof(T)) != 0;
    }
}

#define FPGASIM_DIFFERS(a, b) (::fpgasim::differs((a), (b)))
#define FPGASIM_COPY(dst, src) ((dst) = (src))

// Derived (the shim) defines:
//   static constexpr PortDesc kPorts[];      ports in the order of the Vtop.h header
//   static constexpr const char* kTop;       top module name
//   void* portData(int port);                pointer to the port data
//   bool outputsChanged();                   compare outputs with the previous value, markChanged(port)
// and calls init() in its constructor.
template <class Model, class Derived>
class VerilatorEngine : public Engine {
public:
    EngineInfo info() const override { return {"verilator", Verilated::productVersion(), Derived::kTop}; }
    const std::vector<PortInfo>& ports() const override { return ports_; }
    const std::vector<SignalInfo>& signals() const override { return signals_; }

    void reset() override {
        create();
        bindTracked();
    }

    void setClockPort(int port) override {
        clockPort_ = port;
        clk_ = port < 0 ? nullptr : static_cast<CData*>(self().portData(port));
    }

    void setInputBit(int port, uint32_t bit, bool level) override {
        writeBit(self().portData(port), bit, level);
        // In all mode a port has a copy inside the top module, and the model looks for the edge on that copy.
        // Before the first evaluation the copy gets the same initial level; otherwise an input that
        // is one from the start would produce a false edge at time 0.
        if (!evaluated_ && alias_[port]) writeBit(alias_[port], bit, level);
    }

    void settle() override {
        evaluated_ = true;
        top_->eval();
        self().outputsChanged();
    }

    RunResult run(uint64_t maxHalfSteps) override {
        if (!clk_) return {0, false, false};
        evaluated_ = true;
        uint64_t i = 0;
        while (i < maxHalfSteps) {
            *clk_ = (half_ & 1) ? 0 : 1;  // even half-cycle: rising edge
            top_->eval();
            ++half_;
            ++i;
            // Both checks always run: otherwise, when an output changes, the previous values
            // of the tracked signals go stale, and their next change is lost.
            const bool outputs = self().outputsChanged();
            const bool tracked = tracking_ && trackedChanged();
            const bool finished = ctx_->gotFinish();
            if (outputs || tracked || finished) return {i, outputs || tracked, finished};
        }
        return {i, false, false};
    }

    void readPort(int port, uint32_t* words) const override { readWords(data_[port], ports_[port].width, words); }
    void readSignal(uint32_t sig, uint32_t* words) const override { readWords(data_[sig], signals_[sig].width, words); }

    void setTracked(std::span<const uint32_t> sigs) override {
        trackedSigs_.assign(sigs.begin(), sigs.end());
        bindTracked();
    }

    std::span<const int> changedOutputs() override {
        changedOut_.swap(changed_);
        changed_.clear();
        for (const int port : changedOut_) changedFlag_[port] = 0;
        return changedOut_;
    }

protected:
    // Called from the shim constructor: ports and the model are reachable only through Derived.
    void init() {
        const int count = static_cast<int>(sizeof(Derived::kPorts) / sizeof(Derived::kPorts[0]));
        for (int i = 0; i < count; ++i) {
            const PortDesc& p = Derived::kPorts[i];
            ports_.push_back({p.name, p.dir, p.width});
        }
        changedFlag_.assign(ports_.size(), 0);
        create();
    }

    Derived& self() { return static_cast<Derived&>(*this); }

    void markChanged(int port) {
        if (changedFlag_[port]) return;
        changedFlag_[port] = 1;
        changed_.push_back(port);
    }

    std::unique_ptr<VerilatedContext> ctx_;
    std::unique_ptr<Model> top_;

private:
    struct Tracked {
        const void* data;
        uint32_t bytes;
        uint32_t offset;  // where the previous value sits in trackedPrev_
    };

    // Name of the model instance. Verilator scopes are named "<name>.TOP" (port copies)
    // and "<name>.<top module>..." (design hierarchy); the instance name is dropped from signal paths.
    static constexpr const char* kInstance = "m";

    // Creates the model anew and lists the signals. The signal order is the same from run to run:
    // ports in kPorts order, then scopes and variables by name.
    void create() {
        top_.reset();
        ctx_ = std::make_unique<VerilatedContext>();
        // $stop and $fatal do not abort the process; they finish the model, like $finish.
        ctx_->fatalOnError(false);
        top_ = std::make_unique<Model>(ctx_.get(), kInstance);
        half_ = 0;
        evaluated_ = false;
        alias_.assign(ports_.size(), nullptr);
        setClockPort(clockPort_);

        signals_.clear();
        data_.clear();
        const std::string topName = Derived::kTop;
        for (size_t i = 0; i < ports_.size(); ++i) {
            signals_.push_back({topName + "." + ports_[i].name, ports_[i].width, SignalKind::Port, 0});
            data_.push_back(self().portData(static_cast<int>(i)));
        }
        enumerateScopes(topName);

        // The runtime does the first evaluation of the model by calling settle(), once the inputs
        // have their initial levels; otherwise an input with a pull-up would produce a false edge at time 0.
        // After the model is recreated, the runtime rereads all outputs.
        for (size_t i = 0; i < ports_.size(); ++i) {
            if (ports_[i].dir == PortDir::Out) markChanged(static_cast<int>(i));
        }
    }

    // Internal signals through the Verilator scope and variable descriptions, without VPI (all mode).
    void enumerateScopes(const std::string& topName) {
        const VerilatedScopeNameMap* scopes = ctx_->scopeNameMap();
        if (!scopes) return;
        const std::string instancePrefix = std::string(kInstance) + ".";
        const std::string portScope = instancePrefix + "TOP";
        for (const auto& scopeEntry : *scopes) {
            const VerilatedScope* scope = scopeEntry.second;
            const std::string scopeName = scope->name();
            const VerilatedVarNameMap* vars = scope->varsp();
            if (!vars || scopeName == portScope || scopeName.rfind(instancePrefix, 0) != 0) continue;
            const std::string path = scopeName.substr(instancePrefix.size());
            for (const auto& varEntry : *vars) {
                const VerilatedVar& var = varEntry.second;
                const VerilatedVarType type = var.vltype();
                if (type != VLVT_UINT8 && type != VLVT_UINT16 && type != VLVT_UINT32 && type != VLVT_UINT64 &&
                    type != VLVT_WDATA)
                    continue;  // strings and real numbers are not shown
                // Top module ports already stand at the start of the list.
                if (const int port = path == topName ? portIndex(var.name()) : -1; port >= 0) {
                    alias_[port] = var.datap();
                    continue;
                }
                SignalInfo info;
                info.path = path + "." + var.name();
                info.width = static_cast<uint32_t>(var.entBits());
                info.depth = 0;
                if (var.isParam()) {
                    info.kind = SignalKind::Param;
                } else if (var.udims() > 0) {
                    info.kind = SignalKind::Memory;
                    info.depth = static_cast<uint32_t>(var.elements(1));
                } else {
                    info.kind = var.isNet() ? SignalKind::Wire : SignalKind::Reg;
                }
                signals_.push_back(std::move(info));
                data_.push_back(var.datap());
            }
        }
    }

    int portIndex(const char* name) const {
        for (size_t i = 0; i < ports_.size(); ++i) {
            if (ports_[i].name == name) return static_cast<int>(i);
        }
        return -1;
    }

    static void writeBit(void* data, uint32_t bit, bool level) {
        uint8_t* bytes = static_cast<uint8_t*>(data);
        const uint8_t mask = static_cast<uint8_t>(1u << (bit % 8));
        bytes[bit / 8] = level ? (bytes[bit / 8] | mask) : (bytes[bit / 8] & static_cast<uint8_t>(~mask));
    }

    void bindTracked() {
        tracked_.clear();
        uint32_t offset = 0;
        for (const uint32_t sig : trackedSigs_) {
            if (sig >= signals_.size() || signals_[sig].kind == SignalKind::Memory) continue;
            const uint32_t bytes = valueBytes(signals_[sig].width);
            tracked_.push_back({data_[sig], bytes, offset});
            offset += bytes;
        }
        trackedPrev_.resize(offset);
        for (const Tracked& t : tracked_) std::memcpy(&trackedPrev_[t.offset], t.data, t.bytes);
        tracking_ = !tracked_.empty();
    }

    // Compares all tracked signals: the previous values are updated for every one.
    bool trackedChanged() {
        bool changed = false;
        for (const Tracked& t : tracked_) {
            if (std::memcmp(t.data, &trackedPrev_[t.offset], t.bytes) != 0) {
                std::memcpy(&trackedPrev_[t.offset], t.data, t.bytes);
                changed = true;
            }
        }
        return changed;
    }

    std::vector<PortInfo> ports_;
    std::vector<SignalInfo> signals_;
    std::vector<const void*> data_;  // signal data; the first ones are ports
    std::vector<void*> alias_;       // port copy inside the top module (all mode) or nullptr
    bool evaluated_ = false;         // the model has been evaluated since it was created
    CData* clk_ = nullptr;
    int clockPort_ = -1;
    uint64_t half_ = 0;
    std::vector<int> changed_;
    std::vector<int> changedOut_;
    std::vector<uint8_t> changedFlag_;
    std::vector<uint32_t> trackedSigs_;
    std::vector<Tracked> tracked_;
    std::vector<uint8_t> trackedPrev_;
    bool tracking_ = false;
};

}  // namespace fpgasim
