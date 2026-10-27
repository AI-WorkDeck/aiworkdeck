#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Patch static/CustomTarget_emscripten_fs_image.mk and/or repack soffice.data.

Supports two complementary modes:
1. Build-time Makefile patching (`static/CustomTarget_emscripten_fs_image.mk`):
   - Packs zh-CN UI catalogs (.mo) + registry .xcd files + ZZZ-aiworkdeck-locale-zh-CN.xcd.
   - Filters out broken WASM Lightproof Python grammar checker files (`Lightproof.py`,
     `Lightproof.components`, `dict-en/pythonpath/*`, `dict-en/dialog/*`) and unused
     non-zh/en Hunspell dictionary extensions when `--slim-dicts` is enabled.
2. Post-build / artifact image repacking (`soffice.data` + `soffice.data.js.metadata`
   or `soffice.js.metadata`):
   - Strips `Lightproof.py` / `Lightproof.components` and non-zh/en `dict-*` slices
     directly from `soffice.data`, packs remaining file slices contiguously, and
     recalculates exact `[start, end)` byte offsets and `remote_package_size`.
   - Strictly preserves `dict-en` (core Hunspell/thesaurus/hyphenation files) and all
     `zh-CN` langpack `.xcd` / `.mo` resources.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Sequence

ZH_CN_MK_MARKER = "ZZZ-aiworkdeck-locale-zh-CN"
SLIM_MK_MARKER = "AI Workdeck (#1371): slim Lightproof and unused dicts"

DICT_EXTENSION_RE = re.compile(r"(?:^|/)share/extensions/dict-([^/]+)/")

LIGHTPROOF_PATTERNS = (
    "/Lightproof.py",
    "/Lightproof.components",
    "/dict-en/pythonpath/",
    "/dict-en/dialog/",
)

TRUETYPE_DIR_MARKER = "/share/fonts/truetype/"

KEPT_TRUETYPE_PREFIXES = (
    "LiberationSans-",
    "LiberationSerif-",
    "LiberationMono-",
    "Carlito-",
    "Caladea-",
    "AAA-CJK",
    "cjk",
    "NotoSansCJK",
    "NotoSerifCJK",
)

KEPT_TRUETYPE_EXACT = frozenset(
    {
        "opens___.ttf",
        "DejaVuMathTeXGyre.ttf",
        "fc_local.conf",
    }
)


def is_kept_truetype_font(basename: str) -> bool:
    if basename in KEPT_TRUETYPE_EXACT:
        return True
    return any(basename.startswith(prefix) for prefix in KEPT_TRUETYPE_PREFIXES)


def normalize_keep_dicts(keep_dicts: Sequence[str] | str) -> tuple[str, ...]:
    if isinstance(keep_dicts, str):
        items = [part.strip().lower() for part in keep_dicts.split(",") if part.strip()]
    else:
        items = [str(part).strip().lower() for part in keep_dicts if str(part).strip()]
    return tuple(dict.fromkeys(items or ["en", "zh"]))


def is_kept_dict_lang(dict_lang: str, keep_dicts: Sequence[str]) -> bool:
    lang = dict_lang.strip().lower().replace("_", "-")
    for kept in keep_dicts:
        k = kept.strip().lower().replace("_", "-")
        if lang == k or lang.startswith(f"{k}-"):
            return True
    return False


def should_strip_fs_entry(
    filename: str,
    slim_dicts: bool = True,
    keep_dicts: Sequence[str] = ("en", "zh"),
    slim_fonts: bool = True,
) -> bool:
    """Return True if a virtual FS path should be stripped from soffice.data."""
    normalized = filename.replace("\\", "/")

    # Always preserve zh-CN langpack / registry / locale .mo assets
    if (
        "Langpack-zh-CN.xcd" in normalized
        or "cjk_zh-CN.xcd" in normalized
        or "fcfg_langpack_zh-CN.xcd" in normalized
        or "registry_zh-CN.xcd" in normalized
        or "ZZZ-aiworkdeck-locale-zh-CN.xcd" in normalized
        or "/program/resource/zh_CN/" in normalized
    ):
        return False

    # Always strip Lightproof Python grammar checker files (Python is disabled in WASM)
    for pattern in LIGHTPROOF_PATTERNS:
        if normalized.endswith(pattern) or pattern in normalized:
            return True

    if slim_fonts and TRUETYPE_DIR_MARKER in normalized:
        basename = normalized.rsplit("/", 1)[-1]
        if not is_kept_truetype_font(basename):
            return True

    if not slim_dicts:
        return False

    match = DICT_EXTENSION_RE.search(normalized)
    if match:
        dict_lang = match.group(1)
        if not is_kept_dict_lang(dict_lang, keep_dicts):
            return True

    return False


