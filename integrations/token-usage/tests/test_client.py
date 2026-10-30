"""Tests for the standalone token usage client.

Standard library only; the HTTP cases run against a fake server bound to 127.0.0.1 on an
ephemeral port, and the network-failure branch uses controlled injection instead of a real
outage. No external network access.
"""

import importlib.util
import io
import json
import os
import sys
import threading
import unittest
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

PKG_DIR = Path(__file__).resolve().parents[1]


def load_client():
    spec = importlib.util.spec_from_file_location("ouro_token_usage_client", PKG_DIR / "client.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


client = load_client()

TOKEN_ENV = "OURONEX_ACCESS_TOKEN"


class FakeServer:
    """Minimal HTTP server that records requests and replies with a fixed response."""

    def __init__(self, status=200, body=None, content_type="application/json"):
        self.status = status
        self.body = json.dumps(body) if isinstance(body, (dict, list)) else (body or "")
        self.content_type = content_type
        self.requests = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802 - http.server naming
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length).decode("utf-8") if length else ""
                outer.requests.append(
                    {
                        "path": self.path,
                        "headers": {key.lower(): value for key, value in self.headers.items()},
                        "body": raw,
                    }
                )
                payload = outer.body.encode("utf-8")
                self.send_response(outer.status)
                self.send_header("Content-Type", outer.content_type)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):  # keep test output clean
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        self.base_url = "http://127.0.0.1:%d" % self.server.server_address[1]
        return self

    def __exit__(self, *exc_info):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


def sample_payload():
    return json.loads((PKG_DIR / "examples" / "records.json").read_text(encoding="utf-8"))


class PayloadFixture:
    """Writes JSON payload files to a temporary directory."""

    def __init__(self, testcase):
        import tempfile

        self._tmp = tempfile.TemporaryDirectory()
        testcase.addCleanup(self._tmp.cleanup)
        self.dir = Path(self._tmp.name)

    def write(self, name, content):
        path = self.dir / name
        if isinstance(content, (dict, list)):
            path.write_text(json.dumps(content), encoding="utf-8")
        else:
            path.write_text(content, encoding="utf-8")
        return str(path)


class ClientRequestTests(unittest.TestCase):
    def test_build_request_posts_json_with_bearer_token(self):
        payload = sample_payload()
        request = client.build_request("http://127.0.0.1:9999", "probe-token", payload)

        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.full_url, "http://127.0.0.1:9999/api/v1/usage/")
        self.assertEqual(request.get_header("Authorization"), "Bearer probe-token")
        self.assertEqual(request.get_header("Content-type"), "application/json")
        self.assertEqual(json.loads(request.data.decode("utf-8")), payload)

    def test_build_request_normalises_trailing_slash_and_prefix(self):
        payload = sample_payload()
        self.assertEqual(
            client.build_request("http://127.0.0.1:9999/", "t", payload).full_url,
            "http://127.0.0.1:9999/api/v1/usage/",
        )
        self.assertEqual(
            client.build_request("https://example.test/ouro", "t", payload).full_url,
            "https://example.test/ouro/api/v1/usage/",
        )


class ClientFailureTests(unittest.TestCase):
    def setUp(self):
        self.payloads = PayloadFixture(self)

    def test_missing_token_exits_two_without_sending(self):
        calls = []
        payload_path = self.payloads.write("ok.json", sample_payload())
        env = {key: value for key, value in os.environ.items() if key != TOKEN_ENV}
        with mock.patch.dict(os.environ, env, clear=True):
            stream = io.StringIO()
            code = client.main(
                ["--base-url", "http://127.0.0.1:9", "--payload", payload_path],
                sender=lambda request, timeout: calls.append(request),
                stream=stream,
            )
        self.assertEqual(code, client.EXIT_MISSING_TOKEN)
        self.assertEqual(calls, [])
        self.assertIn("OURONEX_ACCESS_TOKEN", stream.getvalue())

    def test_invalid_local_json_exits_three(self):
        cases = {
            "garbage.json": "{not json",
            "array.json": [],
            "missing-records.json": {"rows": []},
            "records-not-list.json": {"records": {"day": "2026-10-01"}},
        }
        with mock.patch.dict(os.environ, {TOKEN_ENV: "probe-token"}, clear=False):
            for name, content in cases.items():
                with self.subTest(case=name):
                    path = self.payloads.write(name, content)
                    stream = io.StringIO()
                    code = client.main(
                        ["--base-url", "http://127.0.0.1:9", "--payload", path],
                        sender=lambda request, timeout: self.fail("sender must not run"),
                        stream=stream,
                    )
                    self.assertEqual(code, client.EXIT_BAD_PAYLOAD)
                    self.assertIn("payload", stream.getvalue().lower())

    def test_missing_payload_file_exits_three(self):
        with mock.patch.dict(os.environ, {TOKEN_ENV: "probe-token"}, clear=False):
            stream = io.StringIO()
            code = client.main(
                ["--base-url", "http://127.0.0.1:9", "--payload", str(PayloadFixture(self).dir / "absent.json")],
                sender=lambda request, timeout: self.fail("sender must not run"),
                stream=stream,
            )
        self.assertEqual(code, client.EXIT_BAD_PAYLOAD)


