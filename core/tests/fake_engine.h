// Fake engine for runtime tests: a small "design" without Verilator.
//
//   input  clk
//   input  [1:0] btn
//   output [5:0] led    led[0] = ~btn[0], led[1] = ~btn[1], led[2] = q, led[3] = btn[0] & btn[1]
//   inout  io
//   output [69:0] wide  wide = {6'h2A, 32'h0, cnt}
//   reg [31:0] cnt      grows on every rising edge
//   reg q               toggles when cnt is a multiple of div
#pragma once

#include <cstring>
#include <string>
#include <vector>

#include "fpgasim/engine.h"

namespace fpgasim::test {

class FakeEngine final : public Engine {
public:
    enum Port { kClk = 0, kBtn = 1, kLed = 2, kIo = 3, kWide = 4 };
    enum Signal { kCnt = 5, kMem = 6, kDiv = 7, kQ = 8, kHuge = 9 };

    explicit FakeEngine(uint32_t div = 4) : div_(div) {
        ports_ = {{"clk", PortDir::In, 1},
                  {"btn", PortDir::In, 2},
                  {"led", PortDir::Out, 6},
                  {"io", PortDir::InOut, 1},
                  {"wide", PortDir::Out, 70}};
        for (const PortInfo& p : ports_) signals_.push_back({"top." + p.name, p.width, SignalKind::Port, 0});
        signals_.push_back({"top.cnt", 32, SignalKind::Reg, 0});
        signals_.push_back({"top.mem", 8, SignalKind::Memory, 16});
        signals_.push_back({"top.DIV", 32, SignalKind::Param, 0});
        signals_.push_back({"top.q", 1, SignalKind::Wire, 0});
        signals_.push_back({"top.huge", 512, SignalKind::Reg, 0});  // always zero; for the recording memory limit
        reset();
    }

    uint64_t finishAtCycle = 0;  // 0: the model never finishes
    int resets = 0;
    int settles = 0;
    uint64_t halfSteps = 0;

    EngineInfo info() const override { return {"verilator", "fake", "top"}; }
    const std::vector<PortInfo>& ports() const override { return ports_; }
    const std::vector<SignalInfo>& signals() const override { return signals_; }

    void reset() override {
        ++resets;
        half_ = 0;
        cnt_ = 0;
        q_ = false;
        btn_ = 0;
        finished_ = false;
        prevLed_ = led();
        prevCnt_ = cnt_;
        changed_ = {kLed, kWide};
        prevTracked_.clear();
        for (const uint32_t sig : tracked_) prevTracked_.push_back(value(sig));
    }

    void setClockPort(int port) override { clocked_ = port == kClk; }

    void setInputBit(int port, uint32_t bit, bool level) override {
        if (port != kBtn) return;
        btn_ = level ? (btn_ | (1u << bit)) : (btn_ & ~(1u << bit));
    }

    void settle() override {
        ++settles;
        compare();
    }

    RunResult run(uint64_t maxHalfSteps) override {
        if (!clocked_) return {0, false, false};
        uint64_t i = 0;
        while (i < maxHalfSteps) {
            if ((half_ & 1) == 0) {
                ++cnt_;
                if (cnt_ % div_ == 0) q_ = !q_;
                if (finishAtCycle && cnt_ == finishAtCycle) finished_ = true;
            }
            ++half_;
            ++halfSteps;
            ++i;
            const bool outputs = compare();
            const bool tracked = trackedChanged();
            if (outputs || tracked || finished_) return {i, outputs || tracked, finished_};
        }
        return {i, false, false};
    }

    void readPort(int port, uint32_t* words) const override { readSignal(static_cast<uint32_t>(port), words); }

    void readSignal(uint32_t sig, uint32_t* words) const override {
        std::memset(words, 0, 4 * wordsFor(signals_[sig].width));
        words[0] = static_cast<uint32_t>(value(sig));
        if (sig == kWide) words[2] = 0x2a;
    }

    void setTracked(std::span<const uint32_t> sigs) override {
        tracked_.assign(sigs.begin(), sigs.end());
        prevTracked_.clear();
        for (const uint32_t sig : tracked_) prevTracked_.push_back(value(sig));
    }

    std::span<const int> changedOutputs() override {
        out_.swap(changed_);
        changed_.clear();
        return out_;
    }

    const std::vector<uint32_t>& tracked() const { return tracked_; }

private:
    uint32_t led() const {
        const uint32_t b0 = btn_ & 1, b1 = (btn_ >> 1) & 1;
        return (b0 ^ 1) | ((b1 ^ 1) << 1) | (static_cast<uint32_t>(q_) << 2) | ((b0 & b1) << 3);
    }

    uint64_t value(uint32_t sig) const {
        switch (sig) {
            case kClk:
                return (half_ & 1) ? 1 : 0;
            case kBtn:
                return btn_;
            case kLed:
                return led();
            case kWide:
            case kCnt:
                return cnt_;
            case kDiv:
                return div_;
            case kQ:
                return q_;
            default:
                return 0;
        }
    }

    void mark(int port) {
        for (const int p : changed_) {
            if (p == port) return;
        }
        changed_.push_back(port);
    }

    bool compare() {
        bool any = false;
        if (led() != prevLed_) {
            prevLed_ = led();
            mark(kLed);
            any = true;
        }
        if (cnt_ != prevCnt_) {  // port wide changes together with the counter
            prevCnt_ = cnt_;
            if (wideIsOutput) {
                mark(kWide);
                any = true;
            }
        }
        return any;
    }

    bool trackedChanged() {
        bool any = false;
        for (size_t i = 0; i < tracked_.size(); ++i) {
            const uint64_t v = value(tracked_[i]);
            if (v != prevTracked_[i]) {
                prevTracked_[i] = v;
                any = true;
            }
        }
        return any;
    }

public:
    // Port wide changes on every clock and would stop the loop all the time;
    // tests enable its comparison only where it is needed.
    bool wideIsOutput = false;

private:
    std::vector<PortInfo> ports_;
    std::vector<SignalInfo> signals_;
    uint32_t div_;
    bool clocked_ = false;
    uint64_t half_ = 0;
    uint32_t cnt_ = 0;
    bool q_ = false;
    uint32_t btn_ = 0;
    bool finished_ = false;
    uint32_t prevLed_ = 0;
    uint32_t prevCnt_ = 0;
    std::vector<int> changed_;
    std::vector<int> out_;
    std::vector<uint32_t> tracked_;
    std::vector<uint64_t> prevTracked_;
};

}  // namespace fpgasim::test
