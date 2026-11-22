#include "registry.h"

#include <map>

namespace fpgasim {

namespace {

std::map<std::string, PartType, std::less<>>& registry() {
    static std::map<std::string, PartType, std::less<>> types;
    return types;
}

PartType& entry(std::string_view type) {
    auto& types = registry();
    auto it = types.find(type);
    if (it == types.end()) {
        it = types.emplace(std::string(type), PartType{}).first;
        it->second.type = std::string(type);
    }
    return it->second;
}

// Checks a value against its description: type, enum, minimum, maximum, maxLength, items.
std::string checkValue(const Json& spec, const Json& value) {
    const std::string kind = spec.value("type", "");
    bool typeOk = true;
    if (kind == "integer") {
        typeOk = value.is_number_integer();
    } else if (kind == "number") {
        typeOk = value.is_number();
    } else if (kind == "string") {
        typeOk = value.is_string();
    } else if (kind == "boolean") {
        typeOk = value.is_boolean();
    } else if (kind == "array") {
        typeOk = value.is_array();
    }
    if (!typeOk) return "ожидается значение вида " + kind;
    if (const auto it = spec.find("enum"); it != spec.end() && it->is_array()) {
        bool found = false;
        for (const Json& option : *it) found = found || option == value;
        if (!found) return "значение не входит в список допустимых";
    }
    if (value.is_number()) {
        const double v = value.get<double>();
        if (const auto it = spec.find("minimum"); it != spec.end() && it->is_number() && v < it->get<double>())
            return "значение меньше допустимого";
        if (const auto it = spec.find("maximum"); it != spec.end() && it->is_number() && v > it->get<double>())
            return "значение больше допустимого";
    }
    if (value.is_string()) {
        if (const auto it = spec.find("maxLength"); it != spec.end() && it->is_number_unsigned() &&
                                                    value.get_ref<const std::string&>().size() > it->get<size_t>())
            return "строка длиннее допустимого";
    }
    if (value.is_array()) {
        if (const auto it = spec.find("items"); it != spec.end() && it->is_object()) {
            for (const Json& item : value) {
                if (std::string err = checkValue(*it, item); !err.empty()) return "элемент массива: " + err;
            }
        }
    }
    return {};
}

}  // namespace

void registerPart(std::string_view type, PartFactory factory) { entry(type).factory = factory; }

void registerPartDescription(std::string_view type, std::string_view jsonText) {
    PartType& t = entry(type);
    Json desc = Json::parse(jsonText, nullptr, false);
    if (!desc.is_object() || !desc.contains("pins") || !desc["pins"].is_array()) return;
    t.pins.clear();
    for (const Json& pin : desc["pins"]) {
        if (!pin.is_object()) return;
        t.pins.push_back({pin.value("role", ""), pin.value("dir", "in") == "out", pin.value("edges", false)});
    }
    t.desc = std::move(desc);
    t.described = true;
}

const PartType* findPartType(std::string_view type) {
    const auto& types = registry();
    const auto it = types.find(type);
    if (it == types.end() || !it->second.factory || !it->second.described) return nullptr;
    return &it->second;
}

std::vector<std::string> partTypeNames() {
    std::vector<std::string> names;
    for (const auto& [name, type] : registry()) {
        if (type.factory && type.described) names.push_back(name);
    }
    return names;
}

std::string resolveSettings(const PartType& type, const Json& given, Json& merged) {
    static const Json kEmpty = Json::object();
    const auto specsIt = type.desc.find("settings");
    const Json& specs = specsIt != type.desc.end() && specsIt->is_object() ? *specsIt : kEmpty;
    merged = Json::object();
    for (const auto& [name, spec] : specs.items()) {
        if (spec.is_object() && spec.contains("default")) merged[name] = spec["default"];
    }
    if (given.is_null()) return {};
    if (!given.is_object()) return "настройки должны быть объектом";
    for (const auto& [name, value] : given.items()) {
        const auto spec = specs.find(name);
        if (spec == specs.end()) return "неизвестная настройка \"" + name + "\"";
        if (std::string err = checkValue(*spec, value); !err.empty()) return "настройка \"" + name + "\": " + err;
        merged[name] = value;
    }
    return {};
}

std::string checkCommand(const PartType& type, std::string_view cmd, const Json& args) {
    const auto commands = type.desc.find("commands");
    if (commands == type.desc.end() || !commands->is_array()) return "у детали нет команд";
    for (const Json& command : *commands) {
        if (!command.is_object() || command.value("name", "") != cmd) continue;
        static const Json kEmpty = Json::object();
        const auto specsIt = command.find("args");
        const Json& specs = specsIt != command.end() && specsIt->is_object() ? *specsIt : kEmpty;
        if (!args.is_null() && !args.is_object()) return "аргументы должны быть объектом";
        for (const auto& [name, spec] : specs.items()) {
            if (args.is_null() || !args.contains(name)) return "нет аргумента \"" + name + "\"";
            if (std::string err = checkValue(spec, args[name]); !err.empty())
                return "аргумент \"" + name + "\": " + err;
        }
        if (args.is_object()) {
            for (const auto& [name, value] : args.items()) {
                if (!specs.contains(name)) return "неизвестный аргумент \"" + name + "\"";
            }
        }
        return {};
    }
    return "у детали нет команды \"" + std::string(cmd) + "\"";
}

}  // namespace fpgasim
