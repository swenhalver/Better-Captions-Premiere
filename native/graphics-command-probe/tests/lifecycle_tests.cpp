#include "../private_log.hpp"

#include <adobesdk/AdobesdkStringSuite.h>
#include <adobesdk/controlsurface/host/ControlSurfaceHostCommandSuite.h>
#include <adobesdk/controlsurface/host/ControlSurfaceHostSuite.h>
#include <adobesdk/controlsurface/plugin/ControlSurfacePluginSuite.h>

#include <cstdlib>
#include <cstring>
#include <iostream>
#include <map>
#include <string>

extern "C" SPErr EntryPoint(SPBasicSuite*, uint32_t, uint32_t,
    ADOBESDK_ControlSurfaceHostID, ADOBESDK_ControlSurfacePluginFuncs*);

namespace {
// Synthetic host data only. No Adobe opaque string contents are inspected or
// synthesized: this fake String Suite keeps its own values in a side table.
std::map<const ADOBESDK_String*, std::string> fakeStrings;
std::map<std::string, int> suiteBalances;
const ADOBESDK_ControlSurfacePluginSuite1* pluginSuite = nullptr;
const ADOBESDK_ControlSurfaceSuite2* surfaceSuite = nullptr;
ADOBESDK_StringSuite1 stringSuite{};
SPSuitesSuite suites{};
ADOBESDK_ControlSurfaceHostSuite1 hostSuite{};
ADOBESDK_ControlSurfaceHostCommandSuite1 commandSuite{};
std::string capturedLog;
std::string failAcquire;
bool commandFailure = false;
bool stringTooLong = false;
bool countFailure = false;
SPErr commandRefError = kSPNoError;
bool nullCommandRef = false;
bool reenterOnCommandRef = false;
ADOBESDK_ControlSurfaceRef reentrantSurface = nullptr;
int acquireCount = 0;
int commandRefCount = 0;
int enumerationCount = 0;
int executeCount = 0;
int listCount = 0;
int registrationCount = 0;
int listStorage = 0;
int commandStorage = 0;
int hostStorage = 0;

void Require(bool condition, const char* message) {
  if (!condition) {
    std::cerr << message << '\n';
    std::exit(1);
  }
}

SPErr AllocateString(const ADOBESDK_UTF8Char* input, ADOBESDK_String* output) {
  *output = {};
  fakeStrings[output] = reinterpret_cast<const char*>(input);
  return kSPNoError;
}
SPErr DisposeString(const ADOBESDK_String* input) {
  fakeStrings.erase(input);
  return kSPNoError;
}
SPErr CopyString(const ADOBESDK_String* input, ADOBESDK_UTF8Char* output, uint32_t* bytes) {
  const auto found = fakeStrings.find(input);
  const std::string text = found == fakeStrings.end() ? "" : found->second;
  const auto needed = static_cast<uint32_t>(text.size() + 1);
  if (*bytes < needed) {
    *bytes = needed;
    return kADOBESDK_Error_StringBufferTooSmall;
  }
  std::memcpy(output, text.c_str(), needed);
  *bytes = needed;
  return kSPNoError;
}
SPErr AllocateList(SPStringPoolRef, SPPluginListRef, SPSuiteListRef* output) {
  ++listCount;
  *output = reinterpret_cast<SPSuiteListRef>(&listStorage);
  return kSPNoError;
}
SPErr FreeList(SPSuiteListRef) {
  --listCount;
  return kSPNoError;
}
SPErr AddSuite(SPSuiteListRef, SPPluginRef, const char* name, int, int,
    const void* callbacks, SPSuiteRef* output) {
  ++registrationCount;
  *output = reinterpret_cast<SPSuiteRef>(&listStorage);
  if (std::strcmp(name, kADOBESDK_ControlSurfacePluginSuite) == 0)
    pluginSuite = static_cast<const ADOBESDK_ControlSurfacePluginSuite1*>(callbacks);
  else if (std::strcmp(name, kADOBESDK_ControlSurfaceSuite) == 0)
    surfaceSuite = static_cast<const ADOBESDK_ControlSurfaceSuite2*>(callbacks);
  else return kSPBadParameterError;
  return kSPNoError;
}
SPErr AcquireSuite(const char* name, int, const void** output) {
  ++acquireCount;
  *output = nullptr;
  if (failAcquire == name) return kSPUnimplementedError;
  if (std::strcmp(name, kADOBESDK_StringSuite) == 0) *output = &stringSuite;
  else if (std::strcmp(name, kSPSuitesSuite) == 0) *output = &suites;
  else if (std::strcmp(name, kADOBESDK_ControlSurfaceHostSuite) == 0) *output = &hostSuite;
  else if (std::strcmp(name, kADOBESDK_ControlSurfaceHostCommandSuite) == 0) *output = &commandSuite;
  else return kSPUnimplementedError;
  ++suiteBalances[name];
  return kSPNoError;
}
SPErr ReleaseSuite(const char* name, int) {
  Require(suiteBalances[name] > 0, "Never release a suite that was not acquired.");
  --suiteBalances[name];
  return kSPNoError;
}
SPErr CommandRef(ADOBESDK_ControlSurfaceHostRef host, ADOBESDK_ControlSurfaceHostCommandRef* output) {
  Require(host == reinterpret_cast<ADOBESDK_ControlSurfaceHostRef>(&hostStorage),
      "Use only the host reference supplied for this connection.");
  ++commandRefCount;
  if (reenterOnCommandRef) {
    reenterOnCommandRef = false;
    Require(surfaceSuite->Update(reentrantSurface) == kSPNoError, "A reentrant update must be harmless.");
  }
  *output = nullCommandRef ? nullptr : reinterpret_cast<ADOBESDK_ControlSurfaceHostCommandRef>(&commandStorage);
  return commandRefError;
}
SPErr Count(ADOBESDK_ControlSurfaceHostCommandRef ref, uint32_t* output) {
  Require(ref == reinterpret_cast<ADOBESDK_ControlSurfaceHostCommandRef>(&commandStorage),
      "Never enumerate through an absent command handle.");
  ++enumerationCount;
  if (countFailure) return kSPUnimplementedError;
  *output = 2;
  return kSPNoError;
}
SPErr Command(ADOBESDK_ControlSurfaceHostCommandRef, uint32_t index,
    ADOBESDK_String* contextID, ADOBESDK_String* contextName,
    ADOBESDK_String* commandID, ADOBESDK_String* commandName) {
  // Also exercise partial allocation on a failing GetCommand call.
  AllocateString(reinterpret_cast<const ADOBESDK_UTF8Char*>("mock-context"), contextID);
  if (commandFailure && index == 1) return kSPUnimplementedError;
  AllocateString(reinterpret_cast<const ADOBESDK_UTF8Char*>("Mock context"), contextName);
  AllocateString(reinterpret_cast<const ADOBESDK_UTF8Char*>("mock-only-command"), commandID);
  const std::string name = stringTooLong ? std::string(5000, 'x') : "Mock \"quoted\"\ncommand";
  AllocateString(reinterpret_cast<const ADOBESDK_UTF8Char*>(name.c_str()), commandName);
  return kSPNoError;
}
SPErr Execute(ADOBESDK_ControlSurfaceHostCommandRef, const ADOBESDK_String*, const ADOBESDK_String*) {
  ++executeCount;
  return kSPLogicError;
}

void RequireReleasedHostResources() {
  Require(fakeStrings.empty(), "Release every returned string, including partially allocated error results.");
  Require(suiteBalances[kADOBESDK_ControlSurfaceHostSuite] == 0, "Release the host suite after enumeration.");
  Require(suiteBalances[kADOBESDK_ControlSurfaceHostCommandSuite] == 0, "Release the command suite after enumeration.");
  Require(executeCount == 0, "Enumeration must never execute a host command.");
}
}  // namespace

