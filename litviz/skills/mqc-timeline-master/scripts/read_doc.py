#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""读老式 Word（.doc，Word 97-2003 二进制格式）。

**为什么要有它。** 法院、律所往来的判决书与代理词里，.doc 仍然很常见。真实运行记录
（2026-09-20）：使用者给的判决书是 .doc，技能不认，模型现场装 olefile 写了一个解析脚本
才读进来。这里把它做成标准件，并且**不引第三方库**：.doc 的外壳是复合文档（CFB），
正文在 WordDocument 流里，片段表（piece table）在 Table 流里，两者都能直接解。

**做法。**
  1. 解 CFB：读 512 字节文件头 → 目录项 → FAT / miniFAT 链 → 取出两个流；
  2. 读 FIB：fcClx / lcbClx 指出片段表在 Table 流里的位置，nFib 指出用 0Table 还是 1Table；
  3. 解片段表：每段记着字符在 WordDocument 流里的偏移与编码（压缩的是 cp1252，
     未压缩的是 UTF-16LE），按段拼出正文；
  4. 清掉域代码与控制字符，段落按 \\r 切开。

**读不了就说清楚，不猜。** 遇到加密文档或结构对不上时抛一句可照做的话：
用 Word 另存为 .docx，或 `soffice --convert-to docx`。
"""
import re
import struct

_ENDOFCHAIN = 0xFFFFFFFE
_FREESECT = 0xFFFFFFFF


class DocReadError(RuntimeError):
    pass


def _cfb_streams(data):
    """返回 {流名: bytes}。只解需要的部分，不做通用 CFB 库。"""
    if data[:8] != b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        raise DocReadError("不是 Word 97-2003 的 .doc（文件头对不上）")
    ssz = 1 << struct.unpack_from("<H", data, 30)[0]          # 扇区大小，通常 512
    mssz = 1 << struct.unpack_from("<H", data, 32)[0]         # 迷你扇区，通常 64
    n_fat = struct.unpack_from("<I", data, 44)[0]
    dir_start = struct.unpack_from("<I", data, 48)[0]
    mini_cut = struct.unpack_from("<I", data, 56)[0]
    mini_start = struct.unpack_from("<I", data, 60)[0]
    difat_start, n_difat = struct.unpack_from("<II", data, 68)

    def sect(i):
        off = 512 + i * ssz
        return data[off:off + ssz]

    fat_sects = list(struct.unpack_from("<109I", data, 76))
    nxt = difat_start
    while n_difat and nxt not in (_ENDOFCHAIN, _FREESECT):
        blk = sect(nxt)
        fat_sects += list(struct.unpack_from(f"<{ssz // 4 - 1}I", blk, 0))
        nxt = struct.unpack_from("<I", blk, ssz - 4)[0]
    fat = []
    for s in fat_sects[:n_fat]:
        if s in (_ENDOFCHAIN, _FREESECT):
            continue
        fat += list(struct.unpack_from(f"<{ssz // 4}I", sect(s), 0))

    def chain(start):
        out, cur, seen = [], start, set()
        while cur not in (_ENDOFCHAIN, _FREESECT) and cur < len(fat) and cur not in seen:
            seen.add(cur)
            out.append(cur)
            cur = fat[cur]
        return out

    dir_data = b"".join(sect(i) for i in chain(dir_start))
    entries = []
    for off in range(0, len(dir_data), 128):
        e = dir_data[off:off + 128]
        if len(e) < 128:
            break
        nlen = struct.unpack_from("<H", e, 64)[0]
        name = e[:max(0, nlen - 2)].decode("utf-16le", "replace")
        entries.append((name, e[66], struct.unpack_from("<I", e, 116)[0],
                        struct.unpack_from("<I", e, 120)[0]))
    root = next((x for x in entries if x[1] == 5), None)
    mini_stream = b""
    if root:
        mini_fat = []
        for s in chain(mini_start):
            mini_fat += list(struct.unpack_from(f"<{ssz // 4}I", sect(s), 0))
        mini_stream = b"".join(sect(i) for i in chain(root[2]))

        def mini_chain(start):
            out, cur, seen = [], start, set()
            while cur not in (_ENDOFCHAIN, _FREESECT) and cur < len(mini_fat) and cur not in seen:
                seen.add(cur)
                out.append(cur)
                cur = mini_fat[cur]
            return out
    out = {}
    for name, typ, start, size in entries:
        if typ != 2 or not name:
            continue
        if size < mini_cut and root:
            raw = b"".join(mini_stream[i * mssz:(i + 1) * mssz] for i in mini_chain(start))
        else:
            raw = b"".join(sect(i) for i in chain(start))
        out[name] = raw[:size]
    return out


def _pieces(wd, table):
    """片段表：返回 [(在 WordDocument 流里的偏移, 长度, 是否压缩)]。"""
    fc_clx, lcb_clx = struct.unpack_from("<II", wd, 0x01A2)
    clx = table[fc_clx:fc_clx + lcb_clx]
    i = 0
    while i < len(clx) and clx[i] == 1:                 # 跳过 Prc（格式块）
        cb = struct.unpack_from("<H", clx, i + 1)[0]
        i += 3 + cb
    if i >= len(clx) or clx[i] != 2:
        raise DocReadError("片段表结构对不上（可能是加密或损坏的 .doc）")
    lcb = struct.unpack_from("<I", clx, i + 1)[0]
    plc = clx[i + 5:i + 5 + lcb]
    n = (len(plc) - 4) // 12
    cps = list(struct.unpack_from(f"<{n + 1}I", plc, 0))
    out = []
    for k in range(n):
        fc = struct.unpack_from("<I", plc, 4 * (n + 1) + 8 * k + 2)[0]
        comp = bool(fc & 0x40000000)
        off = (fc & 0x3FFFFFFF) // 2 if comp else (fc & 0x3FFFFFFF)
        cch = cps[k + 1] - cps[k]
        out.append((off, cch, comp))
    return out


def read_doc(path):
    """返回正文文本。段落之间用换行分开，域代码与控制字符清掉。"""
    data = open(path, "rb").read()
    streams = _cfb_streams(data)
    wd = streams.get("WordDocument")
    if not wd:
        raise DocReadError("这份 .doc 里没有 WordDocument 流")
    flags = struct.unpack_from("<H", wd, 10)[0]
    if flags & 0x0100:
        raise DocReadError("这份 .doc 是加密的，读不了；请用 Word 另存为 .docx 后再给我")
    table = streams.get("1Table" if flags & 0x0200 else "0Table") or streams.get("0Table")
    if table is None:
        raise DocReadError("这份 .doc 里没有 Table 流")
    parts = []
    for off, cch, comp in _pieces(wd, table):
        if comp:
            parts.append(wd[off:off + cch].decode("cp1252", "replace"))
        else:
            parts.append(wd[off:off + cch * 2].decode("utf-16le", "replace"))
    text = "".join(parts)
    text = re.sub(r"\x13[^\x14\x15]*\x14?", "", text)        # 域代码（页码、目录等）
    text = text.replace("\x15", "").replace("\x07", "\n")    # 域结束、表格单元分隔
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
    text = text.replace("\r", "\n").replace("\u000b", "\n")
    lines = [ln.strip() for ln in text.split("\n")]
    return "\n".join(ln for ln in lines if ln)
