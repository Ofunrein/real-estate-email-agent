#!/usr/bin/env python3
"""Loopback relay for TikTok Sandbox OAuth through Composio."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener
import os

HOST = "127.0.0.1"
PORT = int(os.getenv("TIKTOK_SANDBOX_CALLBACK_PORT", "8765"))
COMPOSIO_CALLBACK = "https://backend.composio.dev/api/v1/auth-apps/add"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Relay(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        if "code=" not in self.path or "state=" not in self.path:
            self.send_error(400, "TikTok OAuth code and state are required")
            return

        try:
            response = build_opener(NoRedirect).open(Request(COMPOSIO_CALLBACK + self.path), timeout=30)
            status = response.status
            location = response.headers.get("Location")
        except HTTPError as error:
            status = error.code
            location = error.headers.get("Location")

        if location:
            self.send_response(302)
            self.send_header("Location", location)
            self.end_headers()
            return

        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(b"TikTok OAuth relay completed. Return to Composio.")

    def log_message(self, format: str, *args: object) -> None:
        pass


if __name__ == "__main__":
    print(f"TikTok Sandbox OAuth relay listening on http://127.0.0.1:{PORT}/")
    ThreadingHTTPServer((HOST, PORT), Relay).serve_forever()
