// Recording of changes of chosen signals and nets (spec section 5.5).
#pragma once

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

#include "fpgasim/clock.h"
#include "fpgasim/json.h"
#include "fpgasim/protocol.h"
#include "refusal.h"

namespace fpgasim {

class Recorder {
public:
    enum class State { None, Armed, Recording, Done, Stopped };
    enum class Mode { Ring, Window };
    enum class Edge { Rise, Fall, Change };

    struct Item {
        bool isNet;  // a net (index in configure) or an engine signal (sig)
        uint32_t ref;
        std::string name;  // signal path or pin:N
        uint32_t width;
    };

    struct Options {
        std::vector<Item> items;
        Mode mode = Mode::Ring;
        uint32_t depth = 200000;
        Time windowPs = 100'000'000'000ull;
        bool hasTrigger = false;
        Item trigger{};
        Edge edge = Edge::Change;
    };

    // Reads the current value of an engine signal or a net into 32-bit words.
    using Reader = std::function<void(const Item&, uint32_t* words)>;

    static constexpr size_t kMemoryLimit = 64u << 20;  // recording memory limit

    // Starts a new recording in place of the previous one. Returns the error text or an empty string.
    Refusal start(Options options, Time now, Reader reader);
    void clear();         // the recording is erased (reset, configure)
    void stop(Time now);  // stop on command

    void onNet(uint32_t net, bool level, Time t);  // a net level changed
    void poll(Time t);                             // reread the engine signals after it stopped
    void chunkEnd(Time now);                       // end of a chunk: the window may have ended

    bool exists() const { return state_ != State::None; }
    bool active() const { return state_ == State::Armed || state_ == State::Recording; }
    uint32_t id() const { return id_; }

    // What happened since the last poll.
    bool takeStateChanged() { return take(stateChanged_); }
    bool takeOverflow() { return take(overflow_); }
    bool takeTrackedChanged() { return take(trackedChanged_); }
    bool pending() const { return stateChanged_ || overflow_ || trackedChanged_; }

    std::vector<uint32_t> trackedSignals() const;  // engine signals that need tracking
    Json stateJson(Time now) const;                // recordState message
    Json infoJson() const;                         // info field of the recordFetch reply

    // Delivers a segment of the recording as TRACE messages of at most 1 MB. Each starts
    // with the values of all signals at its own start.
    // now is the current simulation time: it ends a recording that is still running.
    void fetch(const Time* fromPs, const Time* toPs, Time now, const std::function<void(const Trace&)>& emit) const;

private:
    struct Slot {
        Item item;
        uint32_t offset;  // where the value sits in cur_ and base_
        uint32_t words;
        bool visible;  // false: a trigger condition that is not in the recording list
    };
    struct Change {
        Time t;
        uint32_t slot;
    };

    static bool take(bool& flag) {
        const bool was = flag;
        flag = false;
        return was;
    }
    void handle(uint32_t slot, const uint32_t* words, Time t);
    void begin(Time t);
    void finish(State state, Time to);
    Time windowEnd() const { return from_ > kNever - window_ ? kNever : from_ + window_; }

    State state_ = State::None;
    uint32_t id_ = 0;
    uint32_t nextId_ = 0;
    Mode mode_ = Mode::Ring;
    Edge edge_ = Edge::Change;
    int trigger_ = -1;  // index of the trigger condition cell
    Time window_ = 0;
    Time from_ = 0;
    Time to_ = 0;
    Reader reader_;

    std::vector<Slot> slots_;
    std::vector<uint32_t> cur_;   // current values
    std::vector<uint32_t> base_;  // values at the start of the stored segment
    std::vector<uint32_t> tmp_;
    uint32_t stride_ = 1;  // words per change in the ring
    uint32_t depth_ = 0;
    uint32_t head_ = 0;
    uint32_t count_ = 0;
    std::vector<Change> ring_;
    std::vector<uint32_t> values_;

    bool stateChanged_ = false;
    bool overflow_ = false;
    bool trackedChanged_ = false;
};

}  // namespace fpgasim
