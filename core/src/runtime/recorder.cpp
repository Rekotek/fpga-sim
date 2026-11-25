#include "recorder.h"

#include <algorithm>
#include <cstring>

#include "fpgasim/clock.h"
#include "fpgasim/engine.h"

namespace fpgasim {

Refusal Recorder::start(Options options, Time now, Reader reader) {
    if (options.items.empty()) return "список записи пуст";
    if (options.depth == 0) return "глубина записи равна нулю";
    if (options.hasTrigger && options.trigger.width > 1 && options.edge != Edge::Change)
        return "для многоразрядного сигнала условие запуска — только change";

    std::vector<Slot> slots;
    uint32_t offset = 0;
    uint32_t stride = 1;
    int trigger = -1;
    const auto add = [&](const Item& item, bool visible) {
        const uint32_t words = wordsFor(item.width);
        slots.push_back({item, offset, words, visible});
        offset += words;
        if (visible) stride = std::max(stride, words);
    };
    for (const Item& item : options.items) add(item, true);
    if (options.hasTrigger) {
        for (size_t i = 0; i < slots.size(); ++i) {
            if (slots[i].item.isNet == options.trigger.isNet && slots[i].item.ref == options.trigger.ref)
                trigger = static_cast<int>(i);
        }
        if (trigger < 0) {
            trigger = static_cast<int>(slots.size());
            add(options.trigger, false);
        }
    }
    const size_t bytes = static_cast<size_t>(options.depth) * (sizeof(Change) + 4 * static_cast<size_t>(stride));
    if (bytes > kMemoryLimit)
        return {"записи нужно больше 64 МБ памяти: уменьшите глубину или число сигналов",
                Json{{"reason", "recordMemory"}, {"megabytes", kMemoryLimit >> 20}}};

    slots_ = std::move(slots);
    stride_ = stride;
    depth_ = options.depth;
    mode_ = options.mode;
    edge_ = options.edge;
    window_ = options.windowPs;
    trigger_ = trigger;
    reader_ = std::move(reader);
    cur_.assign(offset, 0);
    base_.assign(offset, 0);
    tmp_.assign(std::max<uint32_t>(offset, 1), 0);
    ring_.assign(depth_, Change{});
    values_.assign(static_cast<size_t>(depth_) * stride_, 0);
    head_ = 0;
    count_ = 0;
    id_ = nextId_++;
    overflow_ = false;
    for (const Slot& s : slots_) reader_(s.item, &cur_[s.offset]);
    from_ = now;
    to_ = now;
    if (trigger_ < 0) {
        begin(now);
    } else {
        state_ = State::Armed;
    }
    stateChanged_ = true;
    trackedChanged_ = true;
    return {};
}

void Recorder::clear() {
    if (state_ == State::None) return;
    state_ = State::None;
    slots_.clear();
    ring_ = {};
    values_ = {};
    count_ = 0;
    stateChanged_ = false;
    overflow_ = false;
    trackedChanged_ = true;
}

void Recorder::stop(Time now) {
    if (!active()) return;
    if (state_ == State::Armed) {
        // The condition did not fire: the segment is empty, but the signal values at the stop time are known.
        from_ = now;
        base_ = cur_;
        count_ = 0;
    }
    finish(State::Stopped, now);
}

void Recorder::begin(Time t) {
    // The condition may fire from a net earlier than the engine signals that changed
    // at the same moment are reread: the values at the segment start must already include them.
    for (const Slot& s : slots_) {
        if (!s.item.isNet) reader_(s.item, &cur_[s.offset]);
    }
    state_ = State::Recording;
    from_ = t;
    base_ = cur_;
    head_ = 0;
    count_ = 0;
    stateChanged_ = true;
}

void Recorder::finish(State state, Time to) {
    state_ = state;
    to_ = to;
    stateChanged_ = true;
    trackedChanged_ = true;
}

void Recorder::onNet(uint32_t net, bool level, Time t) {
    if (!active()) return;
    const uint32_t word = level ? 1 : 0;
    for (size_t i = 0; i < slots_.size(); ++i) {
        if (slots_[i].item.isNet && slots_[i].item.ref == net) handle(static_cast<uint32_t>(i), &word, t);
    }
}

void Recorder::poll(Time t) {
    for (size_t i = 0; i < slots_.size() && active(); ++i) {
        if (slots_[i].item.isNet) continue;
        reader_(slots_[i].item, tmp_.data());
        handle(static_cast<uint32_t>(i), tmp_.data(), t);
    }
}

void Recorder::chunkEnd(Time now) {
    if (state_ == State::Recording && mode_ == Mode::Window && now >= windowEnd()) finish(State::Done, windowEnd());
}

void Recorder::handle(uint32_t slot, const uint32_t* words, Time t) {
    const Slot& s = slots_[slot];
    uint32_t* cur = &cur_[s.offset];
    if (std::memcmp(cur, words, 4 * s.words) == 0) return;
    const bool wasHigh = (cur[0] & 1) != 0;
    std::memcpy(cur, words, 4 * s.words);
    if (state_ == State::Armed) {
        if (static_cast<int>(slot) != trigger_) return;
        const bool isHigh = (cur[0] & 1) != 0;
        const bool hit = edge_ == Edge::Change || (edge_ == Edge::Rise && !wasHigh && isHigh) ||
                         (edge_ == Edge::Fall && wasHigh && !isHigh);
        if (hit) begin(t);  // the values at the segment start already include the edge itself
        return;
    }
    if (state_ != State::Recording) return;
    if (mode_ == Mode::Window && t >= windowEnd()) {
        finish(State::Done, windowEnd());
        return;
    }
    if (!s.visible) return;
    if (count_ == depth_) {
        if (mode_ == Mode::Window) {
            overflow_ = true;
            finish(State::Done, t);
            return;
        }
        // Ring: the oldest change moves into the values at the segment start.
        const Change& old = ring_[head_];
        const Slot& os = slots_[old.slot];
        std::memcpy(&base_[os.offset], &values_[static_cast<size_t>(head_) * stride_], 4 * os.words);
        from_ = old.t;
        head_ = (head_ + 1) % depth_;
        --count_;
    }
    const uint32_t pos = (head_ + count_) % depth_;
    ring_[pos] = {t, slot};
    std::memcpy(&values_[static_cast<size_t>(pos) * stride_], words, 4 * s.words);
    ++count_;
}

std::vector<uint32_t> Recorder::trackedSignals() const {
    std::vector<uint32_t> sigs;
    if (!active()) return sigs;
    for (const Slot& s : slots_) {
        if (!s.item.isNet && std::find(sigs.begin(), sigs.end(), s.item.ref) == sigs.end()) sigs.push_back(s.item.ref);
    }
    return sigs;
}

Json Recorder::stateJson(Time now) const {
    const char* name = "stopped";
    Time from = from_;
    Time to = to_;
    switch (state_) {
        case State::Armed:
            name = "armed";
            from = now;
            to = now;
            break;
        case State::Recording:
            name = "recording";
            to = now;
            break;
        case State::Done:
            name = "done";
            break;
        default:
            break;
    }
    return Json{{"t", "recordState"},
                {"record", id_},
                {"state", name},
                {"changes", state_ == State::Armed ? 0u : count_},
                {"fromPs", timeToString(from)},
                {"toPs", timeToString(std::max(from, to))}};
}

Json Recorder::infoJson() const {
    Json info = Json::array();
    uint32_t index = 0;
    for (const Slot& s : slots_) {
        if (!s.visible) continue;
        info.push_back(Json{{"index", index++}, {"name", s.item.name}, {"width", s.item.width}});
    }
    return info;
}

void Recorder::fetch(const Time* fromPs, const Time* toPs, Time now,
                     const std::function<void(const Trace&)>& emit) const {
    const bool recorded = state_ != State::None && state_ != State::Armed;
    const std::vector<uint32_t>& start = state_ == State::Armed ? cur_ : base_;
    const Time segFrom = from_;
    const Time segTo = std::max(from_, state_ == State::Recording ? now : to_);
    Time from = fromPs ? std::max(*fromPs, segFrom) : segFrom;
    Time to = toPs ? std::min(*toPs, segTo) : segTo;
    if (to < from) to = from;

    // Indexes of the visible signals in the info list.
    std::vector<int> index(slots_.size(), -1);
    int visible = 0;
    for (size_t i = 0; i < slots_.size(); ++i) {
        if (slots_[i].visible) index[i] = visible++;
    }

    std::vector<uint32_t> vals = start;
    Trace trace;
    trace.record = id_;
    const auto open = [&](Time at) {
        trace.fromPs = at;
        trace.count = 0;
        trace.body.clear();
        for (size_t i = 0; i < slots_.size(); ++i) {
            if (index[i] < 0) continue;
            trace.add(at, static_cast<uint16_t>(index[i]), {&vals[slots_[i].offset], slots_[i].words});
        }
    };

    bool opened = false;
    uint32_t fresh = 0;  // changes in the message beyond the initial values
    for (uint32_t n = 0; recorded && n < count_; ++n) {
        const uint32_t pos = (head_ + n) % depth_;
        const Change& c = ring_[pos];
        if (c.t > to) break;
        const Slot& s = slots_[c.slot];
        const uint32_t* words = &values_[static_cast<size_t>(pos) * stride_];
        if (c.t >= from) {
            if (!opened) {
                open(from);
                opened = true;
                fresh = 0;
            }
            if (fresh > 0 && trace.encodedSize() + 12 + 4 * s.words > kTraceMaxBytes) {
                trace.toPs = c.t;
                emit(trace);
                open(c.t);
                fresh = 0;
            }
            trace.add(c.t, static_cast<uint16_t>(index[c.slot]), {words, s.words});
            ++fresh;
        }
        std::memcpy(&vals[s.offset], words, 4 * s.words);
    }
    if (!opened) open(from);
    trace.toPs = to;
    emit(trace);
}

}  // namespace fpgasim
