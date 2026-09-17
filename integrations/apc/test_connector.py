"""Real-browser handoff, restart, and download failure regressions."""

import json
import tempfile
import unittest
from pathlib import Path

from connector import Connector, reference


class BrowserTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.connector = Connector(Path(self.temp.name), headless=True, timeout_ms=1500)
        self.page = await self.connector.browser()
        await self.page.route("https://purchasing.alberta.ca/**", lambda route: route.fulfill(
            body='<button>Account</button><h3>User verification</h3>'
                 '<table><tr><td>Main RFP</td><td><button>Download</button></td></tr></table>',
            content_type="text/html"))

    async def asyncTearDown(self):
        await self.connector.close()
        self.temp.cleanup()

    async def test_verification_preserves_pending_work_across_restart(self):
        result = await self.connector.download("AB-2026-05716")
        self.assertEqual(result["status"], "verification_required")
        self.assertEqual(result["documents"], [])
        self.assertTrue(Path(self.temp.name, "pending.json").exists())
        await self.connector.context.add_cookies([{"name": "fixture", "value": "session",
            "domain": "purchasing.alberta.ca", "path": "/", "expires": 2000000000}])
        await self.connector.close()
        await self.connector.browser()
        cookies = await self.connector.context.cookies()
        self.assertTrue(any(c["name"] == "fixture" for c in cookies))
        self.assertEqual(json.loads(Path(self.temp.name, "pending.json").read_text())["reference"],
                         "AB-2026-05716")

    async def test_changed_posting_layout_is_not_download_success(self):
        await self.page.unroute_all()
        await self.page.route("**/*", lambda route: route.fulfill(body='<button>Account</button>'))
        with self.assertRaisesRegex(RuntimeError, "No downloadable rows"):
            await self.connector.download("AB-2026-05716")

    async def test_status_does_not_navigate_away_from_sign_in(self):
        await self.page.goto("https://purchasing.alberta.ca/supplier-login")
        await self.page.set_content('<input aria-label="Email Address">')
        before = self.page.url
        self.assertEqual((await self.connector.status())["status"], "sign_in_required")
        self.assertEqual(self.page.url, before)

    async def test_login_html_disguised_as_pdf_is_rejected(self):
        await self.page.unroute_all()
        async def portal(route):
            if route.request.url.endswith("/file"):
                await route.fulfill(body="<html>Please sign in</html>", headers={
                    "Content-Disposition": 'attachment; filename="rfp.pdf"'})
            else:
                await route.fulfill(body='<button>Account</button><table><tr><td>RFP</td><td>'
                    '<button onclick="location.href=\'/file\'">Download</button></td></tr></table>',
                    content_type="text/html")
        await self.page.route("**/*", portal)
        with self.assertRaisesRegex(RuntimeError, "not a PDF"):
            await self.connector.download("AB-2026-05716")
        manifest = json.loads(Path(self.temp.name, "opportunities", "AB-2026-05716",
                                   "manifest.json").read_text())
        self.assertFalse(manifest["complete"])
        self.assertEqual(manifest["documents"], [])
        self.assertEqual(list(Path(self.temp.name).rglob("*.pdf")), [])

    async def test_document_limit_fails_instead_of_truncating(self):
        self.connector.max_documents = 1
        await self.page.unroute_all()
        await self.page.route("**/*", lambda route: route.fulfill(
            content_type="text/html", body='<button>Account</button><table>' +
            '<tr><td>RFP</td><td><button>Download</button></td></tr>' * 2 + '</table>'))
        with self.assertRaisesRegex(RuntimeError, "document count limit"):
            await self.connector.download("AB-2026-05716")


class InputTests(unittest.TestCase):
    def test_invalid_runtime_limit_fails_at_startup(self):
        with self.assertRaises(ValueError):
            Connector(Path("unused"), timeout_ms=0)

    def test_references_reject_paths_urls_and_newlines(self):
        for value in ["../escape", "https://evil.example", "AB-2026-05716\n", "AB-2026-1"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                reference(value)


if __name__ == "__main__":
    unittest.main()
