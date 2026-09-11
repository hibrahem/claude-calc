"""Local web portal for Claude Code spend."""
import json
import os
import threading
import time
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from .costlib import load

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, projects_dir=None, **kw):
        self.projects_dir = projects_dir
        super().__init__(*a, directory=STATIC, **kw)

    def do_GET(self):
        if self.path.split("?")[0] == "/api/rows":
            t0 = time.time()
            data = load(self.projects_dir) if self.projects_dir else load()
            data["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            data["scan_ms"] = int((time.time() - t0) * 1000)
            body = json.dumps(data).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            super().log_message(fmt, *args)


def serve(port=8765, open_browser=True, projects_dir=None):
    handler = partial(Handler, projects_dir=projects_dir)
    srv = ThreadingHTTPServer(("127.0.0.1", port), handler)
    url = f"http://localhost:{port}"
    print(f"Claude Code spend portal: {url}  (Ctrl+C to stop)")
    if open_browser:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
