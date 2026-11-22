// Time and clock (spec section 5.2). Time is picoseconds in uint64_t; arithmetic uses 128 bits.
#pragma once

#include <cstdint>
#include <limits>
#include <vector>

#include "fpgasim/part.h"

namespace fpgasim {

inline constexpr uint64_t kPsPerSecond = 1'000'000'000'000ull;
inline constexpr Time kNever = std::numeric_limits<Time>::max();

// Start of half-cycle h: floor(h × 10^12 / (2 × f)). An even half-cycle is the rising edge.
inline Time halfStart(uint64_t hz, uint64_t half) {
    const __uint128_t t = static_cast<__uint128_t>(half) * kPsPerSecond / (2 * static_cast<__uint128_t>(hz));
    return t > kNever ? kNever : static_cast<Time>(t);
}

// Smallest half-cycle index that starts no earlier than time t.
// It is also the number of half-cycles that started strictly before t.
inline uint64_t halfAtOrAfter(uint64_t hz, Time t) {
    const __uint128_t n = (static_cast<__uint128_t>(t) * 2 * hz + (kPsPerSecond - 1)) / kPsPerSecond;
    return n > std::numeric_limits<uint64_t>::max() ? std::numeric_limits<uint64_t>::max() : static_cast<uint64_t>(n);
}

// List of clock sources with non-multiple frequencies: the nearest edge is picked from all of them.
// The runtime uses one source (clocks_.add(cfg.hz) in onConfigure); the order for several is covered by test_clock.cpp.
class ClockList {
public:
    struct Edge {
        Time time;
        int clock;      // source index; -1 if there are no sources
        uint64_t half;  // half-cycle index of this source
        bool rising;
    };

    int add(uint64_t hz) {
        sources_.push_back({hz, 0});
        return static_cast<int>(sources_.size()) - 1;
    }
    void clear() { sources_.clear(); }
    void rewind() {
        for (Source& s : sources_) s.half = 0;
    }
    size_t size() const { return sources_.size(); }
    uint64_t hz(int clock) const { return sources_[clock].hz; }
    uint64_t half(int clock) const { return sources_[clock].half; }
    void advance(int clock, uint64_t halfSteps) { sources_[clock].half += halfSteps; }

    // Nearest pending edge. At equal time the source with the smaller index goes first.
    Edge next() const {
        Edge best{kNever, -1, 0, false};
        for (size_t i = 0; i < sources_.size(); ++i) {
            const Time t = halfStart(sources_[i].hz, sources_[i].half);
            if (t < best.time) best = {t, static_cast<int>(i), sources_[i].half, (sources_[i].half & 1) == 0};
        }
        return best;
    }

private:
    struct Source {
        uint64_t hz;
        uint64_t half;  // index of the next pending half-cycle
    };
    std::vector<Source> sources_;
};

}  // namespace fpgasim
