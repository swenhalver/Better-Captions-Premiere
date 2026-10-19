#pragma once

#include <string_view>

namespace bc::command_probe {

// Overwrites this probe's one bounded log under the current user's LocalAppData.
// Returns a Win32 error code; does not display UI or throw across an SDK callback.
unsigned long WritePrivateLog(std::string_view contents) noexcept;

}  // namespace bc::command_probe
