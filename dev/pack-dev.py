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

实测（2026-10）：``version`` 里的 ``-devN`` 后缀不参与版本比较，``1.13.3-dev15``
装上后再装 ``1.13.3-dev16`` 会被判成同版本、拒绝覆盖。所以想反复升级，递增号
必须写在点分段里（默认的 900 + 提交数）。

又因为任何「高于正式版」的号都会把后来的正式版挡在门外，反复真机测试更推荐
``--dev-identity``：把包改成独立应用（``appname`` / 端口 / 运行用户都换掉），
与正式版共存，版本号再也不用为了覆盖而虚高。

Usage:
    python dev/pack-dev.py anirss.fpk anirss-dev.fpk
    python dev/pack-dev.py anirss.fpk anirss-dev.fpk --version 1.13.916
    python dev/pack-dev.py anirss.fpk anirss-dev.fpk --dev-identity
    python dev/pack-dev.py anirss.fpk anirss-dev.fpk --dev-identity --appname anirss-dev --port 18182

Then install ``anirss-dev.fpk``; ``git status`` stays clean.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import subprocess
import sys
import tarfile
from pathlib import Path

DEV_PATCH_BASE = 900
VERSION_RE = re.compile(r"^version\s*=\s*.*$", re.MULTILINE)

# --dev-identity 的默认值：与正式版完全分开，互不覆盖
DEFAULT_DEV_APPNAME = "anirss-dev"
DEFAULT_DEV_PORT = 18182


def read_manifest(fpk: Path) -> str:
    with tarfile.open(fpk, "r:gz") as tar:
        for member in tar.getmembers():
            if member.name == "manifest" and member.isfile():
                data = tar.extractfile(member)
                if data is None:
                    raise SystemExit("无法读取 manifest 条目")
                return data.read().decode("utf-8")
    raise SystemExit(f"{fpk} 里没有 manifest 条目，确认这是 fnOS 的 FPK 包")


def manifest_field(text: str, key: str, whole_line: bool = False) -> str:
    """取 manifest 字段。whole_line=True 用于 display_name 这类带空格的字段。"""
    pattern = rf"^{key}\s*=\s*(.*)$" if whole_line else rf"^{key}\s*=\s*(\S+)"
    found = re.search(pattern, text, re.MULTILINE)
    return found.group(1).strip() if found else ""


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


def patch_app_tgz(
    app_tgz: bytes,
    *,
    old_appname: str,
    new_appname: str,
    port: int,
    title_suffix: str,
) -> bytes:
    """改写 app.tgz 里与身份绑定的两处：ui/config 的入口、config/privilege 的用户。"""
    members: list[tuple[tarfile.TarInfo, bytes | None]] = []
    with tarfile.open(fileobj=io.BytesIO(app_tgz), mode="r:gz") as tar:
        for member in tar.getmembers():
            data = tar.extractfile(member).read() if member.isfile() else None
            if member.name == "ui/config" and data is not None:
                data = patch_ui_config(data, old_appname, new_appname, port, title_suffix)
            elif member.name == "config/privilege" and data is not None:
                data = patch_privilege(data, new_appname)
            members.append((member, data))

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz", format=tarfile.GNU_FORMAT, compresslevel=9) as out:
        for member, data in members:
            if data is None:
                out.addfile(member)
            else:
                member.size = len(data)
                out.addfile(member, io.BytesIO(data))
    return buf.getvalue()


