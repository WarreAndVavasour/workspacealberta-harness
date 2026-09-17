"""Runnable keyless MCP/browser example. The fixture never contacts APC.

Run `python integrations/apc/example.py` to exercise the shipping MCP tools
against a local website and print the normalized user-visible transcript.
"""

import asyncio
import hashlib
import json
import os
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from connector import Connector
from server import create_server


class Fixture(BaseHTTPRequestHandler):
    """Replace only the external portal; Chromium and the connector remain real."""
    def log_message(self, *args):
        pass  # HTTP request logs must not corrupt the stdio MCP stream.

    def do_GET(self):
        """Serve a supplier session and six deterministic document downloads."""
        if self.path.startswith("/file/"):
            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Disposition", 'attachment; filename="document.pdf"')
            self.end_headers()
            self.wfile.write(b"%PDF-1.4\n" + self.path.encode() + b"\n%%EOF\n")
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        if not self.server.authorized:
            body = '<h1>Supplier sign in</h1>'
        else:
            body = '<button>Account</button><h3>User verification</h3>'
            body += '<table>' + ''.join(
                f'<tr><td>Document {i}</td><td><button onclick="location.href=\'/file/{i}\'">Download</button></td></tr>'
                for i in range(6)) + '</table>'
        self.wfile.write(body.encode())


async def snapshot():
    """Run the actual stdio server and verify saved bytes independently of receipts."""
    portal = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
    portal.authorized = False
    worker = threading.Thread(target=portal.serve_forever, daemon=True)
    worker.start()
    transcript = []
    try:
        with tempfile.TemporaryDirectory() as home:
            params = StdioServerParameters(command=sys.executable,
                args=[str(Path(__file__).resolve()), "--server", home, str(portal.server_port)],
                env={k: v for k, v in os.environ.items()
                     if not any(x in k.upper() for x in ("KEY", "SECRET", "TOKEN", "PASSWORD"))})
            async with stdio_client(params) as (read, write):
                async with ClientSession(read, write) as client:
                    await client.initialize()
                    tools = await client.list_tools()
                    transcript.append({"tools": sorted(t.name for t in tools.tools)})
                    invalid = await client.call_tool("apc_download", {"opportunity": "../../escape"})
                    assert invalid.isError
                    transcript.append({"invalid_reference_rejected": invalid.isError})
                    result = await client.call_tool("apc_download", {"opportunity": "AB-2026-05716"})
                    assert not result.isError, result
                    transcript.append(json.loads(result.content[0].text))
                    portal.authorized = True
                    result = await client.call_tool("apc_resume", {})
                    assert not result.isError, result
                    receipt = json.loads(result.content[0].text)
                    assert receipt["status"] == "downloaded", receipt
                    for doc in receipt["documents"]:
                        data = Path(doc["path"]).read_bytes()
                        assert hashlib.sha256(data).hexdigest() == doc["sha256"]
                        assert len(data) == doc["bytes"]
                    manifest = json.loads(Path(receipt["manifest"]).read_text())
                    assert manifest["complete"] and len(manifest["documents"]) == 6
                    assert not Path(home, "pending.json").exists()
                    transcript.append({"status": receipt["status"], "complete": receipt["complete"],
                        "expected_documents": receipt["expected_documents"],
                        "verified_documents": [{"title": d["title"], "sha256": d["sha256"]}
                                               for d in receipt["documents"]]})
            assert len(list(Path(home, "opportunities").rglob("*.pdf"))) == 6
            transcript.append({"documents_survive_browser_shutdown": True})
    finally:
        portal.shutdown()
        portal.server_close()
        worker.join()
    return transcript


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--server":
        create_server(Connector(Path(sys.argv[2]),
            origin=f"http://127.0.0.1:{int(sys.argv[3])}", headless=True, timeout_ms=3000)).run()
    else:
        output = json.dumps(asyncio.run(snapshot()), indent=2) + "\n"
        if "--check" in sys.argv:
            expected = Path(__file__).with_name("example.expected.json").read_text(encoding="utf-8")
            assert output == expected, "APC MCP transcript differs from example.expected.json"
            print("APC runnable MCP/browser snapshot passed")
        else:
            print(output, end="")
