#!/usr/bin/env python3
"""Install an official, checksum-verified Blender 4.5 build into a project."""

from __future__ import annotations

import argparse
import hashlib
import os
import platform
import re
import shutil
import subprocess
import tarfile
import tempfile
import zipfile
from pathlib import Path


BASE = "https://download.blender.org/release/Blender4.5/"
USER_AGENT = "Holo-Card-Studio/1.0 (official Blender installer)"


def download(url: str, target: Path) -> None:
    """Download using curl so the system's configured proxy is respected."""
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + ".part")
    partial.unlink(missing_ok=True)
    subprocess.run(
        ["curl", "--fail", "--location", "--retry", "3", "--retry-delay", "2",
         "--user-agent", USER_AGENT, "--output", str(partial), url],
        check=True,
    )
    partial.replace(target)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def blender_executable(tools: Path) -> Path | None:
    candidates = [tools / "Blender.app" / "Contents" / "MacOS" / "Blender"]
    candidates.extend(tools.glob("blender*/blender"))
    candidates.extend(tools.glob("blender*/blender.exe"))
    return next((candidate.resolve() for candidate in candidates if candidate.is_file()), None)


def safe_extract_dmg(package: Path, tools: Path) -> None:
    mount_info = subprocess.check_output(
        ["hdiutil", "attach", "-nobrowse", "-readonly", "-plist", str(package)]
    )
    import plistlib

    points = [entry["mount-point"] for entry in plistlib.loads(mount_info)["system-entities"]
              if "mount-point" in entry]
    if len(points) != 1:
        raise RuntimeError("Could not identify the mounted Blender disk")
    mount = Path(points[0])
    try:
        apps = list(mount.glob("*.app"))
        if len(apps) != 1:
            raise RuntimeError("Could not identify the Blender app bundle")
        shutil.copytree(apps[0], tools / "Blender.app", symlinks=True, dirs_exist_ok=True)
    finally:
        subprocess.run(["hdiutil", "detach", str(mount)], check=True)


def install(project: Path) -> Path:
    project = project.resolve()
    tools = project / "tools"
    tools.mkdir(parents=True, exist_ok=True)
    existing = blender_executable(tools)
    if existing:
        return existing

    system = platform.system()
    machine = platform.machine().lower()
    if system == "Darwin":
        suffix = "macos-arm64.dmg" if machine in {"arm64", "aarch64"} else "macos-x64.dmg"
    elif system == "Linux" and machine in {"x86_64", "amd64"}:
        suffix = "linux-x64.tar.xz"
    elif system == "Windows":
        suffix = "windows-arm64.zip" if "arm" in machine else "windows-x64.zip"
    else:
        raise RuntimeError(f"Unsupported platform/architecture: {system}/{machine}")

    with tempfile.TemporaryDirectory(prefix="holo-blender-") as temporary:
        temporary_path = Path(temporary)
        listing = temporary_path / "index.html"
        download(BASE, listing)
        versions = sorted(
            set(re.findall(r"blender-(4\.5\.\d+)-" + re.escape(suffix), listing.read_text())),
            key=lambda version: tuple(int(part) for part in version.split(".")),
        )
        if not versions:
            raise RuntimeError(f"No official Blender 4.5 build found for {suffix}")
        version = versions[-1]
        name = f"blender-{version}-{suffix}"
        checksum_file = temporary_path / f"blender-{version}.sha256"
        download(BASE + checksum_file.name, checksum_file)
        rows = [line.split() for line in checksum_file.read_text().splitlines()]
        matches = [row[0].lower() for row in rows if len(row) >= 2 and row[-1].lstrip("*") == name]
        if len(matches) != 1:
            raise RuntimeError(f"Official checksum entry missing or ambiguous for {name}")
        expected = matches[0]
        package = tools / name
        if package.exists() and sha256(package) != expected:
            package.unlink()
        if not package.exists():
            download(BASE + name, package)
        actual = sha256(package)
        if actual != expected:
            package.unlink(missing_ok=True)
            raise RuntimeError(f"Official SHA-256 mismatch for {name}: {actual} != {expected}")
        print(f"Verified SHA-256 {actual} for {name}")

        if name.endswith(".dmg"):
            safe_extract_dmg(package, tools)
        elif name.endswith(".zip"):
            with zipfile.ZipFile(package) as archive:
                for entry in archive.infolist():
                    destination = (tools / entry.filename).resolve()
                    if not destination.is_relative_to(tools):
                        raise RuntimeError("Unsafe ZIP archive path")
                archive.extractall(tools)
        else:
            with tarfile.open(package) as archive:
                if hasattr(tarfile, "data_filter"):
                    archive.extractall(tools, filter="data")
                else:
                    for entry in archive.getmembers():
                        destination = (tools / entry.name).resolve()
                        if entry.issym() or entry.islnk() or not destination.is_relative_to(tools):
                            raise RuntimeError("Unsafe tar archive member")
                    archive.extractall(tools)

    executable = blender_executable(tools)
    if executable is None:
        raise RuntimeError("Installation completed but Blender executable was not found")
    portable = (tools / "Blender.app" / "Contents" / "Resources" / "portable" / "config"
                if system == "Darwin" else executable.parent / "portable" / "config")
    portable.mkdir(parents=True, exist_ok=True)
    return executable


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("project", type=Path)
    args = parser.parse_args()
    executable = install(args.project)
    print(executable)
    subprocess.run([str(executable), "--version"], check=True)
