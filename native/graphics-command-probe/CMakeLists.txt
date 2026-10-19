cmake_minimum_required(VERSION 3.24)
project(BetterCaptionsCommandProbe VERSION 0.1.1 LANGUAGES CXX)

if(NOT WIN32 OR NOT MSVC)
  message(FATAL_ERROR "This probe currently requires Windows and MSVC. It is separate from the cross-platform caption plugin.")
endif()
if(NOT CMAKE_SIZEOF_VOID_P EQUAL 8 OR CMAKE_GENERATOR_PLATFORM MATCHES "^(Win32|ARM64)$")
  message(FATAL_ERROR "Build this Premiere probe for x64 (configure Visual Studio with -A x64).")
endif()

set(PREMIERE_SDK_ROOT "" CACHE PATH "External, licensed Premiere Pro 26.0 C++ SDK root")
set(ADOBE_HEADERS "${PREMIERE_SDK_ROOT}/Examples/Headers")
if(NOT EXISTS "${ADOBE_HEADERS}/adobesdk/controlsurface/host/ControlSurfaceHostCommandSuite.h")
  message(FATAL_ERROR "Set PREMIERE_SDK_ROOT to the extracted external Premiere Pro 26.0 C++ SDK. No SDK is downloaded or vendored.")
endif()

add_library(better_captions_command_probe MODULE probe.cpp private_log.cpp)
target_compile_features(better_captions_command_probe PRIVATE cxx_std_17)
target_include_directories(better_captions_command_probe SYSTEM PRIVATE "${ADOBE_HEADERS}")
target_compile_definitions(better_captions_command_probe PRIVATE WIN_ENV=1 _WINDOWS WIN32_LEAN_AND_MEAN NOMINMAX UNICODE _UNICODE)
target_compile_options(better_captions_command_probe PRIVATE /W4 /permissive- /EHsc /utf-8)
target_link_libraries(better_captions_command_probe PRIVATE advapi32 shell32 ole32)
set_target_properties(better_captions_command_probe PROPERTIES
  OUTPUT_NAME BetterCaptionsCommandProbe
  PREFIX ""
  SUFFIX ".acsrf"
  CXX_EXTENSIONS OFF
  MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL")

include(CTest)
if(BUILD_TESTING)
  add_executable(command_probe_log_tests tests/log_tests.cpp)
  target_compile_features(command_probe_log_tests PRIVATE cxx_std_17)
  target_compile_options(command_probe_log_tests PRIVATE /W4 /permissive- /EHsc /utf-8)
  add_test(NAME command_probe_log_tests COMMAND command_probe_log_tests)

  # Compile the original adapter against a fake host; do not load the .acsrf or
  # Premiere. This test replaces only our file writer with an in-memory sink.
  add_executable(command_probe_lifecycle_tests tests/lifecycle_tests.cpp probe.cpp)
  target_compile_features(command_probe_lifecycle_tests PRIVATE cxx_std_17)
  target_include_directories(command_probe_lifecycle_tests SYSTEM PRIVATE "${ADOBE_HEADERS}")
  target_compile_definitions(command_probe_lifecycle_tests PRIVATE WIN_ENV=1 _WINDOWS WIN32_LEAN_AND_MEAN NOMINMAX UNICODE _UNICODE)
  target_compile_options(command_probe_lifecycle_tests PRIVATE /W4 /permissive- /EHsc /utf-8)
  add_test(NAME command_probe_lifecycle_tests COMMAND command_probe_lifecycle_tests)
endif()

# Deliberately no install target, post-build deployment, SDK copying or host launch.
