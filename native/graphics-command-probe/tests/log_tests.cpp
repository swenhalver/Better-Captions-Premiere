#include "../bounded_jsonl.hpp"

#include <cstdlib>
#include <iostream>
#include <string>

using namespace bc::command_probe;

void Require(bool condition, const char* message) {
  if (!condition) {
    std::cerr << message << '\n';
    std::exit(1);
  }
}

int main() {
  const std::string controls = std::string("quote\" slash\\ line\n\r\t") + '\0' + '\x1f';
  Require(JsonString(controls) == "\"quote\\\" slash\\\\ line\\u000a\\u000d\\u0009\\u0000\\u001f\"",
      "Host command names must not inject JSONL records, quotes, or embedded nulls.");
  Require(JsonString(u8"Gráficos — 字幕") == u8"\"Gráficos — 字幕\"", "Preserve UTF-8 command names.");

  BoundedJsonl report;
  const std::string boundary(kMaxLogBytes - kSummaryReserve - 1, 'x');
  Require(report.Append(boundary), "Accept a record exactly at the body byte boundary.");
  const auto before = report.Data().size();
  Require(!report.Append("x"), "Reject a record that would consume summary space.");
  Require(report.Data().size() == before, "Rejected records must not be partially appended.");
  Require(report.Finish("{\"type\":\"summary\",\"complete\":false}"), "A full report still needs its summary.");
  Require(report.Data().size() <= kMaxLogBytes && report.Data().back() == '\n', "Keep total bytes bounded and final record terminated.");
  Require(!report.Finish("{}"), "A report has only one final summary.");
  Require(!report.Append("{}"), "No command may follow the final summary.");

  BoundedJsonl oversized;
  Require(!oversized.Append(std::string(kMaxLogBytes, 'x')), "Reject a single oversized record without underflow.");
  Require(oversized.Data().empty(), "Oversized input must not alter the report.");
  std::cout << "Command log bounds and escaping passed.\n";
}
