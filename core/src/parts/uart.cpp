// UART (spec section 6.3): 8N1 frame. Reception runs on wakeups in the middle of each bit; transmission
// runs on wakeups at bit boundaries. Received bytes collect in a buffer and go out in PART_DATA
// (channel 0) at the end of a chunk or when the buffer fills.
#include <algorithm>
#include <array>
#include <vector>

#include "parts.h"

namespace fpgasim {

namespace {

constexpr int kRoleFromFpga = 0;
constexpr int kRoleToFpga = 1;
constexpr uint32_t kTagRx = 1;
constexpr uint32_t kTagTx = 2;
constexpr uint16_t kChannelBytes = 0;
constexpr Time kPsPerSecond = 1'000'000'000'000ull;
constexpr size_t kEdgeWindow = 64;                    // edges in the baud estimation window
constexpr size_t kEdgeCheckEvery = 16;                // the estimate is recomputed once per this many edges
constexpr Time kMismatchPeriodPs = kPsPerSecond;      // baudMismatch event at most once per second
constexpr Time kFramingPeriodPs = kPsPerSecond / 10;  // framingError event at most once per 100 ms
constexpr size_t kMaxQueue = 65536;                   // transmit queue limit, in bytes

class Uart final : public Part {
public:
    void attach(PartHost& host, const Json& settings) override {
        host_ = &host;
        readSettings(settings);
    }

    void reset() override {
        host_->cancelWake(kTagRx);
        host_->cancelWake(kTagTx);
        receiving_ = false;
        rxCount_ = 0;
        received_ = 0;
        sent_ = 0;
        queue_.clear();
        head_ = 0;
        sending_ = false;
        framingErrors_ = 0;
        framingEmitted_ = false;
        forgetEdges();
        host_->drive(kRoleToFpga, true);  // an idle line holds 1
        host_->markDirty();
    }

    void onEdge(int role, bool level, Time t) override {
        if (role != kRoleFromFpga) return;
        noteEdge(t);
        if (!level && !receiving_) {
            // Falling edge on an idle line: start of the start bit. The first data bit is read
            // after one and a half bits, then at one-bit steps.
            receiving_ = true;
            rxStart_ = t;
            rxBit_ = 0;
            rxShift_ = 0;
            host_->wakeAt(rxStart_ + sampleOffset(0), kTagRx);
        }
    }

    void onWake(uint32_t tag, Time t) override {
        if (tag == kTagRx) {
            sample();
        } else if (tag == kTagTx) {
            txStep(t);
        }
    }

    void onCommand(std::string_view cmd, const Json& args) override {
        if (cmd != "send") return;
        const auto bytes = args.find("bytes");
        if (bytes == args.end() || !bytes->is_array()) return;
        for (const Json& b : *bytes) enqueue(static_cast<uint8_t>(b.get<int>()));
        startTx();
    }

    void onData(uint16_t channel, std::span<const uint8_t> bytes) override {
        if (channel != kChannelBytes) return;
        for (const uint8_t b : bytes) enqueue(b);
        startTx();
    }

    void onSettings(const Json& settings) override {
        const uint64_t before = baud_;
        readSettings(settings);
        if (baud_ == before) return;
        forgetEdges();
        // Baud change on the fly: the frame being received is dropped, and the byte being sent restarts
        // after one idle bit. Otherwise the bit times of the old rate would fall in the past.
        host_->cancelWake(kTagRx);
        receiving_ = false;
        if (sending_) {
            host_->cancelWake(kTagTx);
            host_->drive(kRoleToFpga, true);
            txBit_ = 0;
            txStart_ = host_->now() + bitEdge(1);
            host_->wakeAt(txStart_, kTagTx);
        }
    }

    void onChunkEnd() override { flushRx(); }

    void writeState(ByteWriter& out) const override {
        out.u32(received_);
        out.u32(sent_);
        out.u32(static_cast<uint32_t>(queue_.size() - head_));
    }

private:
    void readSettings(const Json& settings) {
        const int64_t baud = settings.value("baud", int64_t{115200});
        baud_ = static_cast<uint64_t>(baud > 0 ? baud : 115200);
    }

    // Time of the k-th bit boundary from the start of the frame; divided from the start each time, so the error
    // does not accumulate.
    Time bitEdge(uint32_t k) const { return k * kPsPerSecond / baud_; }
    // Middle of the k-th data bit (k = 8 is the stop bit).
    Time sampleOffset(uint32_t k) const { return (2ull * k + 3) * kPsPerSecond / (2 * baud_); }

    // --- reception ---
    void sample() {
        const bool level = host_->level(kRoleFromFpga);
        if (rxBit_ < 8) {
            if (level) rxShift_ |= static_cast<uint8_t>(1u << rxBit_);
            ++rxBit_;
            host_->wakeAt(rxStart_ + sampleOffset(rxBit_), kTagRx);
            return;
        }
        receiving_ = false;
        if (!level) {
            framingError();
            return;
        }
        rxBuf_[rxCount_++] = rxShift_;
        ++received_;
        host_->markDirty();
        if (rxCount_ == rxBuf_.size()) flushRx();
    }

