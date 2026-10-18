#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
build="$(mktemp -d "${TMPDIR:-/tmp}/better-captions-core.XXXXXX")"
trap 'rm -rf "$build"' EXIT
"${CXX:-clang++}" -std=c++17 -Wall -Wextra -Werror -pedantic -fsanitize=address,undefined -fno-omit-frame-pointer "$root/native/core/caption_core.cpp" "$root/native/tests/caption_core_test.cpp" -o "$build/caption-core-test"
"$build/caption-core-test"
