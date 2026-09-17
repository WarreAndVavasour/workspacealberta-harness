"""APC browser-session owner; only document receipts cross the MCP connection."""

import asyncio
import hashlib
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from playwright.async_api import async_playwright, TimeoutError as BrowserTimeout

APC_ORIGIN = "https://purchasing.alberta.ca"


def reference(value: str) -> str:
    """Accept an APC reference, never a model-supplied URL or filesystem path."""
    if not re.fullmatch(r"AB-\d{4}-\d{5,8}", value):
        raise ValueError("Expected an APC reference such as AB-2026-05716")
    return value


def atomic_json(path: Path, value: dict) -> None:
    """Replace a private receipt atomically; readers never observe partial JSON."""
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False, suffix=".tmp") as f:
        temporary = Path(f.name)
        f.write((json.dumps(value, indent=2) + "\n").encode())
        f.flush()
        os.fsync(f.fileno())
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


class Connector:
    """Serialize one local account's browser operations and preserve interrupted work.

    The origin/headless arguments are dependency injection for the local runnable
    example. The production entrypoint always uses APC and a visible browser.
    """

    def __init__(self, home: Path, *, origin=APC_ORIGIN, headless=False,
                 timeout_ms=20000, executable=None, max_documents=64, max_bytes=104857600):
        if timeout_ms <= 0 or max_documents <= 0 or max_bytes <= 0:
            raise ValueError("APC time, document count and byte limits must be positive")
        self.home = home.expanduser().resolve()
        self.origin = origin
        self.headless = headless
        self.timeout_ms = timeout_ms
        self.executable = executable
        self.max_documents = max_documents
        self.max_bytes = max_bytes
        self.lock = asyncio.Lock()
        self.runtime = None
        self.context = None
        self.page = None
        self.home.mkdir(parents=True, exist_ok=True, mode=0o700)
        if os.name != "nt":
            self.home.chmod(0o700)

    async def close(self):
        """Await browser shutdown so its profile can be reopened by the next run."""
        try:
            if self.context:
                await self.context.close()
        finally:
            if self.runtime:
                await self.runtime.stop()
            self.context = self.runtime = self.page = None

    async def browser(self):
        """Launch lazily: MCP tool discovery does not require a desktop display."""
        if self.context is None:
            self.runtime = await async_playwright().start()
            try:
                self.context = await self.runtime.chromium.launch_persistent_context(
                    str(self.home / "browser-profile"), headless=self.headless,
                    executable_path=self.executable, accept_downloads=True,
                    chromium_sandbox=True,
                    env={k: v for k, v in os.environ.items()
                         if not re.search(r"KEY|SECRET|TOKEN|PASSWORD", k, re.I)},
                )
            except Exception:
                await self.close()
                raise RuntimeError("APC browser could not start. Check the desktop display, "
                                   "installed Chromium, and whether this profile is already in use.") from None
        if self.page is None or self.page.is_closed():
            self.page = self.context.pages[0] if self.context.pages else await self.context.new_page()
            self.page.set_default_timeout(self.timeout_ms)
        return self.page

    async def state(self):
        """Read visible account controls without inspecting cookies or login fields."""
        page = await self.browser()
        connected = await page.get_by_role("button", name="Account", exact=True).count() > 0
        return {"status": "connected" if connected else "sign_in_required",
                "next_action": "Call apc_resume after signing in or completing verification."}

    async def connect(self):
        """Open APC's official sign-in on this host; the user enters credentials there."""
        async with self.lock:
            page = await self.browser()
            await page.goto(self.origin + "/supplier-login", wait_until="networkidle")
            await page.bring_to_front()
            return await self.state()

    async def status(self):
        """Check the current page without navigating away from an in-progress login."""
        async with self.lock:
            return await self.state()

    async def resume(self):
        """Retry the durable pending opportunity after a sign-in or verification handoff."""
        async with self.lock:
            path = self.home / "pending.json"
            if not path.exists():
                return await self.state()
            pending = json.loads(path.read_text(encoding="utf-8"))
            return await self._download(reference(pending["reference"]))

    async def download(self, opportunity: str):
        """Retrieve all visible posting documents, including amendments.

        APC adds the supplier to its interest list and subscribes it to updates.
        No submission or partnership action is performed.
        """
        opportunity = reference(opportunity)
        async with self.lock:
            atomic_json(self.home / "pending.json", {"reference": opportunity})
            return await self._download(opportunity)

    async def _download(self, opportunity):
        page = await self.browser()
        url = self.origin + "/posting/" + opportunity
        # Preserve the verification token on a resumed posting.
        if page.url != url:
            await page.goto(url, wait_until="networkidle")
        state = await self.state()
        if state["status"] != "connected":
            await page.goto(self.origin + "/supplier-login", wait_until="networkidle")
            await page.bring_to_front()
            return {**state, "reference": opportunity, "documents": []}
        rows = page.get_by_role("row").filter(
            has=page.get_by_role("button", name="Download", exact=True))
        count = await rows.count()
        if count == 0:
            raise RuntimeError("No downloadable rows found. Posting may be unavailable or APC layout changed.")
        if count > self.max_documents:
            raise RuntimeError("Posting exceeds configured document count limit")
        folder = self.home / "opportunities" / opportunity
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        documents = []
        atomic_json(folder / "manifest.json", {"reference": opportunity,
                    "complete": False, "expected_documents": count, "documents": []})
        for index in range(count):
            row = rows.nth(index)
            title = await row.get_by_role("cell").first.inner_text()
            try:
                async with page.expect_download(timeout=self.timeout_ms) as event:
                    await row.get_by_role("button", name="Download", exact=True).click()
                download = await event.value
            except BrowserTimeout:
                state = await self.state()
                verification = await page.get_by_role("heading", name="User verification").count() > 0
                status = "sign_in_required" if state["status"] != "connected" else (
                    "verification_required" if verification else "download_failed")
                await page.bring_to_front()
                return {"status": status, "reference": opportunity, "documents": documents,
                        "expected_documents": count, "next_action":
                        "Complete the APC step in the open browser, then call apc_resume. "
                        "No verification checks are bypassed."}
            suffix = Path(download.suggested_filename).suffix.lower()
            if suffix not in {".pdf", ".docx", ".doc", ".xlsx", ".xls", ".zip", ".dwg"}:
                raise RuntimeError("Unsupported document extension; inspect the posting manually.")
            with tempfile.NamedTemporaryFile(dir=folder, delete=False) as temporary:
                temp = Path(temporary.name)
            try:
                await download.save_as(temp)
                if temp.stat().st_size == 0:
                    raise RuntimeError("APC returned an empty document")
                if temp.stat().st_size > self.max_bytes:
                    raise RuntimeError("Document exceeds configured byte limit")
                with temp.open("rb") as content:
                    prefix = content.read(8)
                    if suffix == ".pdf" and not prefix.startswith(b"%PDF-"):
                        raise RuntimeError("Downloaded PDF is not a PDF; access may have expired")
                    if suffix in {".docx", ".xlsx", ".zip"} and not prefix.startswith(b"PK"):
                        raise RuntimeError("Downloaded Office/archive file has an invalid signature")
                    content.seek(0)
                    digest = hashlib.file_digest(content, "sha256").hexdigest()
                name = re.sub(r"[^a-zA-Z0-9_-]", "_", title)[:90] or "document"
                destination = folder / f"{name}-{digest[:16]}{suffix}"
                temp.replace(destination)
            finally:
                temp.unlink(missing_ok=True)
            documents.append({"title": title, "path": str(destination),
                              "sha256": digest, "bytes": destination.stat().st_size,
                              "source": url, "retrieved_at": datetime.now(timezone.utc).isoformat()})
            atomic_json(folder / "manifest.json", {"reference": opportunity,
                        "complete": False, "expected_documents": count, "documents": documents})
        receipt = {"reference": opportunity, "complete": True,
                   "expected_documents": count, "documents": documents}
        atomic_json(folder / "manifest.json", receipt)
        (self.home / "pending.json").unlink(missing_ok=True)
        return {"status": "downloaded", **receipt, "manifest": str(folder / "manifest.json")}
