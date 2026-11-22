// Core <-> interface protocol (spec section 4): constants and binary message encoding.
// Reference examples are in spec/protocol/vectors/.
#pragma once

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

#include "fpgasim/part.h"

namespace fpgasim {

inline constexpr int kProtocolVersion = 1;
inline constexpr uint16_t kBinaryMagic = 0x5346;
inline constexpr size_t kBinaryHeaderSize = 24;
inline constexpr size_t kTraceMaxBytes = 1u << 20;  // limit of one TRACE message including the header

enum class BinaryKind : uint8_t { Frame = 1, Trace = 2, PartData = 3 };

// Net flags in a frame.
inline constexpr uint8_t kNetFpga = 1;  // the FPGA drives the net
inline constexpr uint8_t kNetPart = 2;  // a part drives the net
inline constexpr uint8_t kNetConflict = 4;
inline constexpr uint8_t kNetFloating = 8;

struct BinaryHeader {
    BinaryKind kind;
    uint32_t seq;     // sequence number of a message of this kind
    Time time;        // simulation time when sent
    uint32_t length;  // content length
};

struct FrameNet {
    uint8_t level;
    uint8_t flags;
    uint32_t toggles;
    float duty;  // fraction of time at one per chunk
};

struct FrameWatch {
    uint32_t sig;
    uint32_t width;
    std::vector<uint32_t> words;  // least significant word first
};

struct FramePart {
    uint16_t index;
    std::vector<uint8_t> state;
};

struct Frame {
    Time spanPs = 0;      // simulation time covered in the chunk
    uint64_t cycle = 0;   // cycle index since the start
    uint32_t realUs = 0;  // real time of the chunk
    float ratio = 0;      // ratio of simulation speed to real time over 500 ms
    std::vector<FrameNet> nets;
    std::vector<FrameWatch> watch;
    std::vector<FramePart> parts;
};

// Part of a recording. Changes are appended already encoded, so a 1 MB message
// does not need a vector per change.
struct Trace {
    uint32_t record = 0;
    Time fromPs = 0;
    Time toPs = 0;
    uint32_t count = 0;
    std::vector<uint8_t> body;

    void add(Time t, uint16_t index, std::span<const uint32_t> words);
    size_t encodedSize() const { return kBinaryHeaderSize + 24 + body.size(); }
};

// Each function replaces the content of out with a complete message with a header.
void encodeFrame(std::vector<uint8_t>& out, uint32_t seq, Time time, const Frame& frame);
void encodeTrace(std::vector<uint8_t>& out, uint32_t seq, Time time, const Trace& trace);
void encodePartData(std::vector<uint8_t>& out, uint32_t seq, Time time, uint16_t part, uint16_t channel,
                    std::span<const uint8_t> bytes);

struct PartData {
    uint16_t part;
    uint16_t channel;
    std::span<const uint8_t> bytes;
};

// Parsing of the header and PART_DATA. An empty result: the message does not match the format.
std::optional<BinaryHeader> decodeHeader(std::span<const uint8_t> message);
std::optional<PartData> decodePartData(std::span<const uint8_t> payload);

// Parsing of FRAME content (without the header). The core does not need it: tests
// and the example launcher use it. false: the content does not match the format.
bool decodeFrame(std::span<const uint8_t> payload, Frame& frame);

// Time in JSON is a string of decimal digits without leading zeros.
std::string timeToString(Time t);
std::optional<Time> parseTime(std::string_view text);

}  // namespace fpgasim
