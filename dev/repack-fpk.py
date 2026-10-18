#!/usr/bin/env python3
"""Rebuild an FPK (gzip tar) and force sane Unix modes.

fnpack on Windows writes cmd/* as 0666 because NTFS has no Unix mode bits.
fnOS runs lifecycle scripts with bash, but 0755 is the correct/safer mode.
This script only rewrites the outer tar; app.tgz (and its checksum) is untouched.
"""

import io
import sys
import tarfile


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: repack-fpk.py <source.fpk> <dest.fpk>")
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    members = []
    with tarfile.open(src, "r:gz") as tin:
        for member in tin.getmembers():
            data = None
            if member.isfile():
                data = tin.extractfile(member).read()
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

    with tarfile.open(dst, "w:gz", format=tarfile.GNU_FORMAT, compresslevel=9) as tout:
        for member, data in members:
            if data is not None:
                member.size = len(data)
                tout.addfile(member, io.BytesIO(data))
            else:
                tout.addfile(member)
    print(f"wrote {dst} ({len(members)} entries)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
