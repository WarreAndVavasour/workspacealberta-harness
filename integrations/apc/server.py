"""Local stdio MCP entrypoint for the Workspace Alberta APC connector."""

import os
from contextlib import asynccontextmanager
from pathlib import Path

from mcp.server.fastmcp import FastMCP
from playwright.async_api import Error as BrowserError
from connector import Connector


def create_server(connector: Connector) -> FastMCP:
    """Expose fixed APC actions; no password, cookie, script, or arbitrary URL input."""
    @asynccontextmanager
    async def lifespan(server):
        try:
            yield {}
        finally:
            await connector.close()

    server = FastMCP("Workspace Alberta APC", lifespan=lifespan)

    async def safe(operation):
        try:
            return await operation
        except BrowserError:
            await connector.close()
            raise RuntimeError("APC browser operation failed. Check the open browser and retry; "
                               "the pending request is retained.") from None

    @server.tool()
    async def apc_connect() -> dict:
        """Open APC sign-in on the local desktop. User enters credentials in APC, never chat."""
        return await safe(connector.connect())

    @server.tool()
    async def apc_status() -> dict:
        """Check APC account status without interrupting the user's sign-in."""
        return await safe(connector.status())

    @server.tool()
    async def apc_download(opportunity: str) -> dict:
        """Download all documents/addenda for an AB-YYYY-NNNNN reference to local storage.

        Downloading adds the supplier to APC's interest list and subscribes it to
        updates. Use when the user authorizes document retrieval. Returns a handoff
        if login/verification is required; call apc_resume after the user finishes.
        Never treat a handoff or partial receipt as a completed RFP review.
        """
        return await safe(connector.download(opportunity))

    @server.tool()
    async def apc_resume() -> dict:
        """Resume pending retrieval after the user signs in or completes APC verification."""
        return await safe(connector.resume())
    return server


if __name__ == "__main__":
    create_server(Connector(
        Path(os.environ.get("WA_APC_HOME", str(Path.home() / ".workspacealberta" / "apc"))),
        timeout_ms=int(os.environ.get("WA_APC_TIMEOUT_MS", "20000")),
        executable=os.environ.get("WA_APC_CHROMIUM"),
        max_documents=int(os.environ.get("WA_APC_MAX_DOCUMENTS", "64")),
        max_bytes=int(os.environ.get("WA_APC_MAX_BYTES", "104857600")),
    )).run()