def patch_ui_config(data: bytes, old_appname: str, new_appname: str, port: int, title_suffix: str) -> bytes:
    try:
        config = json.loads(data.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"ui/config 不是合法 JSON：{exc}")
    urls = config.get(".url")
    if not isinstance(urls, dict) or not urls:
        raise SystemExit("ui/config 里没有 .url 入口，无法改身份")

    rewritten: dict[str, dict] = {}
    for key, entry in urls.items():
        suffix = key.split(".", 1)[1] if "." in key else key
        new_key = f"{new_appname}.{suffix}"
        if isinstance(entry, dict):
            entry = dict(entry)
            entry["port"] = str(port)
            if title_suffix and isinstance(entry.get("title"), str):
                entry["title"] = entry["title"] + title_suffix
        rewritten[new_key] = entry
    config[".url"] = rewritten
    _ = old_appname  # 前缀可能不叫 old_appname，入口 key 以 new_appname 为准重写
    return json.dumps(config, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"


def patch_privilege(data: bytes, new_appname: str) -> bytes:
    try:
        priv = json.loads(data.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"config/privilege 不是合法 JSON：{exc}")
    priv["username"] = new_appname
    priv["groupname"] = new_appname
    return json.dumps(priv, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"


def rewrite_manifest(
    text: str,
    *,
    new_version: str | None,
    checksum: str | None,
    identity: dict | None,
) -> str:
    if new_version is not None:
        if not VERSION_RE.search(text):
            raise SystemExit("manifest 里找不到 version 行")
        text = VERSION_RE.sub(f"version               = {new_version}", text, count=1)

    if identity is not None:
        pairs = {
            "appname": identity["appname"],
            "display_name": identity["display_name"],
            "service_port": str(identity["port"]),
            "desktop_applaunchname": identity["entry"],
        }
        for key, value in pairs.items():
            pattern = rf"^{key}\s*=.*$"
            line = f"{key:<22}= {value}"
            if re.search(pattern, text, re.MULTILINE):
                text = re.sub(pattern, line, text, count=1, flags=re.MULTILINE)
            else:
                if not text.endswith("\n"):
                    text += "\n"
                text += line + "\n"

    if checksum is not None:
        if re.search(r"^checksum\s*=", text, re.MULTILINE):
            text = re.sub(r"^checksum\s*=.*$", f"checksum              = {checksum}", text, count=1, flags=re.MULTILINE)
        else:
            if not text.endswith("\n"):
                text += "\n"
            text += f"checksum              = {checksum}\n"
    return text


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="生成带 dev 版本号的 FPK（不改仓库里的版本号）")
    parser.add_argument("source", type=Path, help="fnpack 产出的原始 fpk")
    parser.add_argument("dest", type=Path, help="输出路径，如 anirss-dev.fpk")
    parser.add_argument("--version", help="显式指定 dev 版本号，如 1.13.916 或 1.13.2.7")
    parser.add_argument("--repo", type=Path, default=Path("."), help="用于取提交数的 git 仓库，默认当前目录")
    parser.add_argument("--dev-identity", action="store_true",
                        help="改成独立应用（appname / 端口 / 运行用户），可与正式版共存")
    parser.add_argument("--appname", default=DEFAULT_DEV_APPNAME, help=f"独立应用名，默认 {DEFAULT_DEV_APPNAME}")
    parser.add_argument("--port", type=int, default=DEFAULT_DEV_PORT, help=f"独立端口，默认 {DEFAULT_DEV_PORT}")
    parser.add_argument("--title-suffix", default=" dev", help="桌面入口标题后缀，默认 ' dev'")
    args = parser.parse_args(argv)

    if not args.source.is_file():
        raise SystemExit(f"找不到 {args.source}")

    manifest = read_manifest(args.source)
    release = manifest_field(manifest, "version")
    if not release:
        raise SystemExit("manifest 里没有 version = 行")

    identity = None
    if args.dev_identity:
        old_appname = manifest_field(manifest, "appname") or "anirss"
        old_title = manifest_field(manifest, "display_name", whole_line=True) or old_appname
        entry_old = manifest_field(manifest, "desktop_applaunchname") or f"{old_appname}.main"
        entry_suffix = entry_old.split(".", 1)[1] if "." in entry_old else "main"
        identity = {
            "appname": args.appname,
            "display_name": old_title + args.title_suffix,
            "port": args.port,
            "entry": f"{args.appname}.{entry_suffix}",
            "old_appname": old_appname,
        }

    new_version = args.version or dev_version(release, commit_count(args.repo))

    members: list[tuple[tarfile.TarInfo, bytes | None]] = []
    replaced = 0
    with tarfile.open(args.source, "r:gz") as tar:
        for member in tar.getmembers():
            data = tar.extractfile(member).read() if member.isfile() else None
            if member.name == "app.tgz" and data is not None and identity is not None:
                data = patch_app_tgz(
                    data,
                    old_appname=identity["old_appname"],
                    new_appname=identity["appname"],
                    port=identity["port"],
                    title_suffix=args.title_suffix,
                )
            elif member.name == "manifest" and data is not None:
                data = None  # 最后统一重写，避免一处改漏
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
            if member.name == "manifest":
                replaced = 1

    if not replaced:
        raise SystemExit("没有找到 manifest 条目，已中止")

    # app.tgz 被改过就要重算 checksum；没改则沿用原值
    import hashlib

    app_bytes = next((data for member, data in members if member.name == "app.tgz"), None)
    if app_bytes is None:
        raise SystemExit("fpk 里没有 app.tgz")
    checksum = hashlib.md5(app_bytes).hexdigest()

    final_manifest = rewrite_manifest(
        manifest,
        new_version=new_version,
        checksum=checksum,
        identity=identity,
    )
    manifest_bytes = final_manifest.encode("utf-8")
    for index, (member, _data) in enumerate(members):
        if member.name == "manifest":
            member.size = len(manifest_bytes)
            members[index] = (member, manifest_bytes)
            break

    with tarfile.open(args.dest, "w:gz", format=tarfile.GNU_FORMAT, compresslevel=9) as out:
        for member, data in members:
            if data is not None:
                member.size = len(data)
                out.addfile(member, io.BytesIO(data))
            else:
                out.addfile(member)

    print(f"release {release} -> dev {new_version}")
    if identity is not None:
        print(f"独立身份：appname={identity['appname']} 端口={identity['port']} 入口={identity['entry']}")
    print(f"wrote {args.dest}")
    print("提示：dev 包只用于本机测试，不要发布，也不要提交到仓库")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
