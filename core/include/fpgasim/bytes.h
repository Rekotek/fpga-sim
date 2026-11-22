// Writing and reading binary messages: little-endian byte order (low byte first), 4-byte alignment (spec section 4.1).
#pragma once

#include <cstdint>
#include <cstring>
#include <span>
#include <vector>

namespace fpgasim {

class ByteWriter {
public:
    explicit ByteWriter(std::vector<uint8_t>& buf) : buf_(buf) {}

    void u8(uint8_t v) { buf_.push_back(v); }
    void u16(uint16_t v) { put(v, 2); }
    void u32(uint32_t v) { put(v, 4); }
    void u64(uint64_t v) { put(v, 8); }
    void f32(float v) {
        uint32_t bits;
        std::memcpy(&bits, &v, 4);
        u32(bits);
    }
    void bytes(std::span<const uint8_t> data) { buf_.insert(buf_.end(), data.begin(), data.end()); }
    void pad4() {
        while (buf_.size() % 4 != 0) buf_.push_back(0);
    }
    size_t size() const { return buf_.size(); }

private:
    void put(uint64_t v, int n) {
        for (int i = 0; i < n; ++i) buf_.push_back(static_cast<uint8_t>(v >> (8 * i)));
    }
    std::vector<uint8_t>& buf_;
};

// Reading without exceptions: reading past the end sets an error flag, and values after it are zero.
class ByteReader {
public:
    explicit ByteReader(std::span<const uint8_t> data) : data_(data) {}

    uint8_t u8() { return static_cast<uint8_t>(get(1)); }
    uint16_t u16() { return static_cast<uint16_t>(get(2)); }
    uint32_t u32() { return static_cast<uint32_t>(get(4)); }
    uint64_t u64() { return get(8); }
    float f32() {
        const uint32_t bits = u32();
        float v;
        std::memcpy(&v, &bits, 4);
        return v;
    }
    std::span<const uint8_t> bytes(size_t n) {
        if (n > data_.size() - pos_) {
            failed_ = true;
            pos_ = data_.size();
            return {};
        }
        const auto out = data_.subspan(pos_, n);
        pos_ += n;
        return out;
    }
    void pad4() {
        while (pos_ % 4 != 0 && pos_ < data_.size()) ++pos_;
    }
    size_t remaining() const { return data_.size() - pos_; }
    bool failed() const { return failed_; }

private:
    uint64_t get(size_t n) {
        if (n > data_.size() - pos_) {
            failed_ = true;
            pos_ = data_.size();
            return 0;
        }
        uint64_t v = 0;
        for (size_t i = 0; i < n; ++i) v |= static_cast<uint64_t>(data_[pos_ + i]) << (8 * i);
        pos_ += n;
        return v;
    }
    std::span<const uint8_t> data_;
    size_t pos_ = 0;
    bool failed_ = false;
};

}  // namespace fpgasim
