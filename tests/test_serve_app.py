import importlib.util
import threading
import urllib.request
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "serve_app.py"
SPEC = importlib.util.spec_from_file_location("serve_app", SCRIPT)
serve_app = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(serve_app)


def test_versioned_shell_assets_are_not_cached_immutably(tmp_path):
    (tmp_path / "script.js").write_text("console.log('ok')")
    handler = partial(serve_app.RegistryHandler, directory=str(tmp_path))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_address[1]
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/script.js?v=manual", timeout=10
        ) as response:
            assert response.status == 200
            assert response.headers["Cache-Control"] == "no-store, max-age=0"
    finally:
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()
