#include "registry.h"

#include <map>
#include <utility>

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
// args.reason is the end of the interface reason: the caller puts "setting" or "arg" before it.
Refusal checkValue(const Json& spec, const Json& value) {
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
    if (!typeOk) return {"ожидается значение вида " + kind, Json{{"reason", "Type"}, {"kind", kind}}};
    if (const auto it = spec.find("enum"); it != spec.end() && it->is_array()) {
        bool found = false;
        for (const Json& option : *it) found = found || option == value;
        if (!found) return {"значение не входит в список допустимых", Json{{"reason", "Enum"}}};
    }
    if (value.is_number()) {
        const double v = value.get<double>();
        if (const auto it = spec.find("minimum"); it != spec.end() && it->is_number() && v < it->get<double>())
            return {"значение меньше допустимого", Json{{"reason", "Minimum"}, {"limit", *it}}};
        if (const auto it = spec.find("maximum"); it != spec.end() && it->is_number() && v > it->get<double>())
            return {"значение больше допустимого", Json{{"reason", "Maximum"}, {"limit", *it}}};
    }
    if (value.is_string()) {
        if (const auto it = spec.find("maxLength"); it != spec.end() && it->is_number_unsigned() &&
                                                    value.get_ref<const std::string&>().size() > it->get<size_t>())
            return {"строка длиннее допустимого", Json{{"reason", "MaxLength"}, {"limit", *it}}};
    }
    if (value.is_array()) {
        if (const auto it = spec.find("items"); it != spec.end() && it->is_object()) {
            for (const Json& item : value) {
                if (Refusal err = checkValue(*it, item); err.failed())
                    return {"элемент массива: " + err.text, std::move(err.args)};
            }
        }
    }
    return {};
}

// The reason of a value check with a prefix: "setting" + "Maximum" = "settingMaximum".
Json prefixed(const char* prefix, Json args) {
    args["reason"] = prefix + args["reason"].get<std::string>();
    return args;
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

Refusal resolveSettings(const PartType& type, const Json& given, Json& merged) {
    static const Json kEmpty = Json::object();
    const auto specsIt = type.desc.find("settings");
    const Json& specs = specsIt != type.desc.end() && specsIt->is_object() ? *specsIt : kEmpty;
    merged = Json::object();
    for (const auto& [name, spec] : specs.items()) {
        if (spec.is_object() && spec.contains("default")) merged[name] = spec["default"];
    }
    if (given.is_null()) return {};
    if (!given.is_object()) return {"настройки должны быть объектом", Json{{"reason", "settingsNotObject"}}};
    for (const auto& [name, value] : given.items()) {
        const auto spec = specs.find(name);
        if (spec == specs.end())
            return {"неизвестная настройка \"" + name + "\"", Json{{"reason", "settingUnknown"}, {"setting", name}}};
        if (Refusal err = checkValue(*spec, value); err.failed()) {
            Json args = prefixed("setting", std::move(err.args));
            args["setting"] = name;
            return {"настройка \"" + name + "\": " + err.text, std::move(args)};
        }
        merged[name] = value;
    }
    return {};
}

Refusal checkCommand(const PartType& type, std::string_view cmd, const Json& args) {
    const std::string command(cmd);
    const auto commands = type.desc.find("commands");
    if (commands == type.desc.end() || !commands->is_array())
        return {"у детали нет команд", Json{{"reason", "commandUnknown"}, {"command", command}}};
    for (const Json& entry : *commands) {
        if (!entry.is_object() || entry.value("name", "") != cmd) continue;
        static const Json kEmpty = Json::object();
        const auto specsIt = entry.find("args");
        const Json& specs = specsIt != entry.end() && specsIt->is_object() ? *specsIt : kEmpty;
        if (!args.is_null() && !args.is_object())
            return {"аргументы должны быть объектом", Json{{"reason", "argsNotObject"}, {"command", command}}};
        for (const auto& [name, spec] : specs.items()) {
            if (args.is_null() || !args.contains(name))
                return {"нет аргумента \"" + name + "\"",
                        Json{{"reason", "argMissing"}, {"command", command}, {"arg", name}}};
            if (Refusal err = checkValue(spec, args[name]); err.failed()) {
                Json found = prefixed("arg", std::move(err.args));
                found["command"] = command;
                found["arg"] = name;
                return {"аргумент \"" + name + "\": " + err.text, std::move(found)};
            }
        }
        if (args.is_object()) {
            for (const auto& [name, value] : args.items()) {
                if (!specs.contains(name))
                    return {"неизвестный аргумент \"" + name + "\"",
                            Json{{"reason", "argUnknown"}, {"command", command}, {"arg", name}}};
            }
        }
        return {};
    }
    return {"у детали нет команды \"" + command + "\"", Json{{"reason", "commandUnknown"}, {"command", command}}};
}

}  // namespace fpgasim
