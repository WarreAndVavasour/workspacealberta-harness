#!/usr/bin/env python3
"""Start one Managed Agents session per bid repo and print each run's handoff.

  export ANTHROPIC_API_KEY=...
  export BID_REPOS_TOKEN=...   # fine-grained GitHub token: Contents read/write on the bid-* repos only
  export WA_AGENT_ID=agent_... WA_ENVIRONMENT_ID=env_... WA_VAULT_ID=vlt_... WA_MEMORY_STORE_ID=memstore_...
  python3 run_bids.py                     # every open bid in bids.json
  python3 run_bids.py --repo bid-dfo-30008508-ai-interpretation-framework
"""
import argparse, datetime as dt, json, os, pathlib, sys

import anthropic

HERE = pathlib.Path(__file__).resolve().parent.parent
KICKOFF = (
    "Run the bid-room procedure in your system prompt for the repo mounted at /workspace/bid "
    "(reference {reference}). Today is {today} (America/Edmonton). Commit and push your work, "
    "then end with the handoff."
)


def open_bids(only):
    now = dt.datetime.now(dt.timezone.utc)
    for b in json.loads((HERE / "bids.json").read_text()):
        if only and not b["repo"].endswith("/" + only):
            continue
        if b["closes"] and dt.datetime.fromisoformat(b["closes"]) < now:
            continue
        yield b


def run(c, b):
    s = c.beta.sessions.create(
        agent=os.environ["WA_AGENT_ID"],
        environment_id=os.environ["WA_ENVIRONMENT_ID"],
        vault_ids=[os.environ["WA_VAULT_ID"]],
        title=f"Bid room: {b['repo'].split('/')[-1]}",
        resources=[
            {"type": "github_repository", "url": f"https://github.com/{b['repo']}",
             "mount_path": "/workspace/bid", "authorization_token": os.environ["BID_REPOS_TOKEN"]},
            {"type": "memory_store", "memory_store_id": os.environ["WA_MEMORY_STORE_ID"],
             "access": "read_write",
             "instructions": "W&V cross-bid knowledge. Read before analysing; add confirmed lessons after."},
        ],
    )
    today = dt.datetime.now().astimezone().date().isoformat()
    c.beta.sessions.events.send(s.id, events=[{"type": "user.message", "content": [
        {"type": "text", "text": KICKOFF.format(reference=b["reference"], today=today)}]}])
    print(f"\n=== {b['repo']}  session {s.id}")
    # VERIFY event type names against the API reference; this prints agent text and stops when idle.
    for ev in c.beta.sessions.events.stream(s.id):
        t = getattr(ev, "type", "")
        if t == "agent.message":
            for part in getattr(ev, "content", []) or []:
                if getattr(part, "type", "") == "text":
                    print(part.text)
        elif "error" in t:
            print(f"[{t}] {ev}", file=sys.stderr)
        if t in ("session.status_idle", "session.status_terminated"):
            break


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo")
    args = ap.parse_args()
    c = anthropic.Anthropic()
    for b in open_bids(args.repo):
        run(c, b)


if __name__ == "__main__":
    main()
