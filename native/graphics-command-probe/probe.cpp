// Original command-list probe. Adobe's SDK supplies declarations only, externally.
#include "bounded_jsonl.hpp"
#include "private_log.hpp"

#include <windows.h>
#include <adobesdk/AdobesdkStringSuite.h>
#include <adobesdk/controlsurface/host/ControlSurfaceHostCommandSuite.h>
#include <adobesdk/controlsurface/host/ControlSurfaceHostSuite.h>
#include <adobesdk/controlsurface/plugin/ControlSurfacePluginSuite.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cstdio>
#include <new>
#include <string>

namespace {
using bc::command_probe::BoundedJsonl;
using bc::command_probe::JsonString;

constexpr char kPluginID[] = "com.bettercaptions.command-probe.v1";
constexpr char kDisplayName[] = "Better Captions Command Probe (read only)";
constexpr uint32_t kMaxCommands = 16384;
constexpr uint32_t kStringBufferBytes = 4096;
constexpr auto kEnumerationBudget = std::chrono::seconds(3);

SPBasicSuite* basic = nullptr;
const SPSuitesSuite* suites = nullptr;
const ADOBESDK_StringSuite1* strings = nullptr;
SPSuiteListRef registeredSuites = nullptr;
uint32_t hostMajor = 0;
uint32_t hostMinor = 0;

struct CommandRefObservation {
  bool attempted = false;
  SPErr error = kSPNoError;
  bool present = false;
  bool Usable() const { return attempted && error == kSPNoError && present; }
};

struct Instance {
  bool connected = false;
  ADOBESDK_ControlSurfaceHostRef host = nullptr;
  bool firstUpdatePending = false;
  CommandRefObservation connectObservation;
};

template <typename Suite>
class AcquiredSuite {
 public:
  AcquiredSuite(const char* name, int version) : name_(name), version_(version) {
    const void* acquired = nullptr;
    error = basic->AcquireSuite(name, version, &acquired);
    if (error == kSPNoError) value = static_cast<const Suite*>(acquired);
    if (error == kSPNoError && !value) error = kSPBadParameterError;
  }
  ~AcquiredSuite() { if (value) basic->ReleaseSuite(name_, version_); }
  AcquiredSuite(const AcquiredSuite&) = delete;
  AcquiredSuite& operator=(const AcquiredSuite&) = delete;
  const Suite* value = nullptr;
  SPErr error = kSPNoError;
 private:
  const char* name_;
  int version_;
};

struct CommandStrings {
  std::array<ADOBESDK_String, 4> values{};
  ~CommandStrings() {
    for (auto& value : values) strings->DisposeString(&value);
  }
};

std::string Timestamp() {
  SYSTEMTIME now{};
  GetSystemTime(&now);
  char text[32]{};
  std::snprintf(text, sizeof(text), "%04u-%02u-%02uT%02u:%02u:%02uZ",
      static_cast<unsigned>(now.wYear), static_cast<unsigned>(now.wMonth), static_cast<unsigned>(now.wDay),
      static_cast<unsigned>(now.wHour), static_cast<unsigned>(now.wMinute), static_cast<unsigned>(now.wSecond));
  return text;
}

std::string ReadString(const ADOBESDK_String& value, SPErr& error) {
  std::array<ADOBESDK_UTF8Char, kStringBufferBytes> buffer{};
  uint32_t bytes = static_cast<uint32_t>(buffer.size());
  error = strings->CopyToUTF8String(&value, buffer.data(), &bytes);
  if (error != kSPNoError) return "null";
  if (bytes == 0 || bytes > buffer.size() || buffer[bytes - 1] != 0) {
    error = kSPBadParameterError;
    return "null";
  }
  // Use the suite's explicit byte count; do not dereference its opaque storage.
  return JsonString(std::string_view(reinterpret_cast<const char*>(buffer.data()), bytes - 1));
}

void WriteReport(BoundedJsonl& report) {
  const auto error = bc::command_probe::WritePrivateLog(report.Data());
  if (error != ERROR_SUCCESS) {
    char message[160]{};
    std::snprintf(message, sizeof(message), "Better Captions Command Probe: local log write failed (Win32 %lu).\n", error);
    OutputDebugStringA(message);
  }
}

CommandRefObservation Enumerate(ADOBESDK_ControlSurfaceHostRef host, const char* trigger,
    const CommandRefObservation* previous = nullptr) {
  CommandRefObservation observation;
  BoundedJsonl report;
  report.Append("{\"type\":\"probe\",\"version\":\"0.1.1\",\"time_utc\":" + JsonString(Timestamp()) +
      ",\"trigger\":" + JsonString(trigger) + ",\"attempt\":" + (previous ? "2" : "1") +
      ",\"max_attempts_per_connection\":2,\"host\":\"Premiere Pro\",\"host_api_major\":" +
      std::to_string(hostMajor) + ",\"host_api_minor\":" + std::to_string(hostMinor) +
      ",\"command_limit\":" + std::to_string(kMaxCommands) +
      ",\"field_buffer_bytes\":" + std::to_string(kStringBufferBytes) +
      ",\"log_limit_bytes\":" + std::to_string(bc::command_probe::kMaxLogBytes) +
      ",\"execution_enabled\":false}");
  if (previous) {
    report.Append("{\"type\":\"previous_attempt\",\"trigger\":\"control_surface_connect\","
        "\"stage\":\"get_command_ref\",\"error\":" + std::to_string(previous->error) +
        ",\"command_ref_present\":" + (previous->present ? "true" : "false") + "}");
  }

  auto finishFailure = [&](const char* stage, SPErr error, const char* reason = "host_error",
      bool retryPending = false) {
    report.Finish("{\"type\":\"summary\",\"complete\":false,\"stage\":" + JsonString(stage) +
        ",\"error\":" + std::to_string(error) + ",\"reason\":" + JsonString(reason) +
        ",\"first_update_retry_pending\":" + (retryPending ? "true" : "false") + "}");
    WriteReport(report);
  };

  AcquiredSuite<ADOBESDK_ControlSurfaceHostSuite1> hostSuite(
      kADOBESDK_ControlSurfaceHostSuite, kADOBESDK_ControlSurfaceHostSuite_Version1);
  if (hostSuite.error != kSPNoError) { finishFailure("acquire_host_suite", hostSuite.error); return observation; }
  AcquiredSuite<ADOBESDK_ControlSurfaceHostCommandSuite1> commands(
      kADOBESDK_ControlSurfaceHostCommandSuite, kADOBESDK_ControlSurfaceHostCommandSuite_Version1);
  if (commands.error != kSPNoError) { finishFailure("acquire_command_suite", commands.error); return observation; }

  ADOBESDK_ControlSurfaceHostCommandRef commandRef = nullptr;
  SPErr error = hostSuite.value->GetCommandRef(host, &commandRef);
  observation = {true, error, commandRef != nullptr};
  report.Append("{\"type\":\"command_ref\",\"error\":" + std::to_string(error) +
      ",\"present\":" + (observation.present ? "true" : "false") + "}");
  if (!observation.Usable()) {
    // Preserve the API's exact return code: success with a null optional handle
    // is unavailable capability, not a fabricated host bad-parameter error.
    finishFailure("get_command_ref", error,
        error == kSPNoError ? "null_command_ref" : "host_error", previous == nullptr);
    return observation;
  }
  uint32_t advertisedCount = 0;
  error = commands.value->GetCommandCount(commandRef, &advertisedCount);
  if (error != kSPNoError) { finishFailure("get_command_count", error); return observation; }

  const auto began = std::chrono::steady_clock::now();
  const auto limit = (std::min)(advertisedCount, kMaxCommands);
  uint32_t inspected = 0;
  uint32_t failed = 0;
  uint32_t failedStrings = 0;
  std::string stopReason = advertisedCount > limit ? "command_limit" : "none";
  constexpr const char* fieldNames[] = {"context_id", "context_name", "command_id", "command_name"};
  for (uint32_t index = 0; index < limit; ++index) {
    if (std::chrono::steady_clock::now() - began >= kEnumerationBudget) {
      stopReason = "time_limit";
      break;
    }
    CommandStrings command;
    error = commands.value->GetCommand(commandRef, index, &command.values[0], &command.values[1],
        &command.values[2], &command.values[3]);
    std::string row = "{\"type\":\"command\",\"index\":" + std::to_string(index) +
        ",\"error\":" + std::to_string(error);
    if (error == kSPNoError) {
      std::array<SPErr, 4> stringErrors{};
      for (std::size_t field = 0; field < command.values.size(); ++field) {
        row += "," + JsonString(fieldNames[field]) + ":" + ReadString(command.values[field], stringErrors[field]);
        if (stringErrors[field] != kSPNoError) ++failedStrings;
      }
      row += ",\"string_errors\":[";
      for (std::size_t field = 0; field < stringErrors.size(); ++field) {
        if (field) row += ',';
        row += std::to_string(stringErrors[field]);
      }
      row += ']';
    } else {
      ++failed;
    }
    row += '}';
    if (!report.Append(row)) { stopReason = "byte_limit"; break; }
    ++inspected;
  }
  const bool complete = inspected == advertisedCount && failed == 0 && failedStrings == 0;
  report.Finish("{\"type\":\"summary\",\"complete\":" + std::string(complete ? "true" : "false") +
      ",\"advertised_commands\":" + std::to_string(advertisedCount) +
      ",\"logged_commands\":" + std::to_string(inspected) +
      ",\"failed_commands\":" + std::to_string(failed) +
      ",\"failed_strings\":" + std::to_string(failedStrings) +
      ",\"stop_reason\":" + JsonString(stopReason) + "}");
  WriteReport(report);
  return observation;
}

SPErr StringResult(const char* value, ADOBESDK_String* output) {
  if (!output || !strings) return kSPBadParameterError;
  *output = {};
  return strings->AllocateFromUTF8(reinterpret_cast<const ADOBESDK_UTF8Char*>(value), output);
}

SPErr Connect(ADOBESDK_ControlSurfacePluginRef plugin, ADOBESDK_ControlSurfaceHostRef host,
    ADOBESDK_ControlSurfaceRef* output) {
  if (!output) return kSPBadParameterError;
  *output = nullptr;
  if (!plugin || !host || !basic || !strings) return kSPBadParameterError;
  auto* instance = reinterpret_cast<Instance*>(plugin);
  instance->connected = true;
  instance->host = host;
  instance->firstUpdatePending = false;
  instance->connectObservation = {};
  try {
    // Connect is delivered for a configured surface, not during plugin discovery.
    instance->connectObservation = Enumerate(host, "control_surface_connect");
    instance->firstUpdatePending = instance->connectObservation.attempted &&
        !instance->connectObservation.Usable();
  } catch (...) {
    OutputDebugStringA("Better Captions Command Probe: enumeration failed; no commands executed.\n");
  }
  *output = reinterpret_cast<ADOBESDK_ControlSurfaceRef>(instance);
  return kSPNoError;
}

SPErr Disconnect(ADOBESDK_ControlSurfacePluginRef plugin) {
  if (!plugin) return kSPBadParameterError;
  auto* instance = reinterpret_cast<Instance*>(plugin);
  instance->connected = false;
  instance->host = nullptr;
  instance->firstUpdatePending = false;
  return kSPNoError;
}
SPErr PluginID(ADOBESDK_ControlSurfacePluginRef, ADOBESDK_String* output) { return StringResult(kPluginID, output); }
SPErr DisplayName(ADOBESDK_ControlSurfacePluginRef, ADOBESDK_String* output) { return StringResult(kDisplayName, output); }
SPErr GetSettings(ADOBESDK_ControlSurfacePluginRef, ADOBESDK_String* output) { return StringResult("{}", output); }
SPErr SetSettings(ADOBESDK_ControlSurfacePluginRef, const ADOBESDK_String*) { return kSPNoError; }
SPErr HasSettingsDialog(ADOBESDK_ControlSurfacePluginRef, ADOBESDK_Boolean* output) {
  if (!output) return kSPBadParameterError;
  *output = kAdobesdk_False;
  return kSPNoError;
}
SPErr SettingsDialog(ADOBESDK_ControlSurfacePluginRef, void*, ADOBESDK_Boolean* changed) {
  if (changed) *changed = kAdobesdk_False;
  return kSPUnimplementedError;
}
SPErr NoPluginAction(ADOBESDK_ControlSurfacePluginRef) { return kSPNoError; }
SPErr ConfigIdentifier(ADOBESDK_ControlSurfaceRef, ADOBESDK_String* output) { return StringResult(kPluginID, output); }
SPErr Flags(ADOBESDK_ControlSurfaceRef, uint32_t* output) {
  if (!output) return kSPBadParameterError;
  *output = 0;
  return kSPNoError;
}
template <typename Ref>
SPErr NoSurface(ADOBESDK_ControlSurfaceRef, Ref* output) {
  if (!output) return kSPBadParameterError;
  *output = nullptr;
  return kSPNoError;
}
SPErr Update(ADOBESDK_ControlSurfaceRef surface) {
  if (!surface) return kSPBadParameterError;
  auto* instance = reinterpret_cast<Instance*>(surface);
  if (!instance->connected || !instance->host || !instance->firstUpdatePending) return kSPNoError;
  // Consume before any host call, so reentrant or subsequent Updates cannot
  // repeat the probe. No timers, focus retries, or retained command handle.
  instance->firstUpdatePending = false;
  try {
    Enumerate(instance->host, "control_surface_first_update", &instance->connectObservation);
  } catch (...) {
    OutputDebugStringA("Better Captions Command Probe: first-update probe failed; no commands executed.\n");
  }
  return kSPNoError;
}

ADOBESDK_ControlSurfacePluginSuite1 pluginCallbacks{
  Connect, Disconnect, PluginID, DisplayName, GetSettings, SetSettings,
  HasSettingsDialog, SettingsDialog, NoPluginAction, NoPluginAction
};
ADOBESDK_ControlSurfaceSuite2 surfaceCallbacks{
  ConfigIdentifier, Flags,
  NoSurface<ADOBESDK_ControlSurfaceTransportRef>, NoSurface<ADOBESDK_ControlSurfaceMixerRef>,
  NoSurface<ADOBESDK_ControlSurfaceMarkerRef>, NoSurface<ADOBESDK_ControlSurfaceCommandRef>,
  Update, NoSurface<ADOBESDK_ControlSurfaceLumetriRef>
};

SPErr Shutdown() {
  if (registeredSuites && suites) suites->FreeSuiteList(registeredSuites);
  registeredSuites = nullptr;
  if (suites && basic) basic->ReleaseSuite(kSPSuitesSuite, kSPSuitesSuiteVersion);
  suites = nullptr;
  if (strings && basic) basic->ReleaseSuite(kADOBESDK_StringSuite, kADOBESDK_StringSuite_Version1);
  strings = nullptr;
  return kSPNoError;
}

SPErr Startup() {
  if (!basic) return kSPBadParameterError;
  if (registeredSuites) return kSPNoError;
  const void* acquired = nullptr;
  SPErr error = basic->AcquireSuite(kADOBESDK_StringSuite, kADOBESDK_StringSuite_Version1, &acquired);
  if (error != kSPNoError) return error;
  strings = static_cast<const ADOBESDK_StringSuite1*>(acquired);
  if (!strings) return kSPBadParameterError;
  acquired = nullptr;
  error = basic->AcquireSuite(kSPSuitesSuite, kSPSuitesSuiteVersion, &acquired);
  if (error == kSPNoError) suites = static_cast<const SPSuitesSuite*>(acquired);
  if (error != kSPNoError || !suites) { Shutdown(); return error != kSPNoError ? error : kSPBadParameterError; }
  error = suites->AllocateSuiteList(kSPRuntimeStringPool, kSPRuntimePluginList, &registeredSuites);
  if (error != kSPNoError || !registeredSuites) { Shutdown(); return error != kSPNoError ? error : kSPBadParameterError; }
  SPSuiteRef registration = nullptr;
  error = suites->AddSuite(registeredSuites, nullptr, kADOBESDK_ControlSurfacePluginSuite,
      kADOBESDK_ControlSurfacePluginSuite_Version1, kADOBESDK_ControlSurfacePluginSuite_Version1,
      &pluginCallbacks, &registration);
  for (const int version : {kADOBESDK_ControlSurfaceSuite_Version1, kADOBESDK_ControlSurfaceSuite_Version2}) {
    if (error != kSPNoError) break;
    error = suites->AddSuite(registeredSuites, nullptr, kADOBESDK_ControlSurfaceSuite,
        version, version, &surfaceCallbacks, &registration);
  }
  if (error != kSPNoError) Shutdown();
  return error;
}

SPErr Create(ADOBESDK_ControlSurfacePluginRef* output) {
  if (!output) return kSPBadParameterError;
  auto* instance = new (std::nothrow) Instance;
  *output = reinterpret_cast<ADOBESDK_ControlSurfacePluginRef>(instance);
  return instance ? kSPNoError : static_cast<SPErr>(kSPOutOfMemoryError);
}
SPErr Delete(ADOBESDK_ControlSurfacePluginRef plugin) {
  delete reinterpret_cast<Instance*>(plugin);
  return kSPNoError;
}
SPErr SuiteList(SPSuiteListRef* output) {
  if (!output || !registeredSuites) return kSPBadParameterError;
  *output = registeredSuites;
  return kSPNoError;
}

}  // namespace

extern "C" ADOBE_CONTROLSURFACE_API SPErr EntryPoint(SPBasicSuite* suppliedBasic,
    uint32_t major, uint32_t minor, ADOBESDK_ControlSurfaceHostID host,
    ADOBESDK_ControlSurfacePluginFuncs* output) {
  if (!output) return kSPBadParameterError;
  *output = {};
  if (!suppliedBasic) return kSPBadParameterError;
  if (host != kADOBESDK_ControlSurfaceHost_PremierePro) return kSPUnimplementedError;
  basic = suppliedBasic;
  hostMajor = major;
  hostMinor = minor;
  *output = {Startup, Shutdown, Create, Delete, SuiteList};
  return kSPNoError;
}
