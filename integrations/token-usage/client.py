#!/usr/bin/env python3
"""Standalone token usage client for OuroNex.

Sends an already-aggregated batch of usage records to POST /api/v1/usage/ and prints the
server's real response. The external application owns the counters; this client only validates
the local payload envelope and forwards it unchanged (it never derives or counts tokens).

Environment:
    OURONEX_ACCESS_TOKEN    Bearer token issued by POST /api/v1/auth/login/

Usage:
    python client.py --base-url http://localhost:8000 --payload examples/records.json

Exit codes:
    0  the batch was accepted
    2  missing token or invalid arguments
    3  payload file missing, not valid JSON, or not a {records: [...]} envelope
    4  the server answered with an HTTP error status
    5  the request could not reach the server
"""

import argparse
import http.client
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API_PATH = "/api/v1/usage/"
TOKEN_ENV = "OURONEX_ACCESS_TOKEN"
DEFAULT_TIMEOUT = 30.0
MAX_RECORDS = 500

EXIT_OK = 0
EXIT_MISSING_TOKEN = 2
EXIT_USAGE = 2
EXIT_BAD_PAYLOAD = 3
EXIT_HTTP_ERROR = 4
EXIT_NETWORK_ERROR = 5


class PayloadError(Exception):
    """The local payload file cannot be used as a request body."""


class NetworkError(Exception):
    """The server could not be reached; nothing was confirmed by the server."""


class HttpStatusError(Exception):
    """The server answered with a non-2xx status and a body."""

    def __init__(self, status, body, url=""):
        super().__init__("HTTP %s" % status)
        self.status = status
        self.body = body
        self.url = url


def endpoint_url(base_url):
    """Join the site root with the usage endpoint, rejecting non-http(s) bases."""
    base = (base_url or "").strip()
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("base URL must be an absolute http(s) URL, e.g. http://localhost:8000")
    return base.rstrip("/") + API_PATH


def load_payload(path):
    """Read and check the local envelope shape; record fields are validated by the server."""
    try:
        raw = Path(path).read_text(encoding="utf-8")
    except OSError as error:
        raise PayloadError("cannot read payload file %s: %s" % (path, error)) from None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as error:
        raise PayloadError("payload is not valid JSON: %s" % error) from None
    if not isinstance(data, dict):
        raise PayloadError("payload must be a JSON object containing a records array")
    records = data.get("records")
    if not isinstance(records, list):
        raise PayloadError("payload must contain a records array")
    if not records:
        raise PayloadError("records must contain at least one record")
    if len(records) > MAX_RECORDS:
        raise PayloadError("records may contain at most %d records" % MAX_RECORDS)
    return data


def build_request(base_url, token, payload):
    """Build the POST request: JSON body plus the Bearer credential in the header."""
    url = endpoint_url(base_url)
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=body, method="POST")
    request.add_header("Authorization", "Bearer " + token)
    request.add_header("Content-Type", "application/json")
    request.add_header("Accept", "application/json")
    request.add_header("User-Agent", "ouroNex-token-usage-client/1.0")
    return request


def send_request(request, timeout=DEFAULT_TIMEOUT):
    """Perform the request. Returns (status, body) or raises NetworkError / HttpStatusError."""
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        try:
            body = error.read().decode("utf-8", "replace") if error.fp else ""
        finally:
            error.close()
        raise HttpStatusError(error.code, body, request.full_url) from None
    except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException, ssl.SSLError) as error:
        reason = getattr(error, "reason", None) or error
        raise NetworkError(str(reason)) from None


def format_body(body):
    """Pretty-print JSON responses; return non-JSON bodies unchanged."""
    text = (body or "").strip()
    if not text:
        return "(empty response body)"
    try:
        return json.dumps(json.loads(text), indent=2, ensure_ascii=False)
    except (json.JSONDecodeError, ValueError):
        return text


def main(argv=None, sender=None, stream=None):
    parser = argparse.ArgumentParser(
        description="Send an aggregated token usage batch to OuroNex (POST /api/v1/usage/)."
    )
    parser.add_argument("--base-url", required=True, help="site root, for example http://localhost:8000")
    parser.add_argument("--payload", required=True, help="path to a JSON file shaped like examples/records.json")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT, help="request timeout in seconds")
    args = parser.parse_args(argv)

    out = stream if stream is not None else sys.stdout
    send = sender if sender is not None else send_request

    token = (os.environ.get(TOKEN_ENV) or "").strip()
    if not token:
        print(
            "missing token: set %s to the Bearer token returned by POST /api/v1/auth/login/" % TOKEN_ENV,
            file=out,
        )
        return EXIT_MISSING_TOKEN

    try:
        payload = load_payload(args.payload)
    except PayloadError as error:
        print("payload error: %s" % error, file=out)
        return EXIT_BAD_PAYLOAD

    try:
        request = build_request(args.base_url, token, payload)
    except ValueError as error:
        print("usage error: %s" % error, file=out)
        return EXIT_USAGE

    print("POST %s" % request.full_url, file=out)

    try:
        status, body = send(request, args.timeout)
    except HttpStatusError as error:
        print("HTTP %s" % error.status, file=out)
        print(format_body(error.body), file=out)
        return EXIT_HTTP_ERROR
    except NetworkError as error:
        print("network error: the request did not reach the server: %s" % error, file=out)
        return EXIT_NETWORK_ERROR

    print("HTTP %s" % status, file=out)
    print(format_body(body), file=out)
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())