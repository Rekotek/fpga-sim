// Benchmark: simplified engine per spec sections 7.1 and 7.2.
// It holds only what the measurement needs: the clock loop, output check,
// port reading and signal listing. There is no rest of the runtime.
#pragma once

#include <cstdint>
#include <cstring>
#include <memory>
#include <string>
#include <type_traits>
#include <vector>

#include "verilated.h"
#include "verilated_syms.h"

namespace fpgasim {

enum class PortDir { In, Out, InOut };

struct PortDesc {
    const char* name;
    PortDir dir;
    uint32_t width;
};

struct SignalInfo {
    std::string path;
    uint32_t width;
    uint32_t depth;  // 0: not a memory
    bool isParam;
    const void* data;  // direct pointer to the model data
};

struct RunResult {
    uint64_t halfSteps;  // how many half cycles were run
    bool changed;        // stopped by an output or a recorded signal
    bool finished;       // the model called $finish
};

// Read a model value into 32-bit words, least significant first.
inline void readWords(const void* p, uint32_t width, uint32_t* words) {
    if (width <= 8) {
        words[0] = *static_cast<const CData*>(p);
    } else if (width <= 16) {
        words[0] = *static_cast<const SData*>(p);
    } else if (width <= 32) {
        words[0] = *static_cast<const IData*>(p);
    } else if (width <= 64) {
        const QData q = *static_cast<const QData*>(p);
        words[0] = static_cast<uint32_t>(q);
        words[1] = static_cast<uint32_t>(q >> 32);
    } else {
        std::memcpy(words, p, 4 * ((width + 31) / 32));
    }
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

class Engine {
public:
    virtual ~Engine() = default;
    virtual int portCount() const = 0;
    virtual const PortDesc& port(int index) const = 0;
    virtual std::vector<SignalInfo> signals() = 0;
    virtual void setClockPort(int port) = 0;           // -1: no clock
    virtual void settle() = 0;                         // recompute after the inputs change
    virtual RunResult run(uint64_t maxHalfSteps) = 0;  // inner clock loop
    virtual void readPort(int port, uint32_t* words) = 0;
    virtual uint64_t takeChangedOutputs() = 0;  // mask of ports that changed since the last call
};

std::unique_ptr<Engine> createEngine();  // defined by the shim

template <class Model, class Derived>
class VerilatorEngine : public Engine {
public:
    VerilatorEngine() : ctx_(std::make_unique<VerilatedContext>()), top_(std::make_unique<Model>(ctx_.get(), "top")) {}

    int portCount() const override { return static_cast<int>(sizeof(Derived::kPorts) / sizeof(Derived::kPorts[0])); }
    const PortDesc& port(int index) const override { return Derived::kPorts[index]; }

    void setClockPort(int port) override { clk_ = port < 0 ? nullptr : static_cast<CData*>(self().portData(port)); }

    void settle() override {
        top_->eval();
        self().outputsChanged();
    }

    RunResult run(uint64_t maxHalfSteps) override {
        uint64_t i = 0;
        while (i < maxHalfSteps) {
            *clk_ = (half_ & 1) ? 0 : 1;  // even half cycle: rising edge
            top_->eval();
            ++half_;
            ++i;
            if (self().outputsChanged() || (tracking_ && trackedChanged())) return {i, true, false};
            if (ctx_->gotFinish()) return {i, false, true};
        }
        return {i, false, false};
    }

    void readPort(int port, uint32_t* words) override {
        readWords(self().portData(port), Derived::kPorts[port].width, words);
    }

    uint64_t takeChangedOutputs() override {
        const uint64_t mask = changed_;
        changed_ = 0;
        return mask;
    }

    // Signal listing through the scope and variable descriptions of Verilator, without VPI.
    std::vector<SignalInfo> signals() override {
        std::vector<SignalInfo> out;
        const VerilatedScopeNameMap* scopes = ctx_->scopeNameMap();
        if (!scopes) return out;
        for (const auto& scopeEntry : *scopes) {
            const VerilatedScope* scope = scopeEntry.second;
            const VerilatedVarNameMap* vars = scope->varsp();
            if (!vars) continue;
            for (const auto& varEntry : *vars) {
                const VerilatedVar& var = varEntry.second;
                SignalInfo info;
                info.path = std::string(scope->name()) + "." + var.name();
                info.width = var.entBits();
                info.depth = var.udims() > 0 ? static_cast<uint32_t>(var.elements(var.pdims() > 0 ? 1 : 0)) : 0;
                info.isParam = var.isParam();
                info.data = var.datap();
                out.push_back(std::move(info));
            }
        }
        return out;
    }

protected:
    Derived& self() { return static_cast<Derived&>(*this); }
    void markChanged(int port) { changed_ |= uint64_t{1} << port; }
    bool trackedChanged() { return false; }  // the bench does not record signals

    std::unique_ptr<VerilatedContext> ctx_;
    std::unique_ptr<Model> top_;
    CData* clk_ = nullptr;
    uint64_t half_ = 0;
    uint64_t changed_ = 0;
    bool tracking_ = false;
};

}  // namespace fpgasim
