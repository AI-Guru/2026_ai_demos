#!/usr/bin/env python3
"""Dev server for TIGER — Operation Weißer Blitz. Run: python3 tools/serve.py"""
import http.server
import os
import socketserver

PORT = 8377
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".bin": "application/octet-stream",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".png": "image/png",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"TIGER — Operation Weißer Blitz → http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")