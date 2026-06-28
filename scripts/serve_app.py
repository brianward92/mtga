#!/usr/bin/env python3
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


NO_CACHE_SUFFIXES = {".html", ".js", ".css", ".json"}


class RegistryHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        parsed = urlparse(self.path)
        suffix = Path(parsed.path).suffix.lower()
        if parsed.path in {"", "/"} or suffix in NO_CACHE_SUFFIXES:
            self.send_header("Cache-Control", "no-store, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()


def create_parser():
    parser = argparse.ArgumentParser(description="Serve the MTG Registry app.")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--directory", type=Path, required=True)
    return parser


if __name__ == "__main__":
    args = create_parser().parse_args()
    handler = partial(RegistryHandler, directory=args.directory)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Serving {args.directory} at http://{args.host}:{args.port}")
    server.serve_forever()
