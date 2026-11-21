#!/usr/bin/env python3
"""Static server for HEAT STACK with no-cache headers and correct module/wasm MIME types.
Usage: python3 scripts/serve.py [port] [--lan]   (--lan binds 0.0.0.0 so phones / a Pi on your Wi-Fi can connect)"""
import http.server, os, socketserver, sys
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
port = int(next((a for a in sys.argv[1:] if a.isdigit()), 8137))
host = '0.0.0.0' if '--lan' in sys.argv else '127.0.0.1'
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml'}
    def __init__(self, *a, **k): super().__init__(*a, directory=root, **k)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()
socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer((host, port), H) as s:
    print(f'HEAT STACK on http://{host}:{port}/'); s.serve_forever()
