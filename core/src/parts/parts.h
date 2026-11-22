// Factories of the built-in parts. The explicit list in builtin.cpp registers them.
#pragma once

#include <memory>

#include "fpgasim/part.h"

namespace fpgasim {

std::unique_ptr<Part> makeLed();
std::unique_ptr<Part> makeButton();
std::unique_ptr<Part> makeSwitch();
std::unique_ptr<Part> makeProbe();
std::unique_ptr<Part> makeUart();
std::unique_ptr<Part> makeWs2812();

}  // namespace fpgasim
