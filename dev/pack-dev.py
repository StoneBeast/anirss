#!/usr/bin/env python3
"""Make a local dev build of an FPK without touching the repository version.

fnOS refuses to install an FPK whose ``version`` is not greater than the
installed one, so re-testing on a real device would otherwise force a version
bump into git.  This script rewrites only the ``version`` line of the
``manifest`` entry inside an already-built FPK, leaving ``app.tgz`` and
``manifest.checksum`` untouched (the checksum covers ``app.tgz``, not the
manifest), so the package stays valid.

Default dev version: ``X.Y.(900 + <total commits>)`` derived from the manifest
version and ``git rev-list --count HEAD``.  It is monotonic, always greater
than the current release and always lower than the next minor release, while
staying three numeric segments so fnOS definitely accepts it.

Usage:
    python dev/pack-dev.py anirss.fpk anirss-dev.fpk
    python dev/pack-dev.py anirss.fpk anirss-dev.fpk --version 1.13.2.7
    python dev/pack-dev.py anirss.fpk anirss-dev.fpk --version 1.13.900 --repo .

Then install ``anirss-dev.fpk``; ``git status`` stays clean.
"""

from __future__ import annotations

import argparse
import io
import re
import subprocess
import sys
import tarfile
from pathlib import Path

DEV_PATCH_BASE = 900
VERSION_RE = re.compile(r"^version\s*=\s*.*$", re.MULTILINE)


def read_manifest(fpk: Path) -> str:
    with tarfile.open(fpk, "r:gz") as tar:
        for member in tar.getmembers():
            if member.name == "manifest" and member.isfile():
                data = tar.extractfile(member)
                if data is None:
                    raise SystemExit("无法读取 manifest 条目")
                return data.read().decode("utf-8")
    raise SystemExit(f"{fpk} 里没有 manifest 条目，确认这是 fnOS 的 FPK 包")


def commit_count(repo: Path) -> int:
    try:
        out = subprocess.run(
            ["git", "-C", str(repo), "rev-list", "--count", "HEAD"],
            check=True, capture_output=True, text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise SystemExit(
            "取不到 git 提交数（不在 git 仓库里？）—— 请用 --version 手动指定 dev 版本号\n"
            f"原因：{exc}"
        )
    if not out.isdigit():
        raise SystemExit(f"git rev-list 输出无法解析：{out!r}")
    return int(out)


def dev_version(base: str, commits: int) -> str:
    parts = base.split(".")
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        raise SystemExit(
            f"manifest 里的版本号 {base!r} 不是 X.Y.Z，请用 --version 手动指定"
        )
    major, minor, _patch = (int(p) for p in parts)
    return f"{major}.{minor}.{DEV_PATCH_BASE + commits}"


def rewrite(fpk: Path, dest: Path, new_version: str) -> None:
    members = []
    replaced = False
    with tarfile.open(fpk, "r:gz") as tar:
        for member in tar.getmembers():
            data = tar.extractfile(member).read() if member.isfile() else None
            if member.name == "manifest" and data is not None:
                text = data.decode("utf-8")
                if not VERSION_RE.search(text):
                    raise SystemExit("manifest 里找不到 version 行")
                text = VERSION_RE.sub(f"version               = {new_version}", text, count=1)
                data = text.encode("utf-8")
                replaced = True
            # 与 repack-fpk.py 保持一致：目录 0755、cmd/ 0755、其余 0644
            if member.isdir():
                member.mode = 0o755
            elif member.name.startswith("cmd/"):
                member.mode = 0o755
            else:
                member.mode = 0o644
            member.uid = 0
            member.gid = 0
            member.uname = ""
            member.gname = ""
            members.append((member, data))

    if not replaced:
        raise SystemExit("没有改写任何 manifest，已中止")

    with tarfile.open(dest, "w:gz", format=tarfile.GNU_FORMAT, compresslevel=9) as out:
        for member, data in members:
            if data is not None:
                member.size = len(data)
                out.addfile(member, io.BytesIO(data))
            else:
                out.addfile(member)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="生成带 dev 版本号的 FPK（不改仓库里的版本号）")
    parser.add_argument("source", type=Path, help="fnpack 产出的原始 fpk")
    parser.add_argument("dest", type=Path, help="输出路径，如 anirss-dev.fpk")
    parser.add_argument("--version", help="显式指定 dev 版本号，如 1.13.2.7 或 1.13.900")
    parser.add_argument("--repo", type=Path, default=Path("."), help="用于取提交数的 git 仓库，默认当前目录")
    args = parser.parse_args(argv)

    if not args.source.is_file():
        raise SystemExit(f"找不到 {args.source}")

    base = read_manifest(args.source)
    match = re.search(r"^version\s*=\s*(\S+)", base, re.MULTILINE)
    if not match:
        raise SystemExit("manifest 里没有 version = 行")
    release = match.group(1)

    new_version = args.version or dev_version(release, commit_count(args.repo))
    rewrite(args.source, args.dest, new_version)
    print(f"release {release} -> dev {new_version}")
    print(f"wrote {args.dest}")
    print("提示：dev 包只用于本机测试，不要发布，也不要提交到仓库")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
