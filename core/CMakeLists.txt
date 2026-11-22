# FPGA SIM runtime (spec section 5.8).
# Targets: fpgasim_rt (static library), fpgasim_tests (tests on the host machine, Catch2),
# fpgasim_example_main (example launcher) and fpgasim_verilated (Verilator support files).
# WebAssembly build (emcmake cmake, runs during the image build): one library, libfpgasim_rt.a,
# with the runtime, the parts, the fs_* boundary and the Verilator support files; it has no tests.
cmake_minimum_required(VERSION 3.28)

file(STRINGS "${CMAKE_CURRENT_SOURCE_DIR}/VERSION" FPGASIM_RUNTIME_VERSION LIMIT_COUNT 1)
project(fpgasim_core VERSION ${FPGASIM_RUNTIME_VERSION} LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
# The code has no C++20 modules; without this line CMake 3.28 looks for clang-scan-deps, which the image lacks.
set(CMAKE_CXX_SCAN_FOR_MODULES OFF)

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()
# Same optimization level as the model (decision 3).
set(CMAKE_CXX_FLAGS_RELEASE "-O2")

option(FPGASIM_BUILD_TESTS "Собирать тесты ядра" ON)
set(FPGASIM_VERILATOR_ROOT "/opt/verilator" CACHE PATH "Каталог установки Verilator")
set(FPGASIM_REPO_DIR "${CMAKE_CURRENT_SOURCE_DIR}/..")

# Under Emscripten the system /usr/include is not on the search path: nlohmann/json sits in a separate
# folder next to the core headers (FPGASIM_JSON_INCLUDE), which the Dockerfile prepares.
if(EMSCRIPTEN)
    set(FPGASIM_JSON_INCLUDE "" CACHE PATH "Каталог, в котором лежит nlohmann/json.hpp")
    if(NOT EXISTS "${FPGASIM_JSON_INCLUDE}/nlohmann/json.hpp")
        message(FATAL_ERROR "FPGASIM_JSON_INCLUDE: нет nlohmann/json.hpp в '${FPGASIM_JSON_INCLUDE}'")
    endif()
    add_library(fpgasim_json INTERFACE)
    target_include_directories(fpgasim_json INTERFACE "${FPGASIM_JSON_INCLUDE}")
    add_library(nlohmann_json::nlohmann_json ALIAS fpgasim_json)
    set(FPGASIM_BUILD_TESTS OFF)
else()
    find_package(nlohmann_json 3.11 REQUIRED)
endif()

# Part descriptions parts/<type>/part.json are embedded into the library as text (spec section 5.7).
# The list holds only parts that have a C++ class.
set(FPGASIM_BUILTIN_PARTS led button switch probe uart ws2812)
set(FPGASIM_GENERATED_DIR "${CMAKE_CURRENT_BINARY_DIR}/generated")
set(part_descriptions "")
foreach(type IN LISTS FPGASIM_BUILTIN_PARTS)
    set(part_file "${FPGASIM_REPO_DIR}/parts/${type}/part.json")
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${part_file}")
    file(READ "${part_file}" part_text)
    string(APPEND part_descriptions "{\"${type}\", R\"fpgasimpart(${part_text})fpgasimpart\"},\n")
endforeach()
file(CONFIGURE OUTPUT "${FPGASIM_GENERATED_DIR}/part_descriptions.inc" CONTENT "${part_descriptions}" @ONLY)

add_library(fpgasim_rt STATIC
    src/runtime/protocol.cpp
    src/runtime/recorder.cpp
    src/runtime/registry.cpp
    src/runtime/runtime.cpp
    src/parts/builtin.cpp
    src/parts/button.cpp
    src/parts/led.cpp
    src/parts/uart.cpp
    src/parts/ws2812.cpp
)
target_include_directories(fpgasim_rt PUBLIC include PRIVATE "${FPGASIM_GENERATED_DIR}")
target_compile_definitions(fpgasim_rt PRIVATE FPGASIM_RUNTIME_VERSION="${FPGASIM_RUNTIME_VERSION}")
target_compile_options(fpgasim_rt PRIVATE -Wall -Wextra -Wno-unused-parameter)
target_link_libraries(fpgasim_rt PUBLIC nlohmann_json::nlohmann_json)

# Verilator support files (decision 5): built once, they fit any model of the same version.
set(verilated_dir "${FPGASIM_VERILATOR_ROOT}/include")
set(verilated_sources
    "${verilated_dir}/verilated.cpp"
    "${verilated_dir}/verilated_dpi.cpp"
    "${verilated_dir}/verilated_threads.cpp"
)
set(verilated_definitions
    VM_COVERAGE=0 VM_SC=0 VM_TIMING=0 VM_TRACE=0 VM_TRACE_FST=0 VM_TRACE_VCD=0 VM_TRACE_SAIF=0)

if(EMSCRIPTEN)
    # Spec section 5.8: the WebAssembly library also includes the Verilator support files.
    # Same flags as the model (decision 5); the job script server/job/job.py sets them too.
    target_sources(fpgasim_rt PRIVATE src/wasm/boundary.cpp src/wasm/stubs.cpp ${verilated_sources})
    target_include_directories(fpgasim_rt PRIVATE "${verilated_dir}" "${verilated_dir}/vltstd")
    target_compile_definitions(fpgasim_rt PRIVATE ${verilated_definitions} VL_IGNORE_UNKNOWN_ARCH)
    target_compile_options(fpgasim_rt PRIVATE -fbracket-depth=4096 -include cstdint)
    set_source_files_properties(${verilated_sources} PROPERTIES COMPILE_OPTIONS "-w")
    return()
endif()

# Example launcher for the host build: links with the model and the example shim.
add_library(fpgasim_example_main STATIC src/native/example_main.cpp)
target_compile_options(fpgasim_example_main PRIVATE -Wall -Wextra -Wno-unused-parameter)
target_link_libraries(fpgasim_example_main PUBLIC fpgasim_rt)

if(EXISTS "${verilated_dir}/verilated.cpp")
    add_library(fpgasim_verilated STATIC ${verilated_sources})
    target_include_directories(fpgasim_verilated PUBLIC "${verilated_dir}" "${verilated_dir}/vltstd")
    target_compile_definitions(fpgasim_verilated PUBLIC ${verilated_definitions})
    target_compile_options(fpgasim_verilated PRIVATE -w -fbracket-depth=4096)
endif()

if(FPGASIM_BUILD_TESTS)
    find_package(Catch2 3 REQUIRED)
    add_executable(fpgasim_tests
        tests/test_clock.cpp
        tests/test_commands.cpp
        tests/test_nets.cpp
        tests/test_parts.cpp
        tests/test_protocol.cpp
        tests/test_record.cpp
        tests/test_scheduler.cpp
    )
    target_include_directories(fpgasim_tests PRIVATE src)
    target_compile_definitions(fpgasim_tests PRIVATE FPGASIM_REPO_DIR="${FPGASIM_REPO_DIR}")
    target_compile_options(fpgasim_tests PRIVATE -Wall -Wextra -Wno-unused-parameter)
    target_link_libraries(fpgasim_tests PRIVATE fpgasim_rt Catch2::Catch2WithMain)
endif()
