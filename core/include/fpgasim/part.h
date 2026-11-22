// Part interface (spec section 5.6).
#pragma once

#include <cstdint>
#include <memory>
#include <span>
#include <string_view>

#include "fpgasim/bytes.h"
#include "fpgasim/json.h"

namespace fpgasim {

using Time = uint64_t;  // picoseconds

struct NetStats {  // totals of the current chunk
    bool level;
    uint32_t toggles;
    Time highTime;
    Time span;  // duration of the chunk
};

class PartHost {  // services the runtime offers to a part
public:
    virtual Time now() const = 0;
    virtual bool level(int role) const = 0;         // current net level
    virtual void drive(int role, bool level) = 0;   // the part sets the level
    virtual void release(int role) = 0;             // the part releases the net
    virtual void wakeAt(Time t, uint32_t tag) = 0;  // call onWake at time t
    virtual void cancelWake(uint32_t tag) = 0;
    virtual const NetStats& stats(int role) const = 0;
    virtual void emitEvent(std::string_view event, const Json& data) = 0;         // partEvent
    virtual void emitData(uint16_t channel, std::span<const uint8_t> bytes) = 0;  // PART_DATA
    virtual void markDirty() = 0;                                                 // state for the frame changed
    virtual uint64_t random() = 0;                                                // repeatable generator

protected:
    ~PartHost() = default;
};

class Part {
public:
    virtual ~Part() = default;
    virtual void attach(PartHost& host, const Json& settings) = 0;
    virtual void reset() = 0;                             // return to the start
    virtual void onEdge(int role, bool level, Time t) {}  // net change
    virtual void onWake(uint32_t tag, Time t) {}
    virtual void onCommand(std::string_view cmd, const Json& args) {}
    virtual void onData(uint16_t channel, std::span<const uint8_t> bytes) {}
    virtual void onSettings(const Json& settings) {}
    virtual void onChunkEnd() {}                       // before a frame is sent
    virtual void writeState(ByteWriter& out) const {}  // part block in FRAME
};

using PartFactory = std::unique_ptr<Part> (*)();
void registerPart(std::string_view type, PartFactory factory);
void registerBuiltinParts();  // explicit list of all parts in the library

}  // namespace fpgasim
