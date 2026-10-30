#!/usr/bin/env python3
"""从仓库源码直接构建 fnOS 可安装的 FPK（不需要 fnpack，也不需要现成模板）。

CI（GitHub Actions）与本地用的是同一份逻辑：

    python dev/build-fpk.py                          # 产物 dist/anirss-<manifest 版本>.fpk
    python dev/build-fpk.py --version 1.13.3         # 指定版本号（本地试包用）
    python dev/build-fpk.py --expect-version 1.13.3  # 校验 manifest 版本，不一致直接失败
    python dev/build-fpk.py -o /tmp/anirss.fpk       # 指定输出路径

产物结构（与 fnpack 一致）：

    外层 tar.gz
    ├── app.tgz            # app/ 的内容 + 仓库 config/（放在 app.tgz 根的 config/）
    ├── manifest           # 重写 version 与 checksum（app.tgz 的 md5）
    ├── cmd/               # 生命周期脚本，0755
    ├── config/            # privilege / resource，0644
    ├── wizard/            # 卸载向导，0644
    ├── ICON.PNG
    ├── ICON_256.PNG
    └── LICENSE

权限沿用 fnOS 的约定：app.tgz 里目录 0777 / 文件 0666；外层目录 0755、
`cmd/*` 0755、其余 0644。构建完会自检结构、权限、checksum 与内容清单，
任何一项不对就非零退出，避免把装不上的包发出去。

需要可复现产物时设 ``SOURCE_DATE_EPOCH``；没设就取最后一次 commit 的时间
（不在 git 仓库里则取当前时间）。
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import time
from pathlib import Path

APP_DIR_MODE = 0o777
APP_FILE_MODE = 0o666
OUTER_DIR_MODE = 0o755
OUTER_CMD_MODE = 0o755
OUTER_FILE_MODE = 0o644

# 外层固定成员（顺序即写入顺序，便于 diff 与复现）
OUTER_ICON_FILES = ("LICENSE", "ICON.PNG", "ICON_256.PNG")
OUTER_SCRIPT_DIRS = ("cmd",)
OUTER_DATA_DIRS = ("config", "wizard")

SKIP_PARTS = {".git", "__pycache__", "node_modules", ".DS_Store", "Thumbs.db"}


def repo_root(value: str) -> Path:
    root = Path(value).resolve()
    if not (root / "manifest").is_file():
        raise SystemExit(f"{root} 里没有 manifest，确认这是项目根目录")
    if not (root / "app" / "server" / "index.js").is_file():
        raise SystemExit(f"{root}/app/server/index.js 不存在，确认这是项目根目录")
    return root


def source_epoch(explicit: int | None, root: Path) -> int:
    """打包用时间戳：--source-date-epoch > SOURCE_DATE_EPOCH > 最后一次提交 > 当前时间。"""
    if explicit is not None:
        return explicit
    env = os.environ.get("SOURCE_DATE_EPOCH", "").strip()
    if env:
        try:
            return int(env)
        except ValueError:
            raise SystemExit(f"SOURCE_DATE_EPOCH 不是整数：{env!r}")
    try:
        out = subprocess.run(
            ["git", "-C", str(root), "log", "-1", "--format=%ct"],
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        if out.isdigit():
            return int(out)
    except (OSError, subprocess.CalledProcessError):
        pass
    return int(time.time())


def skipped(rel: Path) -> bool:
    return any(part in SKIP_PARTS or part.endswith(".pyc") for part in rel.parts)


def collect(root: Path, sub: str) -> dict[str, Path]:
    """收集 sub 目录下的所有条目，key 为相对路径（POSIX）。"""
    base = root / sub
    if not base.is_dir():
        raise SystemExit(f"{base} 不存在")
    entries: dict[str, Path] = {}
    for path in sorted(base.rglob("*")):
        rel = path.relative_to(base)
        if skipped(rel):
            continue
        entries[rel.as_posix()] = path
    return entries


def app_entries(root: Path) -> dict[str, Path]:
    """app.tgz 的清单：app/ 的内容放在根，仓库 config/ 也打进去（app.tgz 里同样有 config/）。"""
    entries: dict[str, Path] = {}
    for rel, path in collect(root, "app").items():
        entries[rel] = path
    config_dir = root / "config"
    if not config_dir.is_dir():
        raise SystemExit(f"{config_dir} 不存在")
    # fnpack 产出的 app.tgz 里有顶层 config/ 目录条目，这里保持一致
    entries["config"] = config_dir
    for rel, path in collect(root, "config").items():
        entries[f"config/{rel}"] = path
    if "server/index.js" not in entries:
        raise SystemExit("app.tgz 清单里没有 server/index.js，app/ 目录不完整")
    return entries


def gzip_tar(entries: list[tuple[tarfile.TarInfo, bytes | None]], epoch: int) -> bytes:
    """按给定顺序写 tar.gz；gzip 头也写固定时间，保证同样输入产出同样字节。"""
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=9, mtime=epoch) as gz:
        with tarfile.open(fileobj=gz, mode="w", format=tarfile.GNU_FORMAT) as tar:
            for info, data in entries:
                if data is None:
                    tar.addfile(info)
                else:
                    info.size = len(data)
                    tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def build_app_tgz(root: Path, epoch: int) -> bytes:
    entries: list[tuple[tarfile.TarInfo, bytes | None]] = []
    for rel, path in sorted(app_entries(root).items()):
        info = tarfile.TarInfo(rel)
        info.uid = info.gid = 0
        info.uname = info.gname = ""
        info.mtime = epoch
        if path.is_dir():
            info.type = tarfile.DIRTYPE
            info.mode = APP_DIR_MODE
            entries.append((info, None))
        else:
            info.type = tarfile.REGTYPE
            info.mode = APP_FILE_MODE
            entries.append((info, path.read_bytes()))
    return gzip_tar(entries, epoch)


def rewrite_manifest(text: str, version: str | None, checksum: str) -> str:
    if version is not None:
        if not re.search(r"^version\s*=", text, re.MULTILINE):
            raise SystemExit("manifest 里没有 version 行")
        text = re.sub(r"^version\s*=.*$", f"version               = {version}", text, count=1, flags=re.MULTILINE)
    if re.search(r"^checksum\s*=", text, re.MULTILINE):
        text = re.sub(r"^checksum\s*=.*$", f"checksum              = {checksum}", text, count=1, flags=re.MULTILINE)
    else:
        if not text.endswith("\n"):
            text += "\n"
        text += f"checksum              = {checksum}\n"
    return text


def manifest_field(text: str, key: str) -> str:
    found = re.search(rf"^{key}\s*=\s*(.*)$", text, re.MULTILINE)
    return found.group(1).strip() if found else ""


def outer_layout(root: Path) -> list[tuple[str, Path]]:
    """外层成员清单：('dir'|'file'|'cmd-file', 相对路径)。

    cmd/ 下的脚本必须是 0755，wizard/ 与 config/ 下的文件是 0644。
    """
    layout: list[tuple[str, Path]] = [("file", Path("app.tgz"))]
    for name in OUTER_ICON_FILES:
        layout.append(("file", Path(name)))
    for dirname in OUTER_SCRIPT_DIRS + OUTER_DATA_DIRS:
        base = root / dirname
        if not base.is_dir():
            raise SystemExit(f"{base} 不存在")
        layout.append(("dir", Path(dirname)))
        for path in sorted(base.rglob("*")):
            rel = path.relative_to(root)
            if skipped(rel.relative_to(dirname)):
                continue
            kind = "cmd-file" if dirname in OUTER_SCRIPT_DIRS else "file"
            layout.append((kind, rel))
    layout.append(("file", Path("manifest")))
    return layout


def build(root: Path, out: Path, *, version: str | None, epoch: int) -> tuple[str, str]:
    app_tgz = build_app_tgz(root, epoch)
    digest = hashlib.md5(app_tgz).hexdigest()

    manifest_path = root / "manifest"
    manifest = manifest_path.read_text(encoding="utf-8")
    current = manifest_field(manifest, "version")
    if not current:
        raise SystemExit("manifest 里没有 version 行")
    final_version = version or current
    final_manifest = rewrite_manifest(manifest, version, digest).encode("utf-8")

    payloads: dict[str, bytes] = {
        "app.tgz": app_tgz,
        "manifest": final_manifest,
    }

    entries: list[tuple[tarfile.TarInfo, bytes | None]] = []
    for kind, rel in outer_layout(root):
        info = tarfile.TarInfo(rel.as_posix())
        info.uid = info.gid = 0
        info.uname = info.gname = ""
        info.mtime = epoch
        if kind == "dir":
            info.type = tarfile.DIRTYPE
            info.mode = OUTER_DIR_MODE
            entries.append((info, None))
            continue
        info.type = tarfile.REGTYPE
        info.mode = OUTER_CMD_MODE if kind == "cmd-file" else OUTER_FILE_MODE
        data = payloads.get(rel.as_posix())
        if data is None:
            data = (root / rel).read_bytes()
        entries.append((info, data))

    blob = gzip_tar(entries, epoch)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(blob)
    return final_version, digest


def check_version_consistency(root: Path, version: str) -> None:
    pkg = root / "package.json"
    if not pkg.is_file():
        return
    try:
        declared = json.loads(pkg.read_text(encoding="utf-8")).get("version")
    except json.JSONDecodeError:
        print("  [warn] package.json 不是合法 JSON，跳过版本一致性检查")
        return
    if declared and declared != version:
        print(f"  [warn] package.json 版本 {declared} 与 manifest 版本 {version} 不一致")


def verify(root: Path, fpk: Path, version: str) -> None:
    """自检：结构、权限、checksum、app.tgz 内容都要与仓库一致。"""
    problems: list[str] = []
    expected_app = app_entries(root)

    with tarfile.open(fpk, "r:gz") as tar:
        members = {member.name: member for member in tar.getmembers()}
        expected_outer = {rel.as_posix() for kind, rel in outer_layout(root)}
        missing = expected_outer - set(members)
        extra = set(members) - expected_outer
        if missing:
            problems.append(f"外层缺少：{sorted(missing)}")
        if extra:
            problems.append(f"外层多出：{sorted(extra)}")

        manifest = tar.extractfile(members["manifest"]).read().decode("utf-8")
        app_tgz = tar.extractfile(members["app.tgz"]).read()
        digest = hashlib.md5(app_tgz).hexdigest()

        found_checksum = re.search(r"^checksum\s*=\s*(\S+)", manifest, re.MULTILINE)
        if not found_checksum:
            problems.append("manifest 没有 checksum")
        elif found_checksum.group(1) != digest:
            problems.append(f"checksum 与 app.tgz 不符（manifest {found_checksum.group(1)} / 实际 {digest}）")

        found_version = re.search(r"^version\s*=\s*(\S+)", manifest, re.MULTILINE)
        if not found_version:
            problems.append("manifest 没有 version")
        elif found_version.group(1) != version:
            problems.append(f"manifest 版本是 {found_version.group(1)}，期望 {version}")

        for name, member in members.items():
            if member.isdir():
                want = OUTER_DIR_MODE
            elif name.startswith("cmd/"):
                want = OUTER_CMD_MODE
            else:
                want = OUTER_FILE_MODE
            if member.mode != want:
                problems.append(f"外层 {name} 权限 {oct(member.mode)}，应为 {oct(want)}")

    with tarfile.open(fileobj=io.BytesIO(app_tgz), mode="r:gz") as inner:
        packed = {member.name: member for member in inner.getmembers()}
        if set(packed) != set(expected_app):
            lost = sorted(set(expected_app) - set(packed))
            extra_inner = sorted(set(packed) - set(expected_app))
            if lost:
                problems.append(f"app.tgz 缺少：{lost[:8]}")
            if extra_inner:
                problems.append(f"app.tgz 多出：{extra_inner[:8]}")
        for rel, path in expected_app.items():
            member = packed.get(rel)
            if member is None:
                continue
            want = APP_DIR_MODE if path.is_dir() else APP_FILE_MODE
            if member.mode != want:
                problems.append(f"app.tgz 里 {rel} 权限 {oct(member.mode)}，应为 {oct(want)}")
            if path.is_file() and member.size != path.stat().st_size:
                problems.append(f"app.tgz 里 {rel} 大小 {member.size}，应为 {path.stat().st_size}")

    print(f"  自检：外层 {len(members)} 项，app.tgz {len(packed)} 项，checksum {digest}")
    if problems:
        for problem in problems:
            print("  [FAIL] " + problem)
        raise SystemExit(1)
    print("  [OK] 结构、权限与 checksum 自检通过")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="从仓库源码构建 fnOS FPK")
    parser.add_argument("-o", "--out", type=Path, help="输出路径，默认 dist/anirss-<版本>.fpk")
    parser.add_argument("--version", help="覆盖 manifest 里的版本号（本地试包用，CI 用 --expect-version）")
    parser.add_argument("--expect-version", help="要求 manifest 版本与此一致，否则失败（发布时对齐 tag 用）")
    parser.add_argument("--root", default=".", help="项目根目录，默认当前目录")
    parser.add_argument("--source-date-epoch", type=int, help="固定打包时间戳（可复现构建）")
    parser.add_argument("--no-verify", action="store_true", help="跳过构建后自检（不推荐）")
    args = parser.parse_args(argv)

    root = repo_root(args.root)
    epoch = source_epoch(args.source_date_epoch, root)

    manifest = (root / "manifest").read_text(encoding="utf-8")
    declared = manifest_field(manifest, "version")
    if not declared:
        raise SystemExit("manifest 里没有 version 行")
    if args.version and args.expect_version and args.version != args.expect_version:
        raise SystemExit("--version 与 --expect-version 不一致，二选一")
    if args.expect_version and declared != args.expect_version:
        raise SystemExit(
            f"manifest 版本是 {declared}，期望 {args.expect_version}；"
            "发布前先在 release/x.y.z 的 PR 里改 manifest（以及 package.json）"
        )

    version = args.version or declared
    out = args.out or (root / "dist" / f"anirss-{version}.fpk")
    if not out.is_absolute():
        out = root / out

    print(f"项目根目录 {root}")
    print(f"版本 {version}（manifest {declared}），时间戳 {epoch}")
    final_version, digest = build(root, out, version=version, epoch=epoch)
    size = out.stat().st_size
    print(f"app.tgz md5={digest}")
    print(f"写出 {out}（{size} 字节）")
    check_version_consistency(root, final_version)
    if not args.no_verify:
        verify(root, out, final_version)
    else:
        print("  [skip] 已跳过自检")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
