#!/usr/bin/env python3
import argparse
from functools import partial
import gzip
from io import BytesIO
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from http import HTTPStatus
from pathlib import Path
from urllib.parse import urlparse

NO_CACHE_SUFFIXES = {".html", ".js", ".css"}
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".avif"}
PRECOMPRESSED_SUFFIXES = {".json", ".js"}
TEXT_GZIP_SUFFIXES = {".css", ".js", ".html"}


def accepts_gzip(value):
    for item in value.split(","):
        parts = [part.strip() for part in item.split(";")]
        if not parts or parts[0].lower() != "gzip":
            continue
        for param in parts[1:]:
            if param.lower().replace(" ", "") == "q=0":
                return False
        return True
    return False


class RegistryHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def send_head(self):
        parsed = urlparse(self.path)
        suffix = Path(parsed.path).suffix.lower()
        if parsed.path in {"", "/"}:
            generated_index = Path(self.directory) / "data" / "index.html"
            if generated_index.is_file():
                try:
                    raw_bytes = generated_index.read_bytes()
                except OSError:
                    self.send_error(HTTPStatus.NOT_FOUND, "File not found")
                    return None

                accept_gzip = accepts_gzip(self.headers.get("Accept-Encoding", ""))
                response_bytes = (
                    gzip.compress(raw_bytes, compresslevel=6, mtime=0)
                    if accept_gzip
                    else raw_bytes
                )
                stat = generated_index.stat()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-type", "text/html")
                if accept_gzip:
                    self.send_header("Content-Encoding", "gzip")
                    self.send_header("Vary", "Accept-Encoding")
                self.send_header("Content-Length", str(len(response_bytes)))
                self.send_header("Last-Modified", self.date_time_string(stat.st_mtime))
                self.end_headers()
                return BytesIO(response_bytes)

        accept_gzip = accepts_gzip(self.headers.get("Accept-Encoding", ""))
        if suffix in PRECOMPRESSED_SUFFIXES and accept_gzip:
            raw_path = Path(self.translate_path(parsed.path))
            gz_path = raw_path.with_suffix(raw_path.suffix + ".gz")
            if gz_path.is_file():
                try:
                    f = gz_path.open("rb")
                except OSError:
                    self.send_error(HTTPStatus.NOT_FOUND, "File not found")
                    return None

                stat = gz_path.stat()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-type", self.guess_type(str(raw_path)))
                self.send_header("Content-Encoding", "gzip")
                self.send_header("Content-Length", str(stat.st_size))
                self.send_header("Last-Modified", self.date_time_string(stat.st_mtime))
                self.end_headers()
                return f

        if suffix in TEXT_GZIP_SUFFIXES and accept_gzip:
            raw_path = Path(self.translate_path(parsed.path))
            if raw_path.is_file():
                try:
                    raw_bytes = raw_path.read_bytes()
                except OSError:
                    self.send_error(HTTPStatus.NOT_FOUND, "File not found")
                    return None

                gz_bytes = gzip.compress(raw_bytes, compresslevel=6, mtime=0)
                stat = raw_path.stat()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-type", self.guess_type(str(raw_path)))
                self.send_header("Content-Encoding", "gzip")
                self.send_header("Content-Length", str(len(gz_bytes)))
                self.send_header("Last-Modified", self.date_time_string(stat.st_mtime))
                self.end_headers()
                return BytesIO(gz_bytes)

        return super().send_head()

    def end_headers(self):
        parsed = urlparse(self.path)
        suffix = Path(parsed.path).suffix.lower()
        if suffix in PRECOMPRESSED_SUFFIXES:
            self.send_header("Vary", "Accept-Encoding")
        if parsed.path.startswith("/data/sets/") and suffix == ".json":
            self.send_header(
                "Cache-Control",
                "public, max-age=31536000, immutable",
            )
        elif parsed.path == "/data/bootstrap.js":
            self.send_header(
                "Cache-Control",
                "public, max-age=300, stale-while-revalidate=3600",
            )
        elif parsed.path.startswith("/data/images/") and suffix in IMAGE_SUFFIXES:
            self.send_header(
                "Cache-Control",
                "public, max-age=31536000, immutable",
            )
        elif (
            parsed.path in {"", "/"}
            or parsed.path == "/data/manifest.json"
            or suffix in NO_CACHE_SUFFIXES
        ):
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
