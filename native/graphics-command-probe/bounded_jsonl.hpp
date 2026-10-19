#pragma once

#include <cstddef>
#include <string>
#include <string_view>

namespace bc::command_probe {

inline constexpr std::size_t kMaxLogBytes = 8 * 1024 * 1024;
inline constexpr std::size_t kSummaryReserve = 1024;

// Host strings are UTF-8 according to the Adobe String Suite contract. Escape
// controls as well as quotes so a command name cannot inject another log record.
inline std::string JsonString(std::string_view value) {
  constexpr char hex[] = "0123456789abcdef";
  std::string result;
  result.reserve(value.size() + 2);
  result.push_back('"');
  for (const unsigned char byte : value) {
    if (byte == '"' || byte == '\\') {
      result.push_back('\\');
      result.push_back(static_cast<char>(byte));
    } else if (byte < 0x20) {
      result += "\\u00";
      result.push_back(hex[byte >> 4]);
      result.push_back(hex[byte & 0x0f]);
    } else {
      result.push_back(static_cast<char>(byte));
    }
  }
  result.push_back('"');
  return result;
}

class BoundedJsonl {
 public:
  bool Append(std::string_view record) {
    if (finished_) return false;
    return AppendWithin(record, kMaxLogBytes - kSummaryReserve);
  }

  bool Finish(std::string_view summary) {
    if (finished_) return false;
    if (!AppendWithin(summary, kMaxLogBytes)) return false;
    finished_ = true;
    return true;
  }

  const std::string& Data() const { return data_; }

 private:
  bool AppendWithin(std::string_view record, std::size_t ceiling) {
    if (record.size() >= ceiling || data_.size() > ceiling - record.size() - 1) return false;
    data_.append(record);
    data_.push_back('\n');
    return true;
  }

  std::string data_;
  bool finished_ = false;
};

}  // namespace bc::command_probe