namespace bc::command_probe {
unsigned long WritePrivateLog(std::string_view contents) noexcept {
  capturedLog.assign(contents);
  return 0;
}
}  // namespace bc::command_probe

int main() {
  stringSuite.AllocateFromUTF8 = AllocateString;
  stringSuite.CopyToUTF8String = CopyString;
  stringSuite.DisposeString = DisposeString;
  suites.AllocateSuiteList = AllocateList;
  suites.FreeSuiteList = FreeList;
  suites.AddSuite = AddSuite;
  hostSuite.GetCommandRef = CommandRef;
  commandSuite.GetCommandCount = Count;
  commandSuite.GetCommand = Command;
  commandSuite.ExecuteCommand = Execute;
  SPBasicSuite basic{};
  basic.AcquireSuite = AcquireSuite;
  basic.ReleaseSuite = ReleaseSuite;
  ADOBESDK_ControlSurfacePluginFuncs callbacks{};

  Require(EntryPoint(&basic, 1, 0, kADOBESDK_ControlSurfaceHost_Audition, &callbacks) != kSPNoError,
      "Reject non-Premiere hosts.");
  Require(acquireCount == 0 && capturedLog.empty(), "Entry point discovery must not acquire host commands or log.");
  Require(EntryPoint(&basic, 1, 0, kADOBESDK_ControlSurfaceHost_PremierePro, &callbacks) == kSPNoError,
      "Accept the documented Premiere entry point.");
  Require(callbacks.Startup() == kSPNoError && pluginSuite && surfaceSuite && registrationCount == 3,
      "Register the plugin plus both supported surface suite versions.");
  Require(enumerationCount == 0 && capturedLog.empty(), "Startup must not enumerate.");

  ADOBESDK_ControlSurfacePluginRef plugin = nullptr;
  Require(callbacks.CreatePluginInstance(&plugin) == kSPNoError && plugin, "Create a probe instance.");
  ADOBESDK_String display{};
  Require(pluginSuite->GetPluginDisplayString(plugin, &display) == kSPNoError, "Return the display name through String Suite.");
  Require(fakeStrings[&display].find("read only") != std::string::npos, "Identify the probe's scope in Preferences.");
  DisposeString(&display);
  Require(enumerationCount == 0 && capturedLog.empty(), "Listing an instance must not enumerate.");

  const auto host = reinterpret_cast<ADOBESDK_ControlSurfaceHostRef>(&hostStorage);
  ADOBESDK_ControlSurfaceRef surface = nullptr;
  Require(pluginSuite->Connect(plugin, host, &surface) == kSPNoError && surface, "Connect a configured surface.");
  Require(enumerationCount == 1, "Enumerate once per Connect.");
  Require(capturedLog.find("\"complete\":true") != std::string::npos, "A successful report must have a complete summary.");
  Require(capturedLog.find("mock-only-command") != std::string::npos, "Preserve the returned command ID.");
  Require(capturedLog.find("Mock \\\"quoted\\\"\\u000acommand") != std::string::npos, "Escape host command names in the report.");
  RequireReleasedHostResources();
  surfaceSuite->Update(surface);
  pluginSuite->Suspend(plugin);
  pluginSuite->Resume(plugin);
  Require(enumerationCount == 1, "Idle and focus changes must not enumerate or mutate the host.");

  ADOBESDK_ControlSurfaceTransportRef transport = reinterpret_cast<ADOBESDK_ControlSurfaceTransportRef>(plugin);
  ADOBESDK_ControlSurfaceMixerRef mixer = reinterpret_cast<ADOBESDK_ControlSurfaceMixerRef>(plugin);
  ADOBESDK_ControlSurfaceMarkerRef marker = reinterpret_cast<ADOBESDK_ControlSurfaceMarkerRef>(plugin);
  ADOBESDK_ControlSurfaceCommandRef command = reinterpret_cast<ADOBESDK_ControlSurfaceCommandRef>(plugin);
  ADOBESDK_ControlSurfaceLumetriRef lumetri = reinterpret_cast<ADOBESDK_ControlSurfaceLumetriRef>(plugin);
  Require(surfaceSuite->GetTransportRef(surface, &transport) == kSPNoError && !transport &&
      surfaceSuite->GetMixerRef(surface, &mixer) == kSPNoError && !mixer &&
      surfaceSuite->GetMarkerRef(surface, &marker) == kSPNoError && !marker &&
      surfaceSuite->GetCommandRef(surface, &command) == kSPNoError && !command &&
      surfaceSuite->GetLumetriRef(surface, &lumetri) == kSPNoError && !lumetri,
      "Optional surface refs use the SDK default: success with a null handle.");
  Require(surfaceSuite->GetCommandRef(surface, nullptr) == kSPBadParameterError &&
      surfaceSuite->Update(nullptr) == kSPBadParameterError,
      "Reject missing callback outputs/instances without dereferencing them.");

  const int refsBeforeNull = commandRefCount, enumerationsBeforeNull = enumerationCount;
  nullCommandRef = true;
  pluginSuite->Connect(plugin, host, &surface);
  Require(commandRefCount == refsBeforeNull + 1 && enumerationCount == enumerationsBeforeNull,
      "Success with a null command handle must not start enumeration.");
  Require(capturedLog.find("\"type\":\"command_ref\",\"error\":0,\"present\":false") != std::string::npos &&
      capturedLog.find("\"reason\":\"null_command_ref\"") != std::string::npos &&
      capturedLog.find("\"first_update_retry_pending\":true") != std::string::npos,
      "Distinguish an absent capability from a host-returned error without inventing Parm.");
  const auto connectLog = capturedLog;
  pluginSuite->Suspend(plugin);
  pluginSuite->Resume(plugin);
  Require(commandRefCount == refsBeforeNull + 1 && capturedLog == connectLog,
      "Focus callbacks must not consume the one deferred probe.");
  nullCommandRef = false;
  reentrantSurface = surface;
  reenterOnCommandRef = true;
  surfaceSuite->Update(surface);
  Require(commandRefCount == refsBeforeNull + 2 && enumerationCount == enumerationsBeforeNull + 1,
      "The first update gets one new handle and cannot recursively enumerate.");
  Require(capturedLog.find("\"trigger\":\"control_surface_first_update\",\"attempt\":2") != std::string::npos &&
      capturedLog.find("\"type\":\"previous_attempt\"") != std::string::npos &&
      capturedLog.find("\"stage\":\"get_command_ref\",\"error\":0,\"command_ref_present\":false") != std::string::npos &&
      capturedLog.find("\"complete\":true") != std::string::npos,
      "A successful deferred probe retains the raw connection observation.");
  const auto deferredLog = capturedLog;
  for (int update = 0; update < 10; ++update) surfaceSuite->Update(surface);
  Require(commandRefCount == refsBeforeNull + 2 && capturedLog == deferredLog,
      "Later idle callbacks must not repeat or overwrite the bounded probe.");
  RequireReleasedHostResources();

  const int enumerationsBeforeError = enumerationCount;
  commandRefError = kSPBadParameterError;
  pluginSuite->Connect(plugin, host, &surface);
  Require(capturedLog.find("\"error\":" + std::to_string(kSPBadParameterError) + ",\"present\":true") != std::string::npos,
      "Preserve even a host error accompanied by a non-null handle; never use that handle.");
  nullCommandRef = true;
  surfaceSuite->Update(surface);
  Require(capturedLog.find("\"stage\":\"get_command_ref\",\"error\":" +
      std::to_string(kSPBadParameterError) + ",\"command_ref_present\":true") != std::string::npos &&
      capturedLog.find("\"reason\":\"host_error\",\"first_update_retry_pending\":false") != std::string::npos &&
      enumerationCount == enumerationsBeforeError,
      "A second host error remains unavailable with the raw first error retained and no further retry.");
  const int refsAfterError = commandRefCount;
  surfaceSuite->Update(surface);
  Require(commandRefCount == refsAfterError, "A failed deferred probe is consumed too.");
  RequireReleasedHostResources();

  commandRefError = kSPNoError;
  pluginSuite->Connect(plugin, host, &surface);
  const int refsBeforeDisconnect = commandRefCount;
  pluginSuite->Disconnect(plugin);
  surfaceSuite->Update(surface);
  Require(commandRefCount == refsBeforeDisconnect,
      "Disconnect clears the retained host reference and cancels a pending first update.");
  nullCommandRef = false;
  pluginSuite->Connect(plugin, host, &surface);
  Require(enumerationCount == enumerationsBeforeError + 1,
      "A new connection has a fresh bounded lifecycle after disconnection.");
  RequireReleasedHostResources();

  commandFailure = true;
  pluginSuite->Connect(plugin, host, &surface);
  Require(capturedLog.find("\"complete\":false") != std::string::npos &&
      capturedLog.find("\"failed_commands\":1") != std::string::npos, "Mark individual host failures as incomplete.");
  RequireReleasedHostResources();
  commandFailure = false;
  stringTooLong = true;
  pluginSuite->Connect(plugin, host, &surface);
  Require(capturedLog.find("\"command_name\":null") != std::string::npos &&
      capturedLog.find("\"failed_strings\":2") != std::string::npos, "Never truncate an identifier/name into apparently valid data.");
  RequireReleasedHostResources();
  stringTooLong = false;
  countFailure = true;
  pluginSuite->Connect(plugin, host, &surface);
  Require(capturedLog.find("\"stage\":\"get_command_count\"") != std::string::npos, "Record command-count failures.");
  RequireReleasedHostResources();
  countFailure = false;
  failAcquire = kADOBESDK_ControlSurfaceHostCommandSuite;
  pluginSuite->Connect(plugin, host, &surface);
  Require(capturedLog.find("\"stage\":\"acquire_command_suite\"") != std::string::npos, "Record an unavailable command suite.");
  RequireReleasedHostResources();
  failAcquire.clear();

  pluginSuite->Disconnect(plugin);
  Require(callbacks.DeletePluginInstance(plugin) == kSPNoError, "Destroy an instance without retained host handles.");
  Require(callbacks.Shutdown() == kSPNoError && listCount == 0, "Free the registered suite list.");
  for (const auto& balance : suiteBalances) Require(balance.second == 0, "Balance all suite acquisitions at shutdown.");

  failAcquire = kSPSuitesSuite;
  Require(callbacks.Startup() != kSPNoError, "Propagate a required startup suite failure.");
  for (const auto& balance : suiteBalances) Require(balance.second == 0, "Release prior acquisitions when startup fails.");
  Require(executeCount == 0 && fakeStrings.empty(), "All test runs remained read-only with no leaked SDK strings.");
  std::cout << "Synthetic control-surface lifecycle and read-only enumeration passed.\n";
}
