"""Install the isolated connector runtime or launch the Cohere web harness with APC."""

import os
import shutil
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
PYTHON = HERE / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def main():
    """Keep installation explicit and use the repository's existing web composition."""
    if sys.version_info < (3, 11):
        raise SystemExit("APC connector requires Python 3.11 or later")
    if len(sys.argv) < 2 or sys.argv[1] not in {"setup", "start", "test", "config"}:
        raise SystemExit("Usage: python integrations/apc/run.py setup|start|test|config [harness arguments]")
    if sys.argv[1] == "setup":
        venv.EnvBuilder(with_pip=True).create(HERE / ".venv")
        subprocess.run([str(PYTHON), "-m", "pip", "install", "-r", str(HERE / "requirements.txt")], check=True)
        subprocess.run([str(PYTHON), "-m", "playwright", "install", "chromium"], check=True)
        return
    if not PYTHON.exists():
        raise SystemExit("Run python integrations/apc/run.py setup first")
    if sys.argv[1] == "test":
        subprocess.run([str(PYTHON), "-m", "unittest", "discover", "-s", str(HERE),
                        "-p", "test_connector.py"], check=True)
        subprocess.run([str(PYTHON), str(HERE / "example.py"), "--check"], check=True)
        return
    pnpm = shutil.which("pnpm")
    if not pnpm:
        raise SystemExit("pnpm is required to launch the harness")
    env = {**os.environ, "WA_APC_PYTHON": str(PYTHON), "DSH_TELEMETRY_DISABLED": "1"}
    arguments = ["--dump-config"] if sys.argv[1] == "config" else [
        "--host", "127.0.0.1", "--port", "3081", *sys.argv[2:]]
    raise SystemExit(subprocess.call([pnpm, "wa", "--profile", "web", "--patch",
        "workspace-alberta.patch.yml", "--patch", "workspace-alberta-apc.patch.yml",
        *arguments], cwd=ROOT, env=env))


if __name__ == "__main__":
    main()