def patch_fs_image_mk(
    mk_path: Path,
    slim_dicts: bool = True,
    keep_dicts: Sequence[str] = ("en", "zh"),
) -> list[str]:
    """Idempotently patch static/CustomTarget_emscripten_fs_image.mk."""
    s = mk_path.read_text(encoding="utf-8")
    applied: list[str] = []

    if ZH_CN_MK_MARKER not in s:
        anchor = "endif # !ENABLE_WASM_STRIP_CHART\n"
        assert s.count(anchor) == 1, f"anchor count = {s.count(anchor)} in {mk_path}"
        block = (
            anchor
            + """
# AI Workdeck (#66): pack the zh-CN UI catalogs (.mo) + registry + the default
# UI-locale override so the self-built engine ships Simplified Chinese natively
# (resources produced by --with-lang=zh-CN). Mirrors the en-US registry entries.
gb_emscripten_fs_image_files += \\
    $(INSTROOT)/$(LIBO_SHARE_FOLDER)/registry/Langpack-zh-CN.xcd \\
    $(INSTROOT)/$(LIBO_SHARE_FOLDER)/registry/cjk_zh-CN.xcd \\
    $(INSTROOT)/$(LIBO_SHARE_FOLDER)/registry/res/fcfg_langpack_zh-CN.xcd \\
    $(INSTROOT)/$(LIBO_SHARE_FOLDER)/registry/res/registry_zh-CN.xcd \\
    $(INSTROOT)/$(LIBO_SHARE_FOLDER)/registry/ZZZ-aiworkdeck-locale-zh-CN.xcd \\
    $(wildcard $(INSTROOT)/program/resource/zh_CN/LC_MESSAGES/*.mo)
"""
        )
        s = s.replace(anchor, block, 1)
        applied.append("zh-cn-fs-image-mk")
    else:
        applied.append("zh-cn-fs-image-mk (already applied)")

    if slim_dicts:
        if SLIM_MK_MARKER not in s:
            slim_block = f"""
# {SLIM_MK_MARKER} (keep_dicts={",".join(keep_dicts)})
gb_emscripten_fs_image_files := $(filter-out \\
    %/Lightproof.py \\
    %/Lightproof.components \\
    %/dict-en/pythonpath/% \\
    %/dict-en/dialog/%,$(gb_emscripten_fs_image_files))
"""
            ruleset_anchor = "#\n# Ruleset\n#\n"
            if ruleset_anchor in s:
                s = s.replace(ruleset_anchor, slim_block.lstrip("\n") + "\n" + ruleset_anchor, 1)
            else:
                s = s.rstrip() + "\n" + slim_block
            applied.append("slim-lightproof-fs-image-mk")
        else:
            applied.append("slim-lightproof-fs-image-mk (already applied)")

    mk_path.write_text(s, encoding="utf-8")
    return applied


def repack_soffice_data(
    data_path: Path,
    metadata_paths: Sequence[Path],
    slim_dicts: bool = True,
    keep_dicts: Sequence[str] = ("en", "zh"),
    slim_fonts: bool = True,
) -> dict:
    """Repack soffice.data and recalculate metadata offsets cleanly and idempotently."""
    if not metadata_paths:
        raise ValueError(f"No metadata files provided for {data_path}")

    primary_meta = metadata_paths[0]
    meta = json.loads(primary_meta.read_text(encoding="utf-8"))
    files = meta.get("files")
    if not isinstance(files, list):
        raise ValueError(f"Invalid metadata format in {primary_meta}: missing 'files' list")

    raw_data = data_path.read_bytes()
    new_data = bytearray()
    kept_files: list[dict] = []
    removed_files: list[str] = []

    for entry in files:
        filename = entry["filename"]
        start = int(entry["start"])
        end = int(entry["end"])
        if start < 0 or end < start or end > len(raw_data):
            raise ValueError(
                f"Out-of-bounds slice for {filename}: [{start}, {end}) in {len(raw_data)}-byte {data_path}"
            )
        if should_strip_fs_entry(
            filename,
            slim_dicts=slim_dicts,
            keep_dicts=keep_dicts,
            slim_fonts=slim_fonts,
        ):
            removed_files.append(filename)
            continue

        chunk = raw_data[start:end]
        new_start = len(new_data)
        new_data.extend(chunk)
        new_end = len(new_data)

        updated_entry = dict(entry)
        updated_entry["start"] = new_start
        updated_entry["end"] = new_end
        kept_files.append(updated_entry)

    meta["files"] = kept_files
    meta["remote_package_size"] = len(new_data)

    if removed_files or len(new_data) != len(raw_data):
        data_path.write_bytes(bytes(new_data))

    serialized_meta = json.dumps(meta, separators=(",", ":"))
    for meta_path in metadata_paths:
        meta_path.write_text(serialized_meta, encoding="utf-8")

    return {
        "kept_count": len(kept_files),
        "removed_count": len(removed_files),
        "removed_files": removed_files,
        "remote_package_size": len(new_data),
    }


