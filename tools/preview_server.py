#!/usr/bin/env python3
"""Range-request-capable static file server for local preview.

Python 3.12's bundled http.server does NOT support HTTP Range requests,
which breaks video seeking in the browser. This server adds proper
Range support (status 206 + Content-Range + partial content) so that
video progress bars can be dragged to any position.

Usage:  python tools/preview_server.py [port]
Default port: 8367
"""

import os
import sys
import html
import urllib.parse
import mimetypes
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class RangeHTTPRequestHandler(SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler with proper HTTP Range (206) support."""

    # ---- helpers ----

    def guess_mime(self, path):
        """Return MIME type for *path*, with web-safe defaults."""
        ctype, _ = mimetypes.guess_type(path)
        if ctype is None:
            ctype = "application/octet-stream"
        # Common web overrides
        ext = os.path.splitext(path)[1].lower()
        if ext == ".js":
            return "text/javascript"
        if ext == ".css":
            return "text/css"
        if ext == ".json":
            return "application/json"
        if ext == ".svg":
            return "image/svg+xml"
        return ctype

    def parse_range(self, header, file_size):
        """Parse a single-range ``Range: bytes=start-end`` header.

        Returns ``(start, end)`` inclusive, or ``None`` if the header is
        absent or unsatisfiable.
        """
        if not header or not header.startswith("bytes="):
            return None
        spec = header[6:].strip()
        # We only support a single range (most browsers send exactly one)
        if "," in spec:
            spec = spec.split(",")[0].strip()
        try:
            start_s, end_s = spec.split("-", 1)
            start_s = start_s.strip()
            end_s = end_s.strip()
            if start_s == "" and end_s == "":
                return None
            if start_s == "":
                # Suffix range: last N bytes
                suffix = int(end_s)
                if suffix == 0:
                    return None
                start = max(0, file_size - suffix)
                end = file_size - 1
            else:
                start = int(start_s)
                if end_s == "":
                    end = file_size - 1
                else:
                    end = int(end_s)
            if start > end or start >= file_size:
                return None
            end = min(end, file_size - 1)
            return (start, end)
        except (ValueError, IndexError):
            return None

    # ---- main entry ----

    def do_GET(self):
        """Serve a GET request, honouring Range headers."""
        if self.path == "/favicon.ico":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            path = self.translate_path(urllib.parse.unquote(self.path))
        except Exception:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        if not os.path.isfile(path):
            # Directory listing or 404
            if os.path.isdir(path):
                return super().do_GET()
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return

        file_size = os.path.getsize(path)
        range_header = self.headers.get("Range")
        rng = self.parse_range(range_header, file_size)

        ctype = self.guess_mime(path)

        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND, "Cannot read file")
            return

        try:
            if rng is not None:
                start, end = rng
                length = end - start + 1
                f.seek(start)

                self.send_response(HTTPStatus.PARTIAL_CONTENT)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(length))
                self.send_header("Content-Range",
                                f"bytes {start}-{end}/{file_size}")
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()

                # Stream in chunks
                remaining = length
                while remaining > 0:
                    chunk = min(65536, remaining)
                    data = f.read(chunk)
                    if not data:
                        break
                    self.wfile.write(data)
                    remaining -= len(data)
            else:
                # Full file (no Range header)
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(file_size))
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                while True:
                    data = f.read(65536)
                    if not data:
                        break
                    self.wfile.write(data)
        except BrokenPipeError:
            pass  # client closed connection
        finally:
            f.close()

    def do_HEAD(self):
        """Serve a HEAD request with Range-aware headers."""
        try:
            path = self.translate_path(urllib.parse.unquote(self.path))
        except Exception:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        if not os.path.isfile(path):
            if os.path.isdir(path):
                return super().do_HEAD()
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        file_size = os.path.getsize(path)
        ctype = self.guess_mime(path)

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(file_size))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8367
    directory = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(directory)

    print("=" * 52)
    print("  Range-capable preview server")
    print(f"  URL:  http://127.0.0.1:{port}")
    print(f"  Root: {directory}")
    print("  (Close this window to stop)")
    print("=" * 52)

    handler = RangeHTTPRequestHandler
    handler.protocol_version = "HTTP/1.1"
    httpd = ThreadingHTTPServer(("0.0.0.0", port), handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        httpd.shutdown()


if __name__ == "__main__":
    main()
