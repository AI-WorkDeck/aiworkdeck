#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Offline test for awd-health-check.py: fake actuator on a random loopback port,
no alert channel configured (nothing is sent). Run: python3 deploy/ops/awd-health-check_test.py"""
import http.server
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "awd-health-check.py")
FAKE = {"health": (200, {"status": "UP", "components": {"db": {"status": "UP"}}}), "req": 100, "err": 0,
        "heap_used": 100e6, "pending": 0}


def prom():
    return "\n".join([
        "# TYPE http_server_requests_seconds_count counter",
        f'http_server_requests_seconds_count{{method="GET",status="200",uri="/api/x"}} {FAKE["req"] - FAKE["err"]}',
        f'http_server_requests_seconds_count{{method="GET",status="500",uri="/api/x"}} {FAKE["err"]}',
        'http_server_requests_seconds_count{method="GET",status="500",uri="/actuator/prometheus"} 999',
        f'jvm_memory_used_bytes{{area="heap",id="G1 Old Gen"}} {FAKE["heap_used"]}',
        'jvm_memory_max_bytes{area="heap",id="G1 Eden Space"} -1.0',
        'jvm_memory_max_bytes{area="heap",id="G1 Old Gen"} 1.0E9',
        f'hikaricp_connections_pending{{pool="HikariPool-1"}} {FAKE["pending"]}',
        'hikaricp_connections_active{pool="HikariPool-1"} 3', 'hikaricp_connections_max{pool="HikariPool-1"} 30',
        'awd_sse_connections{stream="chat"} 4', 'awd_sse_connections{stream="desktop"} NaN',
        'awd_agent_runs_active 2', ""])


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        code, body = (FAKE["health"][0], json.dumps(FAKE["health"][1])) if self.path == "/actuator/health" else (200, prom())
        self.send_response(code)
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, *a):
        pass


class HealthCheckTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        FAKE.update(health=(200, {"status": "UP", "components": {"db": {"status": "UP"}}}), req=100, err=0,
                    heap_used=100e6, pending=0)
        self.dir = tempfile.mkdtemp()

    def run_check(self, *args):
        env = {k: v for k, v in os.environ.items() if not k.startswith(("SMS_", "RESEND", "AWD_HC_"))}
        env.update(AWD_HC_TARGETS=f"t=http://127.0.0.1:{self.server.server_port}", AWD_HC_DISK_PATHS=f"tmp={self.dir}",
                   AWD_HC_STATE=os.path.join(self.dir, "state.json"), AWD_HC_DISK_FREE_MIN_GB="0", AWD_HC_DISK_FREE_RATIO="0")
        return subprocess.run([sys.executable, "-I", SCRIPT, *args], env=env, capture_output=True, text=True, check=True).stdout

    def test_all_ok(self):
        self.run_check()
        out = self.run_check()
        self.assertNotIn("FAIL", out)
        self.assertIn("OK   t-5xx 0/0", out)  # /actuator 5xx are excluded
        self.assertIn("sse=4 agent_runs=2", out)  # NaN gauges are ignored

    def test_db_down_alerts_after_two_runs_then_recovers(self):
        FAKE["health"] = (503, {"status": "DOWN", "components": {"db": {"status": "DOWN"}, "ping": {"status": "UP"}}})
        first = self.run_check()
        self.assertIn("FAIL t-health DOWN db", first)
        self.assertNotIn("alert", first)
        second = self.run_check()
        self.assertIn("alert -> sms: not configured; email: not configured", second)
        self.assertNotIn("alert", self.run_check())  # no repeat until recovery / repeat window
        FAKE["health"] = (200, {"status": "UP"})
        self.assertIn("recovered", self.run_check())

    def test_5xx_rate_heap_and_pool(self):
        self.run_check()  # baseline counters
        FAKE.update(req=200, err=20, heap_used=950e6, pending=2)
        out = self.run_check()
        self.assertIn("FAIL t-5xx 20/100", out)
        self.assertIn("FAIL t-heap heap 95%", out)
        self.assertIn("FAIL t-dbpool", out)
        FAKE.update(req=300, err=40)
        self.assertIn("t-5xx 20/100 5xx since last run\n  alert", self.run_check())

    def test_unreachable_and_dry_run(self):
        out = subprocess.run([sys.executable, "-I", SCRIPT, "--dry-run"], capture_output=True, text=True, check=True,
                             env={**os.environ, "AWD_HC_TARGETS": "t=http://127.0.0.1:9", "AWD_HC_DISK_PATHS": f"tmp={self.dir}",
                                  "AWD_HC_STATE": os.path.join(self.dir, "s.json")}).stdout
        self.assertIn("FAIL t-health unreachable", out)
        self.assertFalse(os.path.exists(os.path.join(self.dir, "s.json")))


if __name__ == "__main__":
    unittest.main()