    void flushRx() {
        if (rxCount_ == 0) return;
        host_->emitData(kChannelBytes, std::span<const uint8_t>(rxBuf_.data(), rxCount_));
        rxCount_ = 0;
    }

    void framingError() {
        ++framingErrors_;
        const Time now = host_->now();
        if (framingEmitted_ && now - framingAt_ < kFramingPeriodPs) return;
        framingEmitted_ = true;
        framingAt_ = now;
        host_->emitEvent("framingError", Json{{"count", framingErrors_}});
    }

    // --- baud estimation from the shortest pulse ---
    void forgetEdges() {
        edges_ = 0;
        haveEdge_ = false;
        mismatchEmitted_ = false;
    }

    void noteEdge(Time t) {
        if (haveEdge_) {
            widths_[edges_ % kEdgeWindow] = t - lastEdge_;
            ++edges_;
            if (edges_ >= kEdgeWindow && edges_ % kEdgeCheckEvery == 0) checkBaud(t);
        }
        haveEdge_ = true;
        lastEdge_ = t;
    }

    // A pulse shorter than a bit by more than 10% means the line rate is above the setting. A longer pulse
    // counts as a mismatch only if it is not a multiple of a bit: a byte with no single bits (0x30 at
    // the right rate) gives a shortest pulse of two bits and is not an error.
    void checkBaud(Time t) {
        Time shortest = widths_[0];
        for (const Time w : widths_) shortest = std::min(shortest, w);
        if (shortest == 0) return;
        const Time bit = kPsPerSecond / baud_;
        const Time tolerance = bit / 10;
        bool mismatch = shortest + tolerance < bit;
        if (!mismatch && shortest > bit + tolerance) {
            const Time bits = (shortest + bit / 2) / bit;  // nearest whole number of bits
            const Time whole = bits * bit;
            const Time diff = shortest > whole ? shortest - whole : whole - shortest;
            mismatch = bits > 9 || diff > tolerance;
        }
        if (!mismatch) return;
        if (mismatchEmitted_ && t - mismatchAt_ < kMismatchPeriodPs) return;
        mismatchEmitted_ = true;
        mismatchAt_ = t;
        const uint64_t estimate = (kPsPerSecond + shortest / 2) / shortest;
        host_->emitEvent("baudMismatch", Json{{"baud", estimate}, {"setting", baud_}});
    }

    // --- transmission ---
    void enqueue(uint8_t byte) {
        if (queue_.size() - head_ >= kMaxQueue) return;
        queue_.push_back(byte);
        host_->markDirty();
    }

    void startTx() {
        if (sending_ || head_ >= queue_.size()) return;
        sending_ = true;
        txStart_ = host_->now();
        txBit_ = 0;
        txStep(txStart_);
    }

    // Boundary of bit txBit_: 0 is the start bit, 1-8 are data, 9 is the stop bit, 10 is the end of the frame.
    void txStep(Time t) {
        if (!sending_) return;
        if (txBit_ == 0) {
            txStart_ = t;
            host_->drive(kRoleToFpga, false);
        } else if (txBit_ <= 8) {
            host_->drive(kRoleToFpga, (queue_[head_] >> (txBit_ - 1)) & 1u);
        } else if (txBit_ == 9) {
            host_->drive(kRoleToFpga, true);
        } else {
            ++sent_;
            ++head_;
            host_->markDirty();
            if (head_ >= queue_.size()) {
                queue_.clear();
                head_ = 0;
                sending_ = false;
                return;
            }
            txStart_ = t;
            txBit_ = 0;
            host_->drive(kRoleToFpga, false);
        }
        ++txBit_;
        host_->wakeAt(txStart_ + bitEdge(txBit_), kTagTx);
    }

    PartHost* host_ = nullptr;
    uint64_t baud_ = 115200;

    bool receiving_ = false;
    Time rxStart_ = 0;
    uint32_t rxBit_ = 0;
    uint8_t rxShift_ = 0;
    std::array<uint8_t, 1024> rxBuf_{};
    size_t rxCount_ = 0;
    uint32_t received_ = 0;
    uint32_t framingErrors_ = 0;
    bool framingEmitted_ = false;
    Time framingAt_ = 0;

    std::array<Time, kEdgeWindow> widths_{};
    size_t edges_ = 0;
    bool haveEdge_ = false;
    Time lastEdge_ = 0;
    bool mismatchEmitted_ = false;
    Time mismatchAt_ = 0;

    std::vector<uint8_t> queue_;  // transmit queue; head_ is the byte being sent
    size_t head_ = 0;
    bool sending_ = false;
    Time txStart_ = 0;
    uint32_t txBit_ = 0;
    uint32_t sent_ = 0;
};

}  // namespace

std::unique_ptr<Part> makeUart() { return std::make_unique<Uart>(); }

}  // namespace fpgasim
