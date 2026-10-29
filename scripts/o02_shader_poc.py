#!/usr/bin/env python3
"""Reproducible, local-only MPV/libplacebo shader measurement for O02.

Requires Python 3, Pillow and NumPy. Uses only the pinned MPV archive and the
RAVU Lite plugin already stored in this repository; it never downloads or
installs a runtime. The output directory is caller-owned and must be new.
"""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import math
import os
import platform
import re
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path, PurePosixPath
from statistics import mean, median
from typing import Any

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_PIN = ROOT / "scripts" / "playback-runtime.json"
DEFAULT_ARCHIVE = ROOT / ".tmp" / "tools" / "mpv-0.41.0" / "mpv-v0.41.0-x86_64-pc-windows-msvc.zip"
DEFAULT_PLUGIN = ROOT / "resources" / "plugins" / "ravu-lite.winbox"
INPUT_SIZE = (640, 360)
OUTPUT_SIZE = (1280, 720)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def image_difference(reference: Image.Image, candidate: Image.Image) -> dict[str, float | bool | list[int]]:
    """Return RGB MAE/PSNR and dimensions; exact equality is represented as null PSNR."""
    ref = np.asarray(reference.convert("RGB"), dtype=np.float64)
    got = np.asarray(candidate.convert("RGB"), dtype=np.float64)
    if ref.shape != got.shape:
        raise ValueError(f"image dimensions differ: {ref.shape[1]}x{ref.shape[0]} vs {got.shape[1]}x{got.shape[0]}")
    delta = ref - got
    mse = float(np.mean(delta * delta))
    return {
        "width": int(ref.shape[1]),
        "height": int(ref.shape[0]),
        "exactMatch": mse == 0,
        "maeRgb": float(np.mean(np.abs(delta))),
        "mseRgb": mse,
        "psnrDb": None if mse == 0 else float(10.0 * math.log10((255.0 * 255.0) / mse)),
    }


