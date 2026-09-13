"""Deterministic preconditions shared by the Forgejo driver and its tests."""
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess

MODELS = ("Qwen3.6-35B-A3B-4bit", "Qwen3.8-27B-4bit")


def binding(title, body, base):
    return hashlib.sha256(json.dumps([title, body, base], separators=(",", ":")).encode()).hexdigest()


def child_env(home):
    return {"HOME": str(home), "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "LANG": "C.UTF-8", "PI_OFFLINE": "1"}


def run(args, *, env=None, timeout=600):
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, env=env, start_new_session=True)
    try:
        out, err = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.communicate()
        raise RuntimeError("Command timed out; no automatic retry")
    if process.returncode:
        raise RuntimeError(f"Command failed with exit {process.returncode}: {args[0]}")
    return out.strip()


def safe_paths(paths, protected):
    for path in paths:
        if (path.startswith((".forgejo/", ".github/", ".git", ".beads/"))
                or path in protected or ".." in Path(path).parts
                or any(p == ".env" or p.startswith(".env.") for p in Path(path).parts)
                or path.endswith((".pem", ".key"))):
            raise RuntimeError("Protected path changed; human review required")
    return paths
