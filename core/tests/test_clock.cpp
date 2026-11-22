// Time and clock (spec section 5.2).
#include <algorithm>
#include <catch2/catch_test_macros.hpp>
#include <vector>

#include "fpgasim/clock.h"

using namespace fpgasim;

TEST_CASE("полутакт 54 000 000 при 27 МГц начинается ровно в 10^12 пс", "[clock]") {
    CHECK(halfStart(27'000'000, 54'000'000) == 1'000'000'000'000ull);
    CHECK(halfStart(27'000'000, 0) == 0);
    // The 27 MHz period is not a whole number of picoseconds, but the error does not accumulate.
    CHECK(halfStart(27'000'000, 1) == 18518);
    CHECK(halfStart(27'000'000, 2) == 37037);
    CHECK(halfStart(27'000'000, 3) == 55555);
    for (uint64_t seconds : {1ull, 7ull, 3600ull, 86400ull * 200})
        CHECK(halfStart(27'000'000, seconds * 54'000'000) == seconds * kPsPerSecond);
}

TEST_CASE("halfAtOrAfter обратна halfStart", "[clock]") {
    const uint64_t hz = 27'000'000;
    for (uint64_t half : {0ull, 1ull, 2ull, 53'999'999ull, 54'000'000ull, 113'400'000ull}) {
        const Time t = halfStart(hz, half);
        CHECK(halfAtOrAfter(hz, t) == half);          // the half-cycle that started exactly at t is not executed yet
        CHECK(halfAtOrAfter(hz, t + 1) == half + 1);  // and by time t + 1 it has started
    }
    CHECK(halfAtOrAfter(hz, 0) == 0);
    CHECK(halfAtOrAfter(hz, 2'100'000'000'000ull) == 113'400'000ull);
}

TEST_CASE("два такта 27 и 25,175 МГц дают верный порядок фронтов на отрезке в 1 мс", "[clock]") {
    const Time limit = 1'000'000'000ull;  // 1 ms
    const uint64_t hzA = 27'000'000, hzB = 25'175'000;

    struct Edge {
        Time time;
        int clock;
        uint64_t half;
    };
    // Reference: the edges of each clock by the formula, then a stable sort by time.
    std::vector<Edge> expected;
    for (uint64_t h = 0; halfStart(hzA, h) < limit; ++h) expected.push_back({halfStart(hzA, h), 0, h});
    for (uint64_t h = 0; halfStart(hzB, h) < limit; ++h) expected.push_back({halfStart(hzB, h), 1, h});
    std::stable_sort(expected.begin(), expected.end(), [](const Edge& a, const Edge& b) {
        return a.time != b.time ? a.time < b.time : a.clock < b.clock;
    });
    REQUIRE(expected.size() == 54000 + 50350);

    ClockList clocks;
    REQUIRE(clocks.add(hzA) == 0);
    REQUIRE(clocks.add(hzB) == 1);
    size_t i = 0;
    Time last = 0;
    for (;; ++i) {
        const ClockList::Edge e = clocks.next();
        if (e.time >= limit) break;
        REQUIRE(i < expected.size());
        REQUIRE(e.time >= last);
        REQUIRE(e.time == expected[i].time);
        REQUIRE(e.clock == expected[i].clock);
        REQUIRE(e.half == expected[i].half);
        REQUIRE(e.rising == ((e.half & 1) == 0));
        last = e.time;
        clocks.advance(e.clock, 1);
    }
    CHECK(i == expected.size());
    CHECK(clocks.half(0) == 54000);
    CHECK(clocks.half(1) == 50350);
    // At time 0 both clocks give a rising edge; the source with the smaller index goes first.
    CHECK(expected[0].clock == 0);
    CHECK(expected[1].clock == 1);
    CHECK(expected[1].time == 0);

    clocks.rewind();
    CHECK(clocks.next().time == 0);
    CHECK(ClockList().next().clock == -1);
}
