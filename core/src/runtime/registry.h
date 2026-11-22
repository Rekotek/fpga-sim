// Part registry: type -> factory and description from parts/<type>/part.json (spec sections 5.6 and 5.7).
#pragma once

#include <string>
#include <string_view>
#include <vector>

#include "fpgasim/part.h"

namespace fpgasim {

struct PartPin {
    std::string role;
    bool out;    // the part drives the net
    bool edges;  // the part needs onEdge
};

struct PartType {
    std::string type;
    PartFactory factory = nullptr;
    bool described = false;
    Json desc;  // the whole part description
    std::vector<PartPin> pins;
};

// Part description as JSON text. The texts are embedded when the library is built.
void registerPartDescription(std::string_view type, std::string_view jsonText);

// A type with a factory and a description; otherwise nullptr.
const PartType* findPartType(std::string_view type);
std::vector<std::string> partTypeNames();

// Fills settings with the defaults from the description and checks them. Returns the error text or an empty string.
std::string resolveSettings(const PartType& type, const Json& given, Json& merged);

// Checks a command and its arguments against the description. Returns the error text or an empty string.
std::string checkCommand(const PartType& type, std::string_view cmd, const Json& args);

}  // namespace fpgasim
