// LED (spec section 6.1) and probe (spec section 6.5). They have no model: the interface takes
// the LED brightness from the net block of the frame; the probe only adds a net to the signal panel.
#include "parts.h"

namespace fpgasim {

namespace {

class Passive final : public Part {
public:
    void attach(PartHost&, const Json&) override {}
    void reset() override {}
};

}  // namespace

std::unique_ptr<Part> makeLed() { return std::make_unique<Passive>(); }
std::unique_ptr<Part> makeProbe() { return std::make_unique<Passive>(); }

}  // namespace fpgasim
