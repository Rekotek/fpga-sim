// Engine interface (spec section 7.1). The runtime knows only this interface.
#pragma once

#include <cstdint>
#include <memory>
#include <span>
#include <string>
#include <vector>

namespace fpgasim {

enum class PortDir { In, Out, InOut };
enum class SignalKind { Port, Wire, Reg, Memory, Param };

struct PortInfo {
    std::string name;
    PortDir dir;
    uint32_t width;
};

struct SignalInfo {
    std::string path;
    uint32_t width;
    SignalKind kind;
    uint32_t depth;  // memory depth; 0 for the others
};

// Data for the ready message.
struct EngineInfo {
    std::string name;     // "verilator"
    std::string version;  // engine version
    std::string top;      // top module name
};

struct RunResult {
    uint64_t halfSteps;  // number of half-cycles executed
    bool changed;        // stopped because of an output or a tracked signal
    bool finished;       // the model called $finish
};

// Number of 32-bit words for a value of the given width.
constexpr uint32_t wordsFor(uint32_t width) { return (width + 31) / 32; }

class Engine {
public:
    virtual ~Engine() = default;
    virtual EngineInfo info() const = 0;
    virtual const std::vector<PortInfo>& ports() const = 0;
    // The first ports().size() signals are the ports in the same order: port index equals signal index.
    virtual const std::vector<SignalInfo>& signals() const = 0;
    virtual void reset() = 0;                 // the model is created anew; all outputs count as changed
    virtual void setClockPort(int port) = 0;  // -1: no clock
    virtual void setInputBit(int port, uint32_t bit, bool level) = 0;
    virtual void settle() = 0;                                   // recompute after inputs change
    virtual RunResult run(uint64_t maxHalfSteps) = 0;            // inner clock loop
    virtual void readPort(int port, uint32_t* words) const = 0;  // wordsFor(width) words, least significant first
    virtual void readSignal(uint32_t sig, uint32_t* words) const = 0;
    virtual void setTracked(std::span<const uint32_t> sigs) = 0;  // tracked (written) signals
    virtual std::span<const int> changedOutputs() = 0;            // ports that changed since the previous call
};

std::unique_ptr<Engine> createEngine();  // defined by the shim

}  // namespace fpgasim
