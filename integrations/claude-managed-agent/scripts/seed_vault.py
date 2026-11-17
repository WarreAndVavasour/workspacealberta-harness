#!/usr/bin/env python3
"""Sign in to workspaceAlberta once and store the OAuth credential in a Managed Agents vault.

Run on a machine with a browser (the Pi is fine). Secrets are read from the environment, never
from arguments, and are never printed.

  export ANTHROPIC_API_KEY=...          # Claude Platform key (do NOT put this in a vault)
  export COHERE_API_KEY=...             # optional: only if the agent should call Cohere directly
  python3 seed_vault.py [--vault-id vlt_...]

Prints the vault id. Re-run with --vault-id to rotate the credential after a refresh failure.
"""
import argparse, base64, datetime as dt, hashlib, http.server, json, os, secrets, sys
import urllib.parse, urllib.request, webbrowser

import anthropic  # pip install anthropic

MCP_URL = "https://elbowsupknivesout.warreandvavasour.com/mcp"
ISSUER = "https://elbowsupknivesout.warreandvavasour.com"
REDIRECT = "http://127.0.0.1:8765/callback"
SCOPE = "pro offline_access"


def post_json(url, body):
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=30))


def post_form(url, body):
    req = urllib.request.Request(url, urllib.parse.urlencode(body).encode(),
                                 {"Content-Type": "application/x-www-form-urlencoded"})
    return json.load(urllib.request.urlopen(req, timeout=30))


def oauth_tokens():
    meta = json.load(urllib.request.urlopen(f"{ISSUER}/.well-known/oauth-authorization-server", timeout=30))
    client = post_json(meta["registration_endpoint"], {
        "client_name": "W&V Bid Room Agent (Claude Managed Agents)",
        "redirect_uris": [REDIRECT],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "scope": SCOPE,
    })
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    url = meta["authorization_endpoint"] + "?" + urllib.parse.urlencode({
        "response_type": "code", "client_id": client["client_id"], "redirect_uri": REDIRECT,
        "scope": SCOPE, "state": state, "code_challenge": challenge, "code_challenge_method": "S256",
        "resource": MCP_URL,
    })
    got = {}

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            got.update({k: v[0] for k, v in q.items()})
            self.send_response(200); self.end_headers()
            self.wfile.write(b"Signed in. You can close this tab.")

        def log_message(self, *a):
            pass

    print("Opening the workspaceAlberta sign-in page. If it doesn't open, visit:\n" + url)
    webbrowser.open(url)
    http.server.HTTPServer(("127.0.0.1", 8765), H).handle_request()
    if got.get("state") != state or "code" not in got:
        sys.exit("Sign-in failed or was cancelled.")
    tok = post_form(meta["token_endpoint"], {
        "grant_type": "authorization_code", "code": got["code"], "redirect_uri": REDIRECT,
        "client_id": client["client_id"], "code_verifier": verifier, "resource": MCP_URL,
    })
    if "refresh_token" not in tok:
        sys.exit("No refresh token returned; the agent would lose access when the token expires.")
    return meta, client, tok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vault-id")
    args = ap.parse_args()
    meta, client, tok = oauth_tokens()
    expires = dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=int(tok.get("expires_in", 3600)))

    c = anthropic.Anthropic()
    vault_id = args.vault_id or c.beta.vaults.create(
        display_name="W&V bid room", metadata={"purpose": "workspacealberta-bid-agent"}).id

    c.beta.vaults.credentials.create(vault_id=vault_id, display_name="workspaceAlberta Pro (OAuth)", auth={
        "type": "mcp_oauth",
        "mcp_server_url": MCP_URL,
        "access_token": tok["access_token"],
        "expires_at": expires.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "refresh": {
            "token_endpoint": meta["token_endpoint"],
            "client_id": client["client_id"],
            "scope": SCOPE,
            "refresh_token": tok["refresh_token"],
            "token_endpoint_auth": {"type": "none"},
        },
    })

    if os.environ.get("COHERE_API_KEY"):
        # Substituted at egress, only for api.cohere.com. The sandbox only ever sees a placeholder.
        c.beta.vaults.credentials.create(vault_id=vault_id, display_name="Cohere API key", auth={
            "type": "environment_variable",
            "secret_name": "COHERE_API_KEY",
            "secret_value": os.environ["COHERE_API_KEY"],
            "networking": {"type": "limited", "allowed_hosts": ["api.cohere.com"]},
            "injection_location": {"header": True},
        })

    print(f"vault_id={vault_id}")


if __name__ == "__main__":
    main()
