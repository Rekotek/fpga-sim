// A refusal of a check: the Russian text for the native runner and the logs, and the arguments for the
// interface. The interface shows its own string by args.reason in its language (decision 183); a refusal
// without args shows by the error code.
#pragma once

#include <string>
#include <utility>

#include "fpgasim/json.h"

namespace fpgasim {

struct Refusal {
    std::string text;
    Json args;  // null, or an object with "reason" and the values the interface string substitutes

    Refusal() = default;
    Refusal(const char* t) : text(t) {}                                 // NOLINT(google-explicit-constructor)
    Refusal(std::string t) : text(std::move(t)) {}                      // NOLINT(google-explicit-constructor)
    Refusal(std::string t, Json a) : text(std::move(t)), args(std::move(a)) {}

    bool failed() const { return !text.empty(); }
};

}  // namespace fpgasim
