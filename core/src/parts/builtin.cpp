// Explicit list of the library parts (spec section 5.6): self-registration through
// static objects is forbidden, because the linker drops them from a static library.
#include "../runtime/registry.h"
#include "parts.h"

namespace fpgasim {

namespace {

struct Description {
    const char* type;
    const char* json;
};

// Texts of parts/<type>/part.json; CMake creates the file when it configures the build.
constexpr Description kDescriptions[] = {
#include "part_descriptions.inc"
};

}  // namespace

void registerBuiltinParts() {
    for (const Description& d : kDescriptions) registerPartDescription(d.type, d.json);
    registerPart("led", makeLed);
    registerPart("button", makeButton);
    registerPart("switch", makeSwitch);
    registerPart("probe", makeProbe);
    registerPart("uart", makeUart);
    registerPart("ws2812", makeWs2812);
}

}  // namespace fpgasim
