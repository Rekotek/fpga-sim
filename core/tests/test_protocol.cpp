// Binary messages: byte-for-byte match with the reference files in spec/protocol/vectors/ (spec section 4.6).
#include <catch2/catch_test_macros.hpp>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "fpgasim/json.h"
#include "fpgasim/protocol.h"

using namespace fpgasim;

namespace {

const std::string kVectorDir = std::string(FPGASIM_REPO_DIR) + "/spec/protocol/vectors/";

std::vector<uint8_t> readFile(const std::string& path) {
    std::ifstream file(path, std::ios::binary);
    REQUIRE(file.good());
    return {std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
}

Time timeOf(const Json& value) { return parseTime(value.get<std::string>()).value(); }

// Encodes a message from its vectors.json description using the core.
std::vector<uint8_t> encode(const Json& v) {
    std::vector<uint8_t> out;
    const std::string kind = v["kind"];
    const uint32_t seq = v["seq"];
    const Time time = timeOf(v["timePs"]);
    if (kind == "FRAME") {
        const Json& f = v["frame"];
        Frame frame;
        frame.spanPs = timeOf(f["spanPs"]);
        frame.cycle = f["cycle"];
        frame.realUs = f["realUs"];
        frame.ratio = f["ratio"];
        for (const Json& n : f["nets"]) frame.nets.push_back({n["level"], n["flags"], n["toggles"], n["duty"]});
        for (const Json& w : f["watch"]) frame.watch.push_back({w["sig"], w["width"], w["words"]});
        for (const Json& p : f["parts"]) frame.parts.push_back({p["index"], p["state"]});
        encodeFrame(out, seq, time, frame);
    } else if (kind == "TRACE") {
        const Json& t = v["trace"];
        Trace trace;
        trace.record = t["record"];
        trace.fromPs = timeOf(t["fromPs"]);
        trace.toPs = timeOf(t["toPs"]);
        for (const Json& c : t["changes"]) {
            const std::vector<uint32_t> words = c["words"];
            trace.add(timeOf(c["timePs"]), c["index"], words);
        }
        encodeTrace(out, seq, time, trace);
    } else {
        const Json& d = v["partData"];
        const std::vector<uint8_t> bytes = d["bytes"];
        encodePartData(out, seq, time, d["part"], d["channel"], bytes);
    }
    return out;
}

Json loadVectors() {
    std::ifstream file(kVectorDir + "vectors.json");
    REQUIRE(file.good());
    return Json::parse(file)["vectors"];
}

}  // namespace

TEST_CASE("кодирование FRAME, TRACE и PART_DATA совпадает с эталонными файлами", "[protocol]") {
    int frames = 0, traces = 0, partData = 0;
    for (const Json& v : loadVectors()) {
        const std::string file = v["file"];
        INFO(file);
        const std::vector<uint8_t> expected = readFile(kVectorDir + file);
        const std::vector<uint8_t> actual = encode(v);
        CHECK(actual == expected);
        CHECK(actual.size() % 4 == 0);  // all structures are aligned to 4 bytes
        const std::string kind = v["kind"];
        frames += kind == "FRAME";
        traces += kind == "TRACE";
        partData += kind == "PART_DATA";
    }
    CHECK(frames >= 1);
    CHECK(traces >= 1);
    CHECK(partData >= 1);
}

TEST_CASE("эталонные файлы разбираются обратно", "[protocol]") {
    for (const Json& v : loadVectors()) {
        const std::string file = v["file"];
        INFO(file);
        const std::vector<uint8_t> bytes = readFile(kVectorDir + file);
        const auto header = decodeHeader(bytes);
        REQUIRE(header.has_value());
        CHECK(header->seq == v["seq"].get<uint32_t>());
        CHECK(header->time == timeOf(v["timePs"]));
        CHECK(header->length == bytes.size() - kBinaryHeaderSize);
        const std::span<const uint8_t> payload = std::span(bytes).subspan(kBinaryHeaderSize);
        if (header->kind == BinaryKind::Frame) {
            Frame frame;
            REQUIRE(decodeFrame(payload, frame));
            const Json& f = v["frame"];
            CHECK(frame.spanPs == timeOf(f["spanPs"]));
            CHECK(frame.cycle == f["cycle"].get<uint64_t>());
            CHECK(frame.ratio == f["ratio"].get<float>());
            REQUIRE(frame.nets.size() == f["nets"].size());
            REQUIRE(frame.watch.size() == f["watch"].size());
            REQUIRE(frame.parts.size() == f["parts"].size());
            for (size_t i = 0; i < frame.nets.size(); ++i) {
                CHECK(frame.nets[i].toggles == f["nets"][i]["toggles"].get<uint32_t>());
                CHECK(frame.nets[i].duty == f["nets"][i]["duty"].get<float>());
            }
            for (size_t i = 0; i < frame.watch.size(); ++i)
                CHECK(frame.watch[i].words == f["watch"][i]["words"].get<std::vector<uint32_t>>());
            for (size_t i = 0; i < frame.parts.size(); ++i)
                CHECK(frame.parts[i].state == f["parts"][i]["state"].get<std::vector<uint8_t>>());
            // Re-encoding the parsed frame gives the same bytes.
            std::vector<uint8_t> again;
            encodeFrame(again, header->seq, header->time, frame);
            CHECK(again == bytes);
        } else if (header->kind == BinaryKind::PartData) {
            const auto data = decodePartData(payload);
            REQUIRE(data.has_value());
            CHECK(data->part == v["partData"]["part"].get<uint16_t>());
            CHECK(data->channel == v["partData"]["channel"].get<uint16_t>());
            CHECK(std::vector<uint8_t>(data->bytes.begin(), data->bytes.end()) ==
                  v["partData"]["bytes"].get<std::vector<uint8_t>>());
        }
    }
}

TEST_CASE("заголовок с ошибкой отклоняется", "[protocol]") {
    std::vector<uint8_t> msg;
    const uint8_t payload[] = {1, 2, 3};
    encodePartData(msg, 1, 2, 3, 4, payload);
    REQUIRE(decodeHeader(msg).has_value());
    CHECK(msg.size() == kBinaryHeaderSize + 12);

    CHECK_FALSE(decodeHeader(std::span(msg).first(10)).has_value());  // shorter than the header
    auto bad = msg;
    bad[0] = 0;  // marker
    CHECK_FALSE(decodeHeader(bad).has_value());
    bad = msg;
    bad[2] = 2;  // protocol version
    CHECK_FALSE(decodeHeader(bad).has_value());
    bad = msg;
    bad[3] = 9;  // kind
    CHECK_FALSE(decodeHeader(bad).has_value());
    bad = msg;
    bad.push_back(0);  // length does not match the declared one
    CHECK_FALSE(decodeHeader(bad).has_value());
    bad = msg;
    bad[kBinaryHeaderSize + 4] = 200;  // more bytes declared than present
    CHECK_FALSE(decodePartData(std::span(bad).subspan(kBinaryHeaderSize)).has_value());
}

TEST_CASE("время в JSON — строка цифр без ведущих нулей", "[protocol]") {
    CHECK(timeToString(0) == "0");
    CHECK(timeToString(18446744073709551615ull) == "18446744073709551615");
    CHECK(parseTime("0") == Time{0});
    CHECK(parseTime("2100000000000") == Time{2'100'000'000'000ull});
    CHECK(parseTime("18446744073709551615") == Time{18446744073709551615ull});
    CHECK_FALSE(parseTime("").has_value());
    CHECK_FALSE(parseTime("007").has_value());
    CHECK_FALSE(parseTime("-1").has_value());
    CHECK_FALSE(parseTime("1.5").has_value());
    CHECK_FALSE(parseTime("12ps").has_value());
    CHECK_FALSE(parseTime("18446744073709551616").has_value());  // more than 2^64 - 1
}
