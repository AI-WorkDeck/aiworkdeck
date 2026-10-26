# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Functional native LOK probe. No performance comparison or real IME claim."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import shutil
import struct
import subprocess
import threading
import time
import xml.etree.ElementTree as ET
import zipfile

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def fixture(path):
    paragraphs = []
    for p in range(60):
        runs = []
        for n in range(10):
            i = p * 10 + n
            kind, tag = ("ins", "t") if n % 2 == 0 else ("del", "delText")
            text = f"合成测试条款{i}：按期核验并交付文件。"
            runs.append(f'<w:{kind} w:id="{i}" w:author="Reviewer {i}" w:date="2026-10-08T08:00:00Z"><w:r><w:{tag}>{text}</w:{tag}></w:r></w:{kind}>')
        paragraphs.append("<w:p>" + "".join(runs) + "</w:p>")
    body = "".join(paragraphs)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        z.writestr("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        z.writestr("word/document.xml", f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>')


def docx_projection(path):
    with zipfile.ZipFile(path) as z:
        assert z.testzip() is None
        tree = ET.fromstring(z.read("word/document.xml"))
    def text(node, mode):
        if (mode == "final" and node.tag == f"{{{W}}}del") or (mode == "original" and node.tag == f"{{{W}}}ins"):
            return ""
        if node.tag in (f"{{{W}}}t", f"{{{W}}}delText"):
            return node.text or ""
        return "".join(text(child, mode) for child in node)
    revisions = {}
    count = 0
    for node in tree.iter():
        if node.tag in (f"{{{W}}}ins", f"{{{W}}}del"):
            key = (node.tag, node.get(f"{{{W}}}author"), node.get(f"{{{W}}}date"))
            revisions[key] = revisions.get(key, "") + text(node, "all")
            count += 1
    return {"all": text(tree, "all"), "final": text(tree, "final"), "original": text(tree, "original"), "revisions": revisions, "count": count}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker", type=Path, required=True)
    ap.add_argument("--runtime", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--fixture", type=Path)
    ap.add_argument("--uno-host", type=Path, help="Optional compiled python_host.c for isolated URP checks")
    ap.add_argument("--uno-runtime", type=Path, help="Explicit isolated LibreOffice copy providing Python 3.12 and pyuno")
    args = ap.parse_args()
    if args.uno_host and not args.uno_runtime:
        ap.error("--uno-host requires an explicit --uno-runtime in an isolated copy")
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=False)
    for name in ("home", "profile", "temp"):
        (out / name).mkdir()
    if args.fixture:
        shutil.copyfile(args.fixture, out / "synthetic-600.docx")
    else:
        fixture(out / "synthetic-600.docx")
    events, messages = [], queue.Queue()
    result = {"scope": "native LOK functional capabilities; not a performance comparison or UI/IME test", "runtime": str(args.runtime), "fixtureSha256": hashlib.sha256((out / "synthetic-600.docx").read_bytes()).hexdigest(), "requests": []}
    env = {"HOME": str(out / "home"), "TMPDIR": str(out / "temp"), "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "en_US.UTF-8", "LC_ALL": "en_US.UTF-8", "LOK_WORKDIR": str(out), "SAL_LOK_OPTIONS": "unipoll", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONPYCACHEPREFIX": str(out / "python-cache")}
    with (out / "worker-stderr.log").open("wb") as err:
        proc = subprocess.Popen([str(args.worker.resolve()), str(args.runtime), (out / "profile").as_uri(), str(out)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err, env=env, cwd=out, start_new_session=True)
        result["ownedPid"] = proc.pid

        def read_exact(n):
            b = bytearray()
            while len(b) < n:
                part = proc.stdout.read(n - len(b))
                if not part:
                    raise EOFError("worker stream ended")
                b.extend(part)
            return b

        def reader():
            try:
                while True:
                    h, b = struct.unpack("<II", read_exact(8))
                    if not h or h + b > 64 * 1024 * 1024:
                        raise ValueError("invalid frame size")
                    head = json.loads(read_exact(h))
                    payload = read_exact(b) if b else b""
                    if head.get("type") == "callback":
                        events.append(head)
                    elif head.get("type") == "phase":
                        events.append(head)
                        (out / "phases.json").write_text(json.dumps([e for e in events if e["type"] == "phase"],indent=2))
                    else:
                        messages.put((head, payload))
            except Exception as exc:
                messages.put(({"type": "stream-end", "error": str(exc)}, b""))

        thread = threading.Thread(target=reader, daemon=True)
        thread.start()
        seq = 0

        def request(action, payload=b"", **params):
            nonlocal seq
            seq += 1
            head = json.dumps({"reqId": seq, "action": action, **params}, ensure_ascii=False).encode()
            proc.stdin.write(struct.pack("<II", len(head), len(payload)) + head + payload)
            proc.stdin.flush()
            reply, data = messages.get(timeout=45)
            if reply.get("reqId") != seq:
                raise RuntimeError(reply)
            result["requests"].append({"action": action, **reply})
            return reply, data

        try:
            ready, _ = messages.get(timeout=45)
            result["engine"] = ready
            if ready.get("type") != "engine-ready":
                raise RuntimeError(ready)
            opened, _ = request("open", path=str(out / "synthetic-600.docx"))
            if not opened["success"]:
                raise RuntimeError(opened)
            painted, pixels = request("paint", width=800, height=900, xTwips=0, yTwips=0, widthTwips=11906, heightTwips=13395)
            (out / "tile.raw").write_bytes(pixels)
            result["tileSha256"] = hashlib.sha256(pixels).hexdigest()
            result["pixelsChanged"] = painted["pixelsChanged"]
            revisions, _ = request("values", command=".uno:AcceptTrackedChanges")
            (out / "revisions.json").write_text(revisions.get("value", ""))
            if revisions["success"]:
                result["redlineQuery"] = json.loads(revisions["value"])
            request("command", command=".uno:TrackChanges", arguments='{"TrackChanges":{"type":"boolean","value":true}}')
            request("command", command=".uno:GoToEndOfDoc", arguments="{}")
            # Native key/paste API checks only: these are explicitly NOT system IME tests.
            request("key", eventType=0, charCode=88, keyCode=0)
            request("key", eventType=1, charCode=88, keyCode=0)
            request("paste", "原生合成输入核验".encode())
            if args.uno_host:
                urp, _ = request("start_urp")
                if not urp["success"]:
                    raise RuntimeError(urp)
                result["ownedLoopbackPort"] = urp["port"]
                python_home = args.uno_runtime / "Frameworks/LibreOfficePython.framework/Versions/3.12"
                client_env = dict(env, PYTHONHOME=str(python_home), PYTHONPATH=str(args.uno_runtime / "Resources") + ":" + str(args.uno_runtime / "Frameworks"), URE_BOOTSTRAP="vnd.sun.star.pathname:" + str(args.uno_runtime / "Resources/fundamentalrc"))
                client = subprocess.run([str(args.uno_host.resolve()), str(python_home / "LibreOfficePython"), str(Path(__file__).with_name("uno_probe.py").resolve()), "--port", str(urp["port"]), "--document-url", (out / "synthetic-600.docx").as_uri()], env=client_env, cwd=out, capture_output=True, timeout=45)
                (out / "uno-client-stderr.log").write_bytes(client.stderr)
                (out / "uno-result.json").write_bytes(client.stdout)
                result["unoExitCode"] = client.returncode
                result["uno"] = json.loads(client.stdout) if client.stdout else {"failure": "UNO client produced no result"}
            saved, _ = request("save", path=str(out / "saved.docx"))
            if saved["success"]:
                before = docx_projection(out / "synthetic-600.docx")
                after = docx_projection(out / "saved.docx")
                result["savedOriginal600ClauseOrder"] = re.findall(r"合成测试条款\d+：按期核验并交付文件。", before["all"]) == re.findall(r"合成测试条款\d+：按期核验并交付文件。", after["all"])
                result["savedOriginal600RevisionTypesAuthorsDatesText"] = all(after["revisions"].get(key) == value for key, value in before["revisions"].items())
                result["savedOriginalProjectionUnchanged"] = after["original"] == before["original"]
                result["savedFinalProjectionExpected"] = after["final"] == before["final"] + "X原生合成输入核验" + ("｜UNO锚点核验" if result.get("uno", {}).get("redoRestoredReplacement") else "")
                result["nativeKeyAndPasteSaved"] = "X原生合成输入核验" in after["final"]
                result["newRevisionAuthors"] = sorted({key[1] for key in after["revisions"] if key not in before["revisions"]})
                result["revisionNodesAfterSave"] = after["count"]
            request("shutdown")
            proc.stdin.close()
            result["exitCode"] = proc.wait(timeout=20)
        except Exception as exc:
            result["failure"] = repr(exc)
        finally:
            if proc.poll() is None:
                result["forcedTermination"] = True
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5)
            result["exitCode"] = proc.returncode
            result["ownedProcessExited"] = proc.poll() is not None
            thread.join(timeout=2)
            (out / "callbacks.json").write_text(json.dumps(events, ensure_ascii=False, indent=2))
            (out / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
            print(json.dumps({k: v for k, v in result.items() if k not in ("requests", "redlineQuery")}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
