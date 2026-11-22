// WS2812 (spec section 6.4): the part measures the high time and the period of each bit.
// A pause at zero longer than 50 us latches the received bits: the first 24 go to the first LED.
#include <algorithm>
#include <vector>

#include "parts.h"

namespace fpgasim {

namespace {

constexpr int kRoleDin = 0;
constexpr uint32_t kTagLatch = 1;
constexpr Time kPsPerNs = 1000;
constexpr Time kZeroMinPs = 200 * kPsPerNs;  // a high of 200-500 ns reads as 0
constexpr Time kZeroMaxPs = 500 * kPsPerNs;
constexpr Time kOneMinPs = 550 * kPsPerNs;  // a high of 550-1000 ns reads as 1
constexpr Time kOneMaxPs = 1000 * kPsPerNs;
constexpr Time kSplitPs = 525 * kPsPerNs;  // a pulse outside both windows reads by the nearest window
constexpr Time kPeriodMinPs = 900 * kPsPerNs;
constexpr Time kPeriodMaxPs = 1900 * kPsPerNs;
constexpr Time kResetPs = 50'000 * kPsPerNs;  // 50 us

class Ws2812 final : public Part {
public:
    void attach(PartHost& host, const Json& settings) override {
        host_ = &host;
        readSettings(settings);
    }

    void reset() override {
        host_->cancelWake(kTagLatch);
        wakePending_ = false;
        haveRise_ = false;
        haveFall_ = false;
        bits_ = 0;
        frameErrors_ = 0;
        errors_ = 0;
        std::fill(incoming_.begin(), incoming_.end(), 0);
        std::fill(shown_.begin(), shown_.end(), 0);
        host_->markDirty();
    }

    void onEdge(int role, bool level, Time t) override {
        if (role != kRoleDin) return;
        if (level) {
            if (haveFall_ && t - lastFall_ > kResetPs) {
                latch();
            } else if (haveRise_ && bits_ > 0) {
                const Time period = t - lastRise_;
                if (period < kPeriodMinPs || period > kPeriodMaxPs) error(false, period, bits_ - 1);
            }
            lastRise_ = t;
            haveRise_ = true;
            return;
        }
        if (!haveRise_) return;  // the line was high before the start: the pulse is not measured
        const Time high = t - lastRise_;
        const bool inZero = high >= kZeroMinPs && high <= kZeroMaxPs;
        const bool inOne = high >= kOneMinPs && high <= kOneMaxPs;
        if (!inZero && !inOne) error(true, high, bits_);
        addBit(high >= kSplitPs);
        lastFall_ = t;
        haveFall_ = true;
        if (!wakePending_) {
            wakePending_ = true;
            host_->wakeAt(lastFall_ + kResetPs + 1, kTagLatch);
        }
    }

    // One wakeup per pause: if the line switched in the meantime, the wakeup is moved.
    void onWake(uint32_t tag, Time t) override {
        if (tag != kTagLatch) return;
        wakePending_ = false;
        if (host_->level(kRoleDin) || !haveFall_) return;
        if (t - lastFall_ > kResetPs) {
            latch();
        } else {
            wakePending_ = true;
            host_->wakeAt(lastFall_ + kResetPs + 1, kTagLatch);
        }
    }

    void onSettings(const Json& settings) override {
        readSettings(settings);
        host_->markDirty();
    }

    void writeState(ByteWriter& out) const override {
        out.u16(static_cast<uint16_t>(count_));
        out.u16(0);
        out.u32(errors_);
        // The color order applies at output: a change of the order setting shows at once.
        for (size_t i = 0; i + 2 < shown_.size(); i += 3) {
            out.u8(rgbOrder_ ? shown_[i] : shown_[i + 1]);
            out.u8(rgbOrder_ ? shown_[i + 1] : shown_[i]);
            out.u8(shown_[i + 2]);
        }
    }

private:
    void readSettings(const Json& settings) {
        const int64_t count = settings.value("count", int64_t{1});
        count_ = static_cast<size_t>(std::clamp<int64_t>(count, 1, 256));
        rgbOrder_ = settings.value("order", "GRB") == "RGB";
        incoming_.resize(count_ * 3, 0);
        shown_.resize(count_ * 3, 0);
    }

    // Bits go most significant first. Bits beyond count are counted and dropped.
    void addBit(bool one) {
        const size_t byte = bits_ / 8;
        if (byte < incoming_.size()) {
            const uint8_t mask = static_cast<uint8_t>(0x80u >> (bits_ % 8));
            incoming_[byte] = one ? (incoming_[byte] | mask) : (incoming_[byte] & static_cast<uint8_t>(~mask));
        }
        ++bits_;
    }

    void error(bool isHigh, Time value, size_t bit) {
        if (frameErrors_ == 0) {
            firstIsHigh_ = isHigh;
            firstValue_ = value;
            firstBit_ = bit;
        }
        ++frameErrors_;
        ++errors_;
    }

    // Received triples become colors; LEDs the data did not reach keep their color.
    void latch() {
        if (bits_ == 0 && frameErrors_ == 0) return;
        const size_t leds = std::min(bits_ / 24, count_);
        std::copy_n(incoming_.begin(), leds * 3, shown_.begin());
        if (frameErrors_ > 0) {
            // At most one event per latch: the first frame error and the counters.
            Json data{{"bit", firstBit_}, {"count", frameErrors_}, {"total", errors_}};
            data[firstIsHigh_ ? "highNs" : "periodNs"] =
                static_cast<double>(firstValue_) / static_cast<double>(kPsPerNs);
            host_->emitEvent("timingError", data);
        }
        bits_ = 0;
        frameErrors_ = 0;
        host_->markDirty();
    }

    PartHost* host_ = nullptr;
    size_t count_ = 1;
    bool rgbOrder_ = false;

    bool haveRise_ = false;
    bool haveFall_ = false;
    Time lastRise_ = 0;
    Time lastFall_ = 0;
    bool wakePending_ = false;

    size_t bits_ = 0;                // bits received since the last latch
    std::vector<uint8_t> incoming_;  // bytes being received, in arrival order
    std::vector<uint8_t> shown_;     // triples after the last latch, in arrival order
    uint32_t errors_ = 0;            // total duration errors
    uint32_t frameErrors_ = 0;       // errors since the last latch
    bool firstIsHigh_ = false;
    Time firstValue_ = 0;
    size_t firstBit_ = 0;
};

}  // namespace

std::unique_ptr<Part> makeWs2812() { return std::make_unique<Ws2812>(); }

}  // namespace fpgasim
