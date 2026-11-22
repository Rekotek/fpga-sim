// Fake engine for part tests: output wave toggles on a given list of clocks,
// output tx repeats input rx (a loop for UART).
//
//   input  clk
//   input  rx
//   output tx     tx = rx
//   output wave   toggles on rising edges with the indexes from toggles (counted from one)
#pragma once

#include <string>
#include <vector>

#include "fpgasim/engine.h"

namespace fpgasim::test {

class ScriptEngine final : public Engine {
public:
    enum Port { kClk = 0, kRx = 1, kTx = 2, kWave = 3 };

    ScriptEngine() {
        ports_ = {{"clk", PortDir::In, 1}, {"rx", PortDir::In, 1}, {"tx", PortDir::Out, 1}, {"wave", PortDir::Out, 1}};
        for (const PortInfo& p : ports_) signals_.push_back({"top." + p.name, p.width, SignalKind::Port, 0});
        reset();
    }

    std::vector<uint64_t> toggles;  // clock indexes in ascending order
    bool waveInit = false;          // wave level at the start

    EngineInfo info() const override { return {"verilator", "script", "top"}; }
    const std::vector<PortInfo>& ports() const override { return ports_; }
    const std::vector<SignalInfo>& signals() const override { return signals_; }

    void reset() override {
        half_ = 0;
        cycle_ = 0;
        next_ = 0;
        rx_ = false;
        wave_ = waveInit;
        prevTx_ = rx_;
        prevWave_ = wave_;
        changed_ = {kTx, kWave};
    }

    void setClockPort(int port) override { clocked_ = port == kClk; }
    void setInputBit(int port, uint32_t, bool level) override {
        if (port == kRx) rx_ = level;
    }
    void settle() override { compare(); }

    RunResult run(uint64_t maxHalfSteps) override {
        if (!clocked_) return {0, false, false};
        uint64_t i = 0;
        while (i < maxHalfSteps) {
            if ((half_ & 1) == 0) {
                ++cycle_;
                while (next_ < toggles.size() && toggles[next_] == cycle_) {
                    wave_ = !wave_;
                    ++next_;
                }
            }
            ++half_;
            ++i;
            if (compare()) return {i, true, false};
        }
        return {i, false, false};
    }

    void readPort(int port, uint32_t* words) const override { readSignal(static_cast<uint32_t>(port), words); }
    void readSignal(uint32_t sig, uint32_t* words) const override {
        words[0] = sig == kClk ? (half_ & 1) : sig == kRx ? rx_ : sig == kTx ? rx_ : wave_;
    }
    void setTracked(std::span<const uint32_t>) override {}
    std::span<const int> changedOutputs() override {
        out_.swap(changed_);
        changed_.clear();
        return out_;
    }

private:
    bool compare() {
        bool any = false;
        if (rx_ != prevTx_) {
            prevTx_ = rx_;
            changed_.push_back(kTx);
            any = true;
        }
        if (wave_ != prevWave_) {
            prevWave_ = wave_;
            changed_.push_back(kWave);
            any = true;
        }
        return any;
    }

    std::vector<PortInfo> ports_;
    std::vector<SignalInfo> signals_;
    bool clocked_ = false;
    uint64_t half_ = 0;
    uint64_t cycle_ = 0;
    size_t next_ = 0;
    bool rx_ = false;
    bool wave_ = false;
    bool prevTx_ = false;
    bool prevWave_ = false;
    std::vector<int> changed_;
    std::vector<int> out_;
};

}  // namespace fpgasim::test