def resolve_metadata_files(directory: Path) -> list[Path]:
    candidates = [
        directory / "soffice.data.js.metadata",
        directory / "soffice.js.metadata",
    ]
    return [p for p in candidates if p.is_file()]


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Patch CustomTarget_emscripten_fs_image.mk and/or slim soffice.data + metadata."
    )
    parser.add_argument(
        "target",
        nargs="?",
        default=os.environ.get("LOWA_CORE", "/root/lowa-build/core"),
        help="Path to LibreOffice core dir, CustomTarget_emscripten_fs_image.mk, or artifact dir containing soffice.data",
    )
    parser.add_argument(
        "--slim-dicts",
        dest="slim_dicts",
        action="store_true",
        default=True,
        help="Strip Lightproof.py and non-zh/en dict-* extensions (default: enabled).",
    )
    parser.add_argument(
        "--no-slim-dicts",
        dest="slim_dicts",
        action="store_false",
        help="Keep non-zh/en dict-* extensions (still strips broken Lightproof.py).",
    )
    parser.add_argument(
        "--keep-dicts",
        default="en,zh",
        help="Comma-separated dictionary language prefixes to keep (default: en,zh).",
    )
    parser.add_argument(
        "--slim-fonts",
        dest="slim_fonts",
        action="store_true",
        default=True,
        help="Strip unused non-core fonts from /instdir/share/fonts/truetype/ (default: enabled).",
    )
    parser.add_argument(
        "--no-slim-fonts",
        dest="slim_fonts",
        action="store_false",
        help="Keep all bundled fonts in /instdir/share/fonts/truetype/.",
    )
    args = parser.parse_args(argv)
    keep_dicts = normalize_keep_dicts(args.keep_dicts)
    target = Path(args.target)

    did_work = False

    # Case 1: target is or contains static/CustomTarget_emscripten_fs_image.mk
    mk_candidates = []
    if target.is_file() and target.name == "CustomTarget_emscripten_fs_image.mk":
        mk_candidates.append(target)
    elif target.is_dir():
        mk_in_core = target / "static/CustomTarget_emscripten_fs_image.mk"
        if mk_in_core.is_file():
            mk_candidates.append(mk_in_core)

    for mk_path in mk_candidates:
        applied = patch_fs_image_mk(mk_path, slim_dicts=args.slim_dicts, keep_dicts=keep_dicts)
        print(f"fs_image .mk ({mk_path}): {', '.join(applied)}")
        did_work = True

    # Case 2: target is a directory containing soffice.data + metadata (or core with workdir build output)
    data_dirs = []
    if target.is_file() and target.name == "soffice.data":
        data_dirs.append(target.parent)
    elif target.is_dir():
        if (target / "soffice.data").is_file():
            data_dirs.append(target)
        for rel in (
            "workdir/installation/LibreOffice/emscripten",
            "workdir/CustomTarget/static/emscripten_fs_image",
        ):
            sub = target / rel
            if (sub / "soffice.data").is_file():
                data_dirs.append(sub)

    for d in data_dirs:
        meta_files = resolve_metadata_files(d)
        if not meta_files:
            continue
        result = repack_soffice_data(
            d / "soffice.data",
            meta_files,
            slim_dicts=args.slim_dicts,
            keep_dicts=keep_dicts,
            slim_fonts=args.slim_fonts,
        )
        print(
            f"repacked {d / 'soffice.data'}: kept={result['kept_count']} "
            f"removed={result['removed_count']} size={result['remote_package_size']}"
        )
        did_work = True

    if not did_work:
        raise FileNotFoundError(
            f"No CustomTarget_emscripten_fs_image.mk or soffice.data+metadata found at {target}"
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