class ClientHttpTests(unittest.TestCase):
    def setUp(self):
        self.payloads = PayloadFixture(self)

    def test_success_prints_server_response_and_forwards_payload_verbatim(self):
        payload = sample_payload()
        body = {"success": True, "received": len(payload["records"]), "upserted": len(payload["records"]), "generatedAt": "2026-10-30T12:00:00Z"}
        path = self.payloads.write("ok.json", payload)
        with FakeServer(status=200, body=body) as server:
            with mock.patch.dict(os.environ, {TOKEN_ENV: "probe-token"}, clear=False):
                stream = io.StringIO()
                code = client.main(["--base-url", server.base_url, "--payload", path], stream=stream)

        self.assertEqual(code, client.EXIT_OK)
        output = stream.getvalue()
        self.assertIn("200", output)
        self.assertIn('"success": true', output)
        self.assertEqual(len(server.requests), 1)
        request = server.requests[0]
        self.assertEqual(request["path"], "/api/v1/usage/")
        self.assertEqual(request["headers"]["authorization"], "Bearer probe-token")
        self.assertEqual(request["headers"]["content-type"], "application/json")
        forwarded = json.loads(request["body"])
        self.assertEqual(forwarded, payload)  # no derived fields, no totals added locally
        for record in forwarded["records"]:
            self.assertNotIn("totalTokens", record)

    def test_http_error_exits_four_and_prints_error_body(self):
        error_body = {"error": {"code": "invalid_records", "message": "record 1: day must be YYYY-MM-DD"}}
        path = self.payloads.write("ok.json", sample_payload())
        with FakeServer(status=400, body=error_body) as server:
            with mock.patch.dict(os.environ, {TOKEN_ENV: "probe-token"}, clear=False):
                stream = io.StringIO()
                code = client.main(["--base-url", server.base_url, "--payload", path], stream=stream)

        self.assertEqual(code, client.EXIT_HTTP_ERROR)
        output = stream.getvalue()
        self.assertIn("400", output)
        self.assertIn("invalid_records", output)

    def test_unauthorized_exits_four(self):
        path = self.payloads.write("ok.json", sample_payload())
        with FakeServer(status=401, body={"error": {"code": "invalid_token", "message": "A valid Bearer token is required."}}) as server:
            with mock.patch.dict(os.environ, {TOKEN_ENV: "expired-token"}, clear=False):
                stream = io.StringIO()
                code = client.main(["--base-url", server.base_url, "--payload", path], stream=stream)
        self.assertEqual(code, client.EXIT_HTTP_ERROR)
        self.assertIn("invalid_token", stream.getvalue())

    def test_network_error_exits_five(self):
        path = self.payloads.write("ok.json", sample_payload())

        def failing_sender(request, timeout):
            raise client.NetworkError("connection refused")

        with mock.patch.dict(os.environ, {TOKEN_ENV: "probe-token"}, clear=False):
            stream = io.StringIO()
            code = client.main(["--base-url", "http://127.0.0.1:9", "--payload", path], sender=failing_sender, stream=stream)

        self.assertEqual(code, client.EXIT_NETWORK_ERROR)
        self.assertIn("network error", stream.getvalue().lower())


class ClientBehaviourTests(unittest.TestCase):
    def test_client_contains_no_token_counting(self):
        source = (PKG_DIR / "client.py").read_text(encoding="utf-8")
        for forbidden in ("totalTokens", "total_tokens", "sum(", "input + output", "cacheWrite + cacheRead"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)

    def test_example_payload_matches_schema_constraints(self):
        payload = sample_payload()
        self.assertGreaterEqual(len(payload["records"]), 3)
        self.assertLessEqual(len(payload["records"]), 500)
        days = {record["day"] for record in payload["records"]}
        models = {record["model"] for record in payload["records"]}
        sessions = {record["sessionId"] for record in payload["records"]}
        self.assertGreaterEqual(len(days), 2)
        self.assertGreaterEqual(len(models), 2)
        self.assertGreaterEqual(len(sessions), 2)
        for record in payload["records"]:
            self.assertRegex(record["day"], r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
            self.assertTrue(1 <= len(record["model"]) <= 120)
            self.assertTrue(1 <= len(record["sessionId"]) <= 200)
            self.assertLessEqual(len(record.get("title", "")), 255)
            self.assertTrue(1 <= len(record.get("source", "external")) <= 80)
            for counter in ("calls", "input", "output", "cacheWrite", "cacheRead"):
                self.assertIsInstance(record[counter], int)
                self.assertGreaterEqual(record[counter], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)