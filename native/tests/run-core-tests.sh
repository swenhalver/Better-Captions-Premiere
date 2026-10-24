#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
build="$(mktemp -d "${TMPDIR:-/tmp}/better-captions-core.XXXXXX")"
trap 'rm -rf "$build"' EXIT
for test in caption_core_test line_position_test; do
 "${CXX:-clang++}" -std=c++17 -Wall -Wextra -Werror -pedantic -fsanitize=address,undefined -fno-omit-frame-pointer "$root/native/core/caption_core.cpp" "$root/native/tests/$test.cpp" -o "$build/$test"
 "$build/$test"
done
