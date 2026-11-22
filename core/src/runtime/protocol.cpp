// Encoding of binary messages (spec section 4.6).
#include "fpgasim/protocol.h"

#include <charconv>

namespace fpgasim {

namespace {

void writeHeader(ByteWriter& w, BinaryKind kind, uint32_t seq, Time time) {
    w.u16(kBinaryMagic);
    w.u8(static_cast<uint8_t>(kProtocolVersion));
    w.u8(static_cast<uint8_t>(kind));
    w.u32(seq);
    w.u64(time);
    w.u32(0);  // length; filled in finish()
    w.u32(0);  // reserved
}

void finish(std::vector<uint8_t>& out) {
    const uint32_t length = static_cast<uint32_t>(out.size() - kBinaryHeaderSize);
    for (int i = 0; i < 4; ++i) out[16 + i] = static_cast<uint8_t>(length >> (8 * i));
}

}  // namespace

void Trace::add(Time t, uint16_t index, std::span<const uint32_t> words) {
    ByteWriter w(body);
    w.u64(t);
    w.u16(index);
    w.u16(static_cast<uint16_t>(words.size()));
    for (const uint32_t word : words) w.u32(word);
    ++count;
}

void encodeFrame(std::vector<uint8_t>& out, uint32_t seq, Time time, const Frame& frame) {
    out.clear();
    ByteWriter w(out);
    writeHeader(w, BinaryKind::Frame, seq, time);
    w.u64(frame.spanPs);
    w.u64(frame.cycle);
    w.u32(frame.realUs);
    w.f32(frame.ratio);
    w.u16(static_cast<uint16_t>(frame.nets.size()));
    w.u16(static_cast<uint16_t>(frame.watch.size()));
    w.u16(static_cast<uint16_t>(frame.parts.size()));
    w.u16(0);
    for (const FrameNet& net : frame.nets) {
        w.u8(net.level);
        w.u8(net.flags);
        w.u16(0);
        w.u32(net.toggles);
        w.f32(net.duty);
    }
    for (const FrameWatch& item : frame.watch) {
        w.u32(item.sig);
        w.u16(static_cast<uint16_t>(item.width));
        w.u16(static_cast<uint16_t>(item.words.size()));
        for (const uint32_t word : item.words) w.u32(word);
    }
    for (const FramePart& part : frame.parts) {
        w.u16(part.index);
        w.u16(static_cast<uint16_t>(part.state.size()));
        w.bytes(part.state);
        w.pad4();
    }
    finish(out);
}

void encodeTrace(std::vector<uint8_t>& out, uint32_t seq, Time time, const Trace& trace) {
    out.clear();
    ByteWriter w(out);
    writeHeader(w, BinaryKind::Trace, seq, time);
    w.u32(trace.record);
    w.u32(trace.count);
    w.u64(trace.fromPs);
    w.u64(trace.toPs);
    w.bytes(trace.body);
    finish(out);
}

void encodePartData(std::vector<uint8_t>& out, uint32_t seq, Time time, uint16_t part, uint16_t channel,
                    std::span<const uint8_t> bytes) {
    out.clear();
    ByteWriter w(out);
    writeHeader(w, BinaryKind::PartData, seq, time);
    w.u16(part);
    w.u16(channel);
    w.u32(static_cast<uint32_t>(bytes.size()));
    w.bytes(bytes);
    w.pad4();
    finish(out);
}

std::optional<BinaryHeader> decodeHeader(std::span<const uint8_t> message) {
    if (message.size() < kBinaryHeaderSize) return std::nullopt;
    ByteReader r(message);
    if (r.u16() != kBinaryMagic) return std::nullopt;
    if (r.u8() != kProtocolVersion) return std::nullopt;
    const uint8_t kind = r.u8();
    if (kind < 1 || kind > 3) return std::nullopt;
    BinaryHeader h;
    h.kind = static_cast<BinaryKind>(kind);
    h.seq = r.u32();
    h.time = r.u64();
    h.length = r.u32();
    if (h.length != message.size() - kBinaryHeaderSize) return std::nullopt;
    return h;
}

std::optional<PartData> decodePartData(std::span<const uint8_t> payload) {
    ByteReader r(payload);
    PartData data;
    data.part = r.u16();
    data.channel = r.u16();
    const uint32_t length = r.u32();
    data.bytes = r.bytes(length);
    if (r.failed()) return std::nullopt;
    return data;
}

bool decodeFrame(std::span<const uint8_t> payload, Frame& frame) {
    ByteReader r(payload);
    frame.spanPs = r.u64();
    frame.cycle = r.u64();
    frame.realUs = r.u32();
    frame.ratio = r.f32();
    const uint16_t nets = r.u16();
    const uint16_t watch = r.u16();
    const uint16_t parts = r.u16();
    r.u16();
    frame.nets.clear();
    frame.watch.clear();
    frame.parts.clear();
    for (uint16_t i = 0; i < nets && !r.failed(); ++i) {
        FrameNet net{};
        net.level = r.u8();
        net.flags = r.u8();
        r.u16();
        net.toggles = r.u32();
        net.duty = r.f32();
        frame.nets.push_back(net);
    }
    for (uint16_t i = 0; i < watch && !r.failed(); ++i) {
        FrameWatch item;
        item.sig = r.u32();
        item.width = r.u16();
        const uint16_t words = r.u16();
        for (uint16_t k = 0; k < words && !r.failed(); ++k) item.words.push_back(r.u32());
        frame.watch.push_back(std::move(item));
    }
    for (uint16_t i = 0; i < parts && !r.failed(); ++i) {
        FramePart part;
        part.index = r.u16();
        const uint16_t length = r.u16();
        const auto state = r.bytes(length);
        part.state.assign(state.begin(), state.end());
        r.pad4();
        frame.parts.push_back(std::move(part));
    }
    return !r.failed() && r.remaining() == 0;
}

std::string timeToString(Time t) { return std::to_string(t); }

std::optional<Time> parseTime(std::string_view text) {
    if (text.empty() || (text.size() > 1 && text[0] == '0')) return std::nullopt;
    Time value = 0;
    const auto res = std::from_chars(text.data(), text.data() + text.size(), value);
    if (res.ec != std::errc() || res.ptr != text.data() + text.size()) return std::nullopt;
    return value;
}

}  // namespace fpgasim
