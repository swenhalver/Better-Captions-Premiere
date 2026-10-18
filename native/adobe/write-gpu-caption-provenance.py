#!/usr/bin/env python3
"""Record private build inputs and artifact hashes; never certify host acceptance.

Existing builds can be recorded without rebuilding. Version probes describe the
current tools, not historical tools, unless invoked immediately by the builder.
Only explicit source/SDK paths, hashes, version constants and tool versions are
recorded; no source contents, environment dumps or credentials are included.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

OVERLAYS = (
    "gpu_caption_renderer.hpp", "caption_composite.metal",
    "gpu_caption_test.mm", "gpu_float_eligibility.hpp",
)
UNITS = (
    "native/adobe/BetterCaptionsEffect.cpp",
    "native/adobe/gpu_caption_renderer.mm",
    "native/core/caption_core.cpp",
    "native/macos/caption_rasterizer.mm",
)
TESTS = (
    "native/adobe/adapter_smoke_test.cpp", "native/adobe/arbitrary_test.cpp",
    "native/adobe/render_style_test.cpp", "native/adobe/source_time_test.cpp",
    "native/adobe/gpu_caption_test.mm",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def record(path: Path) -> dict:
    if not path.is_file():
        raise ValueError(f"Required provenance input missing: {path}")
    return {"sha256": sha256(path), "bytes": path.stat().st_size}


def tree_hashes(root: Path, suffixes: tuple[str, ...]) -> dict:
    if not root.is_dir():
        raise ValueError(f"Required SDK/source directory missing: {root}")
    return {str(p.relative_to(root)): record(p)
            for p in sorted(root.rglob("*"))
            if p.is_file() and p.suffix.lower() in suffixes}


def command_version(command: list[str]) -> dict:
    # No shell, downloads, installation, project build, environment or credential probes.
    try:
        result = subprocess.run(command, capture_output=True, text=True,
                                timeout=20, check=False)
        return {"command": command, "exit_code": result.returncode,
                "output": (result.stdout + result.stderr).strip()[:12000]}
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"command": command, "unavailable": type(error).__name__}


def constants(path: Path, names: tuple[str, ...]) -> dict:
    if not path.is_file():
        return {}
    text = path.read_text(errors="replace")
    result = {}
    for name in names:
        match = re.search(r"^\s*#define\s+" + re.escape(name)
                          + r"\s+([A-Za-z0-9_]+)", text, re.MULTILINE)
        if match:
            result[name] = match.group(1)
    return result


def write_manifest(args: argparse.Namespace) -> Path:
    snapshot = args.snapshot.resolve(strict=True)
    output = args.output.resolve(strict=True)
    ae = args.ae_sdk_examples.resolve(strict=True)
    premiere = args.premiere_sdk_headers.resolve(strict=True)
    if not re.fullmatch(r"[0-9a-fA-F]{40}", args.archived_commit):
        raise ValueError("Archived commit must be the exact 40-character commit SHA")
    bundle = output / "BetterCaptionsNativeProbe.plugin"
    contents = bundle / "Contents"
    inputs = list(UNITS) + ["native/adobe/BetterCaptionsPiPL.r",
                           "native/adobe/caption_composite.metal"]
    artifact_paths = {
        "executable": contents / "MacOS/BetterCaptionsNativeProbe",
        "resource": contents / "Resources/BetterCaptionsNativeProbe.rsrc",
        "metallib": contents / "Resources/CaptionComposite.metallib",
        "info_plist": contents / "Info.plist",
        "signed_resource_manifest": contents / "_CodeSignature/CodeResources",
    }
    manifest = {
        "manifest_schema": 1,
        "recorded_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "purpose": "Build provenance only; not host acceptance or a release certificate",
        "host_acceptance": {"asserted_by_this_manifest": False},
        "source": {
            "composition": "Archived Git commit plus explicit working-file overlays and generated build patches",
            "archived_commit": args.archived_commit.lower(),
            "snapshot_path": str(snapshot),
            "overlay_hash_origin": "Actual overlaid files in this snapshot, not current repository copies",
            "explicit_overlays": {
                f"native/adobe/{name}": record(snapshot / "native/adobe" / name)
                for name in OVERLAYS
            },
            "effective_compilation_inputs": {name: record(snapshot / name) for name in inputs},
            "native_header_snapshot": tree_hashes(snapshot / "native", (".h", ".hpp")),
            "test_translation_units": {name: record(snapshot / name) for name in TESTS},
            "effective_patched_build_script": record(snapshot / "native/adobe/build-macos.sh"),
            "build_patches": [
                "Add generated Objective-C++ companion translation unit and Foundation/Metal frameworks",
                "Add explicit float format eligibility setup and defensive CPU guard",
                "Set matching PiPL float-color-aware flag",
            ],
        },
        "sdks": {
            "after_effects": {
                "examples_path": str(ae),
                "distribution_directory_label": ae.parent.name,
                "headers": tree_hashes(ae / "Headers", (".h", ".hpp")),
                "utility_headers": tree_hashes(ae / "Util", (".h", ".hpp")),
                "resource_declarations": tree_hashes(ae / "Resources", (".r", ".h")),
                "api_constants": constants(ae / "Headers/AE_EffectVers.h", (
                    "PF_PLUG_IN_VERSION", "PF_PLUG_IN_SUBVERS", "AEFX_API_VERSION")),
            },
            "premiere": {
                "headers_path": str(premiere),
                "distribution_directory_label": premiere.parents[1].name,
                "headers": tree_hashes(premiere, (".h", ".hpp")),
                "api_constants": {
                    **constants(premiere / "PrSDKGPUFilter.h", (
                        "PrSDKGPUFilterInterfaceVersion", "PrSDKGPUFilterInterfaceVersion2")),
                    **constants(premiere / "PrSDKGPUDeviceSuite.h", ("kPrSDKGPUDeviceSuiteVersion",)),
                    **constants(premiere / "PrSDKTimeSuite.h", ("kPrSDKTimeSuiteVersion",)),
                },
            },
        },
        "tools": {
            "observation_timing": "Immediately after build" if args.at_build else
                "Retrospective observation of current tools; historical build tool identity not independently proven",
            "clang": command_version(["xcrun", "clang++", "--version"]),
            "metal": command_version(["xcrun", "metal", "--version"]),
        },
        "artifacts": {name: {"path": str(path), **record(path)}
                      for name, path in artifact_paths.items()},
    }
    # Hashes observed retrospectively cannot establish that inputs were unchanged
    # after compilation. The immediate builder invocation supplies stronger linkage.
    manifest["evidence_scope"] = (
        "Inputs and outputs hashed by builder after successful build/tests; tool and SDK observation is contemporaneous"
        if args.at_build else
        "Retrospective hashes of existing snapshot/artifacts/current SDKs; not independent proof these inputs were unchanged since compilation"
    )
    destination = args.manifest or output / "gpu-caption-provenance.json"
    destination = destination.resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=destination.parent,
                                     prefix=".gpu-provenance-", delete=False) as stream:
        temporary = Path(stream.name)
        try:
            json.dump(manifest, stream, indent=2, sort_keys=True)
            stream.write("\n")
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    os.replace(temporary, destination)
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--archived-commit", required=True)
    parser.add_argument("--ae-sdk-examples", type=Path, required=True)
    parser.add_argument("--premiere-sdk-headers", type=Path, required=True)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--at-build", action="store_true",
                        help="Use only from the builder immediately after build/tests")
    print(write_manifest(parser.parse_args()))


if __name__ == "__main__":
    main()
