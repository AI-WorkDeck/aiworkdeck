#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Single-box health & threshold check for AI WorkDeck server instances.

Runs from awd-health-check.timer (every minute). Reads each instance's loopback
management port (application-ops.yml): /actuator/health and /actuator/prometheus,
plus local disk usage. Alerts through the existing ops channel (Aliyun SMS
notification template SMS_512065498 "站点${name}于${time}探测失败", the same one
site-probe uses; optional Resend e-mail). Stdlib only.

Alert policy: a check alerts after N consecutive failures, then stays quiet until it
recovers (recovery is e-mailed + logged; the SMS template only says "failed") or until
AWD_HC_REPEAT_HOURS have passed. Whole-machine-down is NOT this script's job: the
cross-machine site-probe covers it by probing the public /api/health/ready.

Usage: awd-health-check.py [--dry-run] [--test]
  --dry-run  evaluate and print, never send, do not touch the state file
  --test     send one test alert through every configured channel and exit
See deploy/cloud/README.md (运维监控) for configuration.
"""
import base64
import datetime
import hashlib
import hmac
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import uuid

ENV = os.environ
UA = "awd-health-check/1"  # Resend's edge rejects Python's default User-Agent


def env_float(name, default):
    return float(ENV.get(name, default))


TARGETS = [t.split("=", 1) for t in ENV.get("AWD_HC_TARGETS", "addin=http://127.0.0.1:19696").split()]
DISK_PATHS = [d.split("=", 1) for d in ENV.get("AWD_HC_DISK_PATHS", "root=/").split()]
STATE_FILE = ENV.get("AWD_HC_STATE", os.path.join(ENV.get("STATE_DIRECTORY", "/var/lib/awd-health-check"), "state.json"))
RATIO_5XX = env_float("AWD_HC_5XX_RATIO", "0.05")
MIN_5XX = env_float("AWD_HC_5XX_MIN", "5")
HEAP_RATIO = env_float("AWD_HC_HEAP_RATIO", "0.90")
DISK_FREE_RATIO = env_float("AWD_HC_DISK_FREE_RATIO", "0.10")
DISK_FREE_MIN = env_float("AWD_HC_DISK_FREE_MIN_GB", "5") * 1024 ** 3
REPEAT_SECONDS = env_float("AWD_HC_REPEAT_HOURS", "6") * 3600
# consecutive failures before alerting (heap and pool waits are noisy by nature)
NEEDED = {"health": 2, "5xx": 2, "heap": 3, "dbpool": 3, "disk": 2}

SAMPLE = re.compile(r'^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{(.*)\})?\s+(\S+)')
LABEL = re.compile(r'(\w+)="((?:[^"\\]|\\.)*)"')


def fetch(url, timeout=10):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:  # 503 from health still carries a body
        return e.code, e.read().decode("utf-8", "replace")


def parse_prometheus(text):
    out = []
    for line in text.splitlines():
        if not line or line[0] == "#":
            continue
        m = SAMPLE.match(line)
        if m:
            try:
                out.append((m.group(1), dict(LABEL.findall(m.group(3) or "")), float(m.group(4))))
            except ValueError:
                pass
    return out


def total(samples, name, pred=lambda labels: True):
    return sum(v for n, l, v in samples if n == name and pred(l) and v == v)  # v==v drops NaN


def check_target(name, base, prev):
    """Returns ([(check_key, kind, ok, detail)], counters_for_next_run, info)."""
    results, counters, info = [], None, {}
    try:
        status, body = fetch(base + "/actuator/health")
        doc = json.loads(body)
        down = [k for k, c in (doc.get("components") or {}).items() if c.get("status") != "UP"]
        ok = status == 200 and doc.get("status") == "UP"
        results.append((name + "-health", "health", ok, "" if ok else f"{doc.get('status')} {','.join(down)}"))
    except Exception as e:  # unreachable / not JSON: the process is down or wedged
        results.append((name + "-health", "health", False, f"unreachable: {e.__class__.__name__}"))
        return results, None, info
    try:
        _, text = fetch(base + "/actuator/prometheus")
        s = parse_prometheus(text)
    except Exception as e:
        results.append((name + "-metrics", "health", False, f"metrics: {e.__class__.__name__}"))
        return results, None, info

    app = lambda l: not l.get("uri", "").startswith("/actuator")
    req = total(s, "http_server_requests_seconds_count", app)
    err = total(s, "http_server_requests_seconds_count", lambda l: app(l) and l.get("status", "").startswith("5"))
    counters = {"req": req, "err": err}
    if prev and req >= prev["req"] and err >= prev["err"]:  # counters reset on restart: skip one round
        d_req, d_err = req - prev["req"], err - prev["err"]
        ok = not (d_err >= MIN_5XX and d_req > 0 and d_err / d_req >= RATIO_5XX)
        results.append((name + "-5xx", "5xx", ok, f"{int(d_err)}/{int(d_req)} 5xx since last run"))

    used = total(s, "jvm_memory_used_bytes", lambda l: l.get("area") == "heap")
    cap = sum(v for n, l, v in s if n == "jvm_memory_max_bytes" and l.get("area") == "heap" and v > 0)
    if cap:
        results.append((name + "-heap", "heap", used / cap < HEAP_RATIO, f"heap {used / cap:.0%} of {cap / 2 ** 20:.0f}MB"))

    pending = total(s, "hikaricp_connections_pending")
    active = total(s, "hikaricp_connections_active")
    pool_max = total(s, "hikaricp_connections_max")
    results.append((name + "-dbpool", "dbpool", pending < 1, f"pool active {active:.0f}/{pool_max:.0f}, waiting {pending:.0f}"))

    info = {
        "sse": total(s, "awd_sse_connections"),
        "agent_runs": total(s, "awd_agent_runs_active"),
        "threads": total(s, "jvm_threads_live_threads"),
        "db_active": active,
    }
    return results, counters, info


def check_disk(label, path):
    st = os.statvfs(path)
    free, size = st.f_bavail * st.f_frsize, st.f_blocks * st.f_frsize
    ok = free >= DISK_FREE_MIN and (size == 0 or free / size >= DISK_FREE_RATIO)
    return label + "-disk", "disk", ok, f"{path} free {free / 1024 ** 3:.1f}GB ({free / max(size, 1):.0%})"


# ---- alert channels (same as site-probe) ----

def pct(s):
    return urllib.parse.quote(str(s), safe="~")


def send_sms(name):
    key, secret = ENV.get("SMS_ACCESS_KEY_ID"), ENV.get("SMS_ACCESS_KEY_SECRET")
    phones = ENV.get("AWD_HC_PHONES", "").replace(" ", "")
    if not (key and secret and phones):
        return "sms: not configured"
    params = {
        "AccessKeyId": key, "Action": "SendSms", "Format": "JSON", "PhoneNumbers": phones,
        "RegionId": "cn-hangzhou", "SignName": ENV.get("SMS_SIGN_NAME", "京微资易科技"),
        "SignatureMethod": "HMAC-SHA1", "SignatureNonce": uuid.uuid4().hex, "SignatureVersion": "1.0",
        "TemplateCode": ENV.get("AWD_HC_SMS_TEMPLATE", "SMS_512065498"),
        # template variable rule: name=others (keep short), time must be YYYY-MM-DD hh:mm:ss
        "TemplateParam": json.dumps({"name": name[:20], "time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")},
                                    ensure_ascii=False),
        "Timestamp": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "Version": "2017-05-25",
    }
    query = "&".join(f"{pct(k)}={pct(params[k])}" for k in sorted(params))
    digest = hmac.new((secret + "&").encode(), ("GET&%2F&" + pct(query)).encode(), hashlib.sha1).digest()
    url = f"https://dysmsapi.aliyuncs.com/?Signature={pct(base64.b64encode(digest).decode())}&{query}"
    _, body = fetch(url)
    code = json.loads(body).get("Code")
    return "sms: ok" if code == "OK" else f"sms: {code}"


def send_email(subject, text):
    key, to = ENV.get("RESEND_API_KEY"), ENV.get("AWD_HC_EMAIL_TO")
    if not (key and to):
        return "email: not configured"
    payload = json.dumps({"from": ENV.get("AWD_HC_EMAIL_FROM", "AI WorkDeck Ops <ops@aiworkdeck.com>"),
                          "to": to.split(","), "subject": subject, "text": text}).encode()
    req = urllib.request.Request("https://api.resend.com/emails", data=payload, method="POST", headers={
        "Authorization": "Bearer " + key, "Content-Type": "application/json", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return f"email: {r.status}"
    except urllib.error.HTTPError as e:
        return f"email: {e.code}"


def notify(key, detail, recovered=False):
    host = os.uname().nodename
    subject = f"[{host}] {key} {'recovered' if recovered else 'FAILED'}"
    out = [] if recovered else [send_sms(key)]
    out.append(send_email(subject, f"{subject}\n{detail}\n{datetime.datetime.now().isoformat(timespec='seconds')}"))
    return "; ".join(out)


def safe_notify(key, detail, recovered=False):
    try:
        return notify(key, detail, recovered)
    except Exception as e:  # never let a channel failure kill the run
        return f"notify error: {e.__class__.__name__}: {e}"


def main(argv):
    if "--test" in argv:
        print(safe_notify("health-check-test", "test alert from awd-health-check --test"))
        return 0
    dry = "--dry-run" in argv
    try:
        with open(STATE_FILE) as f:
            state = json.load(f)
    except (OSError, ValueError):
        state = {}
    counters, checks = state.get("counters", {}), state.get("checks", {})
    results = []
    for name, base in TARGETS:
        r, c, info = check_target(name, base.rstrip("/"), counters.get(name))
        results += r
        if c is None:
            counters.pop(name, None)
        else:
            counters[name] = c
        if info:
            print(f"{name}: " + " ".join(f"{k}={v:.0f}" for k, v in info.items()))
    for label, path in DISK_PATHS:
        try:
            results.append(check_disk(label, path))
        except OSError as e:
            results.append((label + "-disk", "disk", False, f"{path}: {e.strerror}"))

    now = time.time()
    for key, kind, ok, detail in results:
        st = checks.setdefault(key, {"fails": 0, "alerted_at": None})
        print(f"{'OK  ' if ok else 'FAIL'} {key} {detail}")
        if ok:
            if st["alerted_at"] and not dry:
                print(f"  recovered -> {safe_notify(key, detail, recovered=True)}")
            st.update(fails=0, alerted_at=None)
            continue
        st["fails"] += 1
        due = st["alerted_at"] is None or now - st["alerted_at"] >= REPEAT_SECONDS
        if st["fails"] >= NEEDED[kind] and due:
            if dry:
                print("  would alert")
            else:
                print(f"  alert -> {safe_notify(key, detail)}")
                st["alerted_at"] = now

    if not dry:
        os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
        tmp = STATE_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"counters": counters, "checks": checks}, f)
        os.replace(tmp, STATE_FILE)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