def make_fixture(out_dir: Path) -> tuple[Path, Path]:
    """Create an original geometric 720p reference and a 2x box-downscaled source."""
    width, height = OUTPUT_SIZE
    pixels = np.zeros((height, width, 3), dtype=np.uint8)
    for y in range(height):
        for channel, offset in enumerate((12, 28, 52)):
            pixels[y, :, channel] = np.linspace(offset, min(255, offset + 110 + y // 12), width, dtype=np.uint8)
    reference = Image.fromarray(pixels, "RGB")
    draw = ImageDraw.Draw(reference)
    draw.rectangle((48, 48, 1230, 670), outline=(242, 242, 242), width=5)
    draw.ellipse((96, 110, 360, 374), outline=(255, 180, 35), width=7)
    draw.ellipse((138, 152, 318, 332), outline=(70, 220, 235), width=4)
    draw.polygon([(420, 90), (720, 640), (1010, 90)], outline=(240, 85, 120), width=4)
    draw.rectangle((810, 128, 1168, 476), outline=(70, 240, 145), width=4)
    for x in range(830, 1160, 12):
        draw.line((x, 150, x, 455), fill=(215, 225, 245), width=1)
    for y in range(165, 455, 12):
        draw.line((825, y, 1155, y), fill=(215, 225, 245), width=1)
    for x in range(430, 795, 7):
        draw.line((x, 522, x + 125, 666), fill=(240, 240, 240), width=1)
    draw.rectangle((78, 510, 356, 638), outline=(255, 240, 85), width=2)
    for x in range(84, 350, 4):
        for y in range(516, 632, 4):
            if ((x // 4) + (y // 4)) % 2:
                draw.rectangle((x, y, x + 1, y + 1), fill=(255, 255, 255))

    ref_path = out_dir / "reference-1280x720.png"
    source_path = out_dir / "source-640x360.png"
    reference.save(ref_path, optimize=False)
    reference.resize(INPUT_SIZE, Image.Resampling.BOX).save(source_path, optimize=False)
    return ref_path, source_path


def _safe_extract(zf: zipfile.ZipFile, destination: Path) -> None:
    for entry in zf.infolist():
        path = PurePosixPath(entry.filename)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError(f"unsafe archive entry: {entry.filename}")
    zf.extractall(destination)


def extract_pinned_runtime(archive: Path, destination: Path) -> tuple[Path, dict[str, Any]]:
    pin = json.loads(RUNTIME_PIN.read_text(encoding="utf-8"))
    actual_hash = sha256(archive)
    if actual_hash.lower() != str(pin["sha256"]).lower():
        raise ValueError(f"pinned MPV SHA-256 mismatch: expected {pin['sha256']}, got {actual_hash}")
    destination.mkdir(parents=True, exist_ok=False)
    with zipfile.ZipFile(archive) as zf:
        _safe_extract(zf, destination)
    exe = destination / "mpv.exe"
    if not exe.is_file():
        raise FileNotFoundError("pinned archive did not contain mpv.exe at its root")
    return exe, {"version": pin["version"], "source": pin["source"], "archive": str(archive), "sha256": actual_hash}


def extract_ravu_plugin(plugin: Path, destination: Path) -> tuple[Path, dict[str, Any]]:
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(plugin) as zf:
        _safe_extract(zf, destination)
    manifest = json.loads((destination / "plugin.json").read_text(encoding="utf-8"))
    hook_path = destination / "files" / "ravu-lite-r4.hook"
    if manifest.get("id") != "ravu-lite" or not hook_path.is_file():
        raise ValueError("expected the repository's ravu-lite plugin and hook")
    return hook_path, {"id": manifest["id"], "version": manifest["version"], "license": manifest["license"], "hookSha256": sha256(hook_path)}


def _lua_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def write_capture_lua(path: Path, screenshot: Path, metadata: Path) -> None:
    script = f"""local mp = require 'mp'
local utils = require 'mp.utils'
local screenshot_path = {_lua_string(str(screenshot))}
local metadata_path = {_lua_string(str(metadata))}

local function save_metadata()
    local result = {{}}
    for _, name in ipairs({{'current-vo', 'vo-passes', 'video-params', 'video-out-params', 'estimated-vf-fps', 'frame-drop-count', 'vo-drop-frame-count'}}) do
        local ok, value = pcall(mp.get_property_native, name)
        if ok then result[name] = value else result[name] = tostring(value) end
    end
    local file = io.open(metadata_path, 'w')
    if file then file:write(utils.format_json(result) or '{{}}'); file:close() end
end

mp.register_event('file-loaded', function()
    mp.add_timeout(1.25, function()
        mp.commandv('screenshot-to-file', screenshot_path, 'window')
        mp.add_timeout(0.35, function() save_metadata(); mp.commandv('quit') end)
    end)
end)
"""
    path.write_text(script, encoding="utf-8")


def write_benchmark_lua(path: Path, metadata: Path) -> None:
    script = f"""local mp = require 'mp'
local utils = require 'mp.utils'
local metadata_path = {_lua_string(str(metadata))}
local function save_metadata()
    local result = {{}}
    for _, name in ipairs({{'current-vo', 'vo-passes', 'video-out-params', 'video-frame-number', 'frame-drop-count', 'vo-drop-frame-count'}}) do
        local ok, value = pcall(mp.get_property_native, name)
        if ok then result[name] = value else result[name] = tostring(value) end
    end
    local file = io.open(metadata_path, 'w')
    if file then file:write(utils.format_json(result) or '{{}}'); file:close() end
end
mp.register_event('file-loaded', function() mp.add_timeout(0.7, save_metadata) end)
"""
    path.write_text(script, encoding="utf-8")


def active_shader_passes(render_info: dict[str, Any]) -> list[str]:
    descriptions = []
    passes = render_info.get("vo-passes") or {}
    if isinstance(passes, dict):
        for group in passes.values():
            if isinstance(group, list):
                descriptions.extend(item.get("desc", "") for item in group if isinstance(item, dict))
    return [desc for desc in descriptions if isinstance(desc, str) and desc.startswith("RAVU-Lite")]


def _gpu_sampler_script(path: Path) -> None:
    script = r"""
param([int]$TargetPid, [string]$OutputPath)
$ErrorActionPreference = 'SilentlyContinue'
while (Get-Process -Id $TargetPid -ErrorAction SilentlyContinue) {
    $memory = @()
    try {
        $memoryPaths = (Get-Counter -ListSet 'GPU Process Memory').PathsWithInstances | Where-Object { $_ -match "pid_${TargetPid}_" -and $_ -match 'Dedicated Usage' }
        if ($memoryPaths.Count) {
            $sample = Get-Counter -Counter $memoryPaths -MaxSamples 1
            $memory = @($sample.CounterSamples | ForEach-Object { [double]$_.CookedValue })
        }
    } catch {}
    $row = [pscustomobject]@{
        utc = [DateTime]::UtcNow.ToString('o')
        dedicatedGpuBytes = if ($memory.Count) { ($memory | Measure-Object -Sum).Sum } else { $null }
    }
    $row | ConvertTo-Json -Compress | Add-Content -LiteralPath $OutputPath -Encoding UTF8
    Start-Sleep -Milliseconds 100
}
"""
    path.write_text(script, encoding="utf-8")


class _WindowsProcessSampler:
    """Sample MPV CPU time and memory with Win32 APIs, independent of the Python process."""

    class _FileTime(ctypes.Structure):
        _fields_ = [("low", ctypes.c_ulong), ("high", ctypes.c_ulong)]

    class _MemoryCounters(ctypes.Structure):
        _fields_ = [
            ("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong),
            ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
            ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
            ("PrivateUsage", ctypes.c_size_t),
        ]

    def __init__(self, pid: int) -> None:
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.psapi = ctypes.WinDLL("psapi", use_last_error=True)
        self.handle = self.kernel.OpenProcess(0x0410, False, pid)  # QUERY_INFORMATION | VM_READ
        if not self.handle:
            raise OSError(ctypes.get_last_error(), "OpenProcess failed for MPV child")
        self.peak_working = 0
        self.peak_private = 0
        self.cpu_ms = 0.0

    @staticmethod
    def _ticks(value: "_WindowsProcessSampler._FileTime") -> int:
        return (value.high << 32) | value.low

    def sample(self) -> None:
        creation, exit_time, kernel, user = self._FileTime(), self._FileTime(), self._FileTime(), self._FileTime()
        if self.kernel.GetProcessTimes(self.handle, ctypes.byref(creation), ctypes.byref(exit_time), ctypes.byref(kernel), ctypes.byref(user)):
            self.cpu_ms = (self._ticks(kernel) + self._ticks(user)) / 10_000.0
        counters = self._MemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        if self.psapi.GetProcessMemoryInfo(self.handle, ctypes.byref(counters), counters.cb):
            self.peak_working = max(self.peak_working, int(counters.PeakWorkingSetSize))
            self.peak_private = max(self.peak_private, int(counters.PrivateUsage))

    def close(self) -> None:
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


def run_process(command: list[str], log_path: Path, gpu_sampler_path: Path | None = None) -> dict[str, Any]:
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    start = time.perf_counter()
    with log_path.open("wb") as log:
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, creationflags=creationflags)
        sampler: _WindowsProcessSampler | None = None
        gpu_sampler: subprocess.Popen[bytes] | None = None
        gpu_output = log_path.with_suffix(".gpu.jsonl")
        try:
            if os.name == "nt":
                sampler = _WindowsProcessSampler(process.pid)
                if gpu_sampler_path:
                    powershell = shutil.which("powershell.exe") or r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
                    gpu_sampler = subprocess.Popen(
                        [powershell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(gpu_sampler_path), "-TargetPid", str(process.pid), "-OutputPath", str(gpu_output)],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=creationflags,
                    )
            while process.poll() is None:
                if sampler:
                    sampler.sample()
                time.sleep(0.05)
            return_code = process.wait()
            if sampler:
                sampler.sample()
            elapsed_ms = (time.perf_counter() - start) * 1000.0
        finally:
            if sampler:
                sampler.close()
            if gpu_sampler and gpu_sampler.poll() is None:
                try:
                    gpu_sampler.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    gpu_sampler.terminate()
                    gpu_sampler.wait(timeout=2)
    if return_code != 0:
        tail = log_path.read_text(encoding="utf-8", errors="replace")[-5000:]
        raise RuntimeError(f"MPV exited with {return_code}; see {log_path}\n{tail}")

    gpu_samples: list[dict[str, Any]] = []
    if gpu_output.exists():
        for line in gpu_output.read_text(encoding="utf-8-sig", errors="replace").splitlines():
            try:
                gpu_samples.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    memory_values = [row["dedicatedGpuBytes"] for row in gpu_samples if isinstance(row.get("dedicatedGpuBytes"), (int, float))]
    return {
        "exitCode": return_code,
        "elapsedMs": elapsed_ms,
        "cpuMs": sampler.cpu_ms if sampler else None,
        "peakWorkingSetMiB": sampler.peak_working / (1024 * 1024) if sampler else None,
        "peakPrivateBytesMiB": sampler.peak_private / (1024 * 1024) if sampler else None,
        "gpuDedicatedMemorySamples": len(memory_values),
        "dedicatedGpuPeakMiB": max(memory_values) / (1024 * 1024) if memory_values else None,
        "gpuCountersAvailable": bool(gpu_samples),
    }


def _mpv_base(exe: Path, work: Path, log: Path) -> list[str]:
    return [
        str(exe), "--no-config", f"--config-dir={work / 'isolated-config'}",
        "--vo=gpu-next", "--gpu-api=d3d11", f"--gpu-shader-cache-dir={work / 'shader-cache'}",
        "--gpu-shader-cache=yes", "--vf=format=yuv420p", "--scale=spline36", "--cscale=spline36", "--dscale=mitchell",
        "--target-prim=bt.709", "--target-trc=srgb", "--target-colorspace-hint=no",
        "--autofit=1280x720", "--no-border", "--osc=no", "--osd-level=0", "--audio=no",
        f"--log-file={log}",
    ]


def capture_image(exe: Path, shader: Path | None, source: Path, work: Path, gpu_script: Path) -> tuple[Path, dict[str, Any], str]:
    name = "ravu" if shader else "baseline"
    screenshot = work / f"{name}-render.png"
    metadata = work / f"{name}-render.json"
    lua = work / f"{name}-capture.lua"
    log = work / f"{name}-capture.log"
    write_capture_lua(lua, screenshot, metadata)
    command = _mpv_base(exe, work, log) + [
        "--force-window=immediate", "--keep-open=always", "--image-display-duration=10",
        f"--script={lua}", f"--msg-level=vo/gpu-next=info,vo/gpu-next/libplacebo=debug",
    ]
    if shader:
        command.append(f"--glsl-shader={shader}")
    command.append(str(source))
    result = run_process(command, log, gpu_script)
    if not screenshot.is_file():
        raise RuntimeError(f"MPV did not write window screenshot {screenshot}; see {log}")
    if metadata.is_file():
        render_info = json.loads(metadata.read_text(encoding="utf-8"))
    else:
        render_info = {}
    text = log.read_text(encoding="utf-8", errors="replace")
    if shader:
        if "Registering hook pass: RAVU-Lite (step1, r4)" not in text or "Registering hook pass: RAVU-Lite (step2, r4)" not in text:
            raise RuntimeError(f"RAVU passes were not registered; see {log}")
        if not re.search(r"shaderc compile status 'success' \(0 errors", text):
            raise RuntimeError(f"RAVU shader compilation did not report zero errors; see {log}")
    if shader:
        active = active_shader_passes(render_info)
        expected = {"RAVU-Lite (step1, r4)", "RAVU-Lite (step2, r4)"}
        if not expected.issubset(active):
            raise RuntimeError(f"RAVU hooks compiled but were absent from live vo-passes: {active}; see {metadata}")
    return screenshot, result, text


def benchmark(exe: Path, shader: Path | None, work: Path, gpu_script: Path, frames: int, repetitions: int) -> list[dict[str, Any]]:
    mode = "ravu" if shader else "baseline"
    results = []
    for repetition in range(1, repetitions + 1):
        log = work / f"{mode}-perf-{repetition}.log"
        metadata = work / f"{mode}-perf-{repetition}.json"
        lua = work / f"{mode}-perf-{repetition}.lua"
        write_benchmark_lua(lua, metadata)
        source = f"av://lavfi:testsrc2=size=640x360:rate=30:duration={frames / 30 + 1:.3f}"
        command = _mpv_base(exe, work, log) + ["--untimed", "--framedrop=no", f"--frames={frames}", f"--script={lua}"]
        if shader:
            command.append(f"--glsl-shader={shader}")
        command.append(source)
        result = run_process(command, log, gpu_script)
        text = log.read_text(encoding="utf-8", errors="replace")
        if not metadata.is_file():
            raise RuntimeError(f"MPV did not produce benchmark pass metadata: {metadata}")
        render_info = json.loads(metadata.read_text(encoding="utf-8"))
        result["activeShaderPasses"] = active_shader_passes(render_info)
        result["videoOutParams"] = render_info.get("video-out-params")
        if shader and ("Registering hook pass: RAVU-Lite (step1, r4)" not in text or "Registering hook pass: RAVU-Lite (step2, r4)" not in text):
            raise RuntimeError(f"RAVU passes not registered in perf trial {repetition}; see {log}")
        if shader and not {"RAVU-Lite (step1, r4)", "RAVU-Lite (step2, r4)"}.issubset(result["activeShaderPasses"]):
            raise RuntimeError(f"RAVU hooks absent from perf vo-passes trial {repetition}: {result['activeShaderPasses']}; see {metadata}")
        output_params = result["videoOutParams"] or {}
        if output_params.get("pixelformat") != "yuv420p":
            raise RuntimeError(f"expected forced yuv420p video output, got {output_params.get('pixelformat')!r}; see {metadata}")
        result.update({
            "mode": mode,
            "repetition": repetition,
            "framesRequested": frames,
            "wallMsPerRequestedFrame": result["elapsedMs"] / frames,
            "cpuMsPerRequestedFrame": result["cpuMs"] / frames if result["cpuMs"] is not None else None,
        })
        results.append(result)
    return results


def summarize_trials(trials: list[dict[str, Any]]) -> dict[str, Any]:
    wall = [trial["wallMsPerRequestedFrame"] for trial in trials]
    cpu = [trial["cpuMsPerRequestedFrame"] for trial in trials if trial["cpuMsPerRequestedFrame"] is not None]
    return {
        "repetitions": len(trials),
        "wallMsPerRequestedFrame": wall,
        "medianWallMsPerRequestedFrame": median(wall),
        "cpuMsPerRequestedFrame": cpu,
        "medianCpuMsPerRequestedFrame": median(cpu) if cpu else None,
        "peakWorkingSetMiB": max((trial["peakWorkingSetMiB"] for trial in trials if trial["peakWorkingSetMiB"] is not None), default=None),
        "gpuDedicatedMemorySamples": [trial["gpuDedicatedMemorySamples"] for trial in trials],
        "dedicatedGpuPeakMiB": [trial["dedicatedGpuPeakMiB"] for trial in trials],
    }


def run(args: argparse.Namespace) -> dict[str, Any]:
    if os.name != "nt":
        raise RuntimeError("the renderer experiment requires Windows D3D11")
    archive = args.mpv_archive.resolve()
    plugin = args.plugin.resolve()
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=False)
    runtime_pin = json.loads(RUNTIME_PIN.read_text(encoding="utf-8"))
    actual_hash = sha256(archive)
    if actual_hash.lower() != str(runtime_pin["sha256"]).lower():
        raise ValueError(f"pinned MPV SHA-256 mismatch: expected {runtime_pin['sha256']}, got {actual_hash}")
    runtime_dir = output / "mpv-runtime"
    if args.mpv_exe:
        exe = args.mpv_exe.resolve()
        if not exe.is_file():
            raise FileNotFoundError(exe)
    else:
        exe, _ = extract_pinned_runtime(archive, runtime_dir)
    shader, plugin_info = extract_ravu_plugin(plugin, output / "ravu-plugin")
    gpu_script = output / "sample-gpu.ps1"
    _gpu_sampler_script(gpu_script)
    reference_path, source_path = make_fixture(output)
    reference = Image.open(reference_path)
    baseline_path, baseline_proc, baseline_log = capture_image(exe, None, source_path, output, gpu_script)
    ravu_path, ravu_proc, ravu_log = capture_image(exe, shader, source_path, output, gpu_script)
    baseline_image = Image.open(baseline_path)
    ravu_image = Image.open(ravu_path)
    if baseline_image.size != OUTPUT_SIZE or ravu_image.size != OUTPUT_SIZE:
        raise ValueError(f"window screenshot dimensions unexpected: baseline={baseline_image.size}, RAVU={ravu_image.size}, expected={OUTPUT_SIZE}")
    if image_difference(baseline_image, ravu_image)["exactMatch"]:
        raise RuntimeError("RAVU screenshot is pixel-identical to baseline; refusing to report a no-op shader run")

    # Warm the isolated shader cache for both pipelines, then measure repeated untimed batches.
    warmup_frames = min(300, args.frames)
    for shader_option, mode in ((None, "baseline"), (shader, "ravu")):
        warm_log = output / f"{mode}-warmup.log"
        warm_source = f"av://lavfi:testsrc2=size=640x360:rate=30:duration={warmup_frames / 30 + 1:.3f}"
        warm_command = _mpv_base(exe, output, warm_log) + ["--untimed", "--framedrop=no", f"--frames={warmup_frames}"]
        if shader_option:
            warm_command.append(f"--glsl-shader={shader_option}")
        warm_command.append(warm_source)
        run_process(warm_command, warm_log)

    baseline_trials = benchmark(exe, None, output, gpu_script, args.frames, args.repetitions)
    ravu_trials = benchmark(exe, shader, output, gpu_script, args.frames, args.repetitions)
    return {
        "runtime": {
            "pinnedVersion": runtime_pin["version"],
            "reportedVersion": subprocess.check_output([str(exe), "--no-config", "--version"], text=True, errors="replace").splitlines()[:3],
            "officialSource": runtime_pin["source"],
            "archiveUrl": runtime_pin["url"],
            "archiveSha256": actual_hash,
            "libplaceboVersion": next((line.split(":", 1)[-1].strip() for line in subprocess.check_output([str(exe), "--no-config", "--version"], text=True, errors="replace").splitlines() if line.startswith("libplacebo version:")), None),
        },
        "host": {"platform": platform.platform(), "machine": platform.machine()},
        "plugin": plugin_info,
        "method": {
            "input": "original synthetic 640x360 PNG downscaled from deterministic 1280x720 geometric reference; perf source is FFmpeg lavfi testsrc2 640x360@30",
            "output": "MPV gpu-next + D3D11 at 1280x720; RAVU-Lite step1/step2 hooks; no user config; isolated shader cache",
            "framesPerPerfTrial": args.frames,
            "timing": "whole MPV process wall time and process CPU time divided by requested frame count; includes process/context setup, not isolated GPU timestamp per frame",
            "limits": ["synthetic patterns are not representative movie quality", "PSNR/MAE are image differences, not a perceptual preference score", "GPU usage is per-process dedicated allocation from Windows GPU Process Memory; this harness does not expose isolated GPU frame timestamps"],
        },
        "imageMetrics": {
            "baselineVsReference": image_difference(reference, baseline_image),
            "ravuVsReference": image_difference(reference, ravu_image),
            "ravuVsBaseline": image_difference(baseline_image, ravu_image),
            "renderInfo": {"baseline": baseline_proc, "ravu": ravu_proc},
        },
        "performance": {
            "baseline": {"trials": baseline_trials, "summary": summarize_trials(baseline_trials)},
            "ravu": {"trials": ravu_trials, "summary": summarize_trials(ravu_trials)},
        },
        "artifacts": {"reference": str(reference_path), "source": str(source_path), "baselineScreenshot": str(baseline_path), "ravuScreenshot": str(ravu_path)},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mpv-archive", type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument("--mpv-exe", type=Path, help="already extracted mpv.exe; archive hash is still verified")
    parser.add_argument("--plugin", type=Path, default=DEFAULT_PLUGIN)
    parser.add_argument("--output-dir", type=Path, required=True, help="new directory for disposable fixtures, logs and metrics")
    parser.add_argument("--frames", type=int, default=1800, help="synthetic frames per steady-throughput trial")
    parser.add_argument("--repetitions", type=int, default=3)
    parser.add_argument("--self-test", action="store_true", help="run dependency-light metric invariants without MPV")
    args = parser.parse_args()
    if args.self_test:
        a = Image.new("RGB", (8, 8), (10, 20, 30))
        b = Image.new("RGB", (8, 8), (10, 20, 30))
        if not image_difference(a, b)["exactMatch"]:
            raise AssertionError("identical-image metric failed")
        b.putpixel((0, 0), (20, 20, 30))
        changed = image_difference(a, b)
        if changed["exactMatch"] or changed["maeRgb"] <= 0 or changed["psnrDb"] is None:
            raise AssertionError("changed-image metric failed")
        print("O02 metric self-test passed")
        return 0
    if args.frames < 120 or args.repetitions < 1:
        parser.error("--frames must be >= 120 and --repetitions >= 1")
    result = run(args)
    output = args.output_dir.resolve() / "o02-shader-poc.json"
    output.write_text(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(json.dumps({
        "result": str(output),
        "runtime": result["runtime"],
        "imageMetrics": result["imageMetrics"],
        "performance": {name: group["summary"] for name, group in result["performance"].items()},
    }, indent=2, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
