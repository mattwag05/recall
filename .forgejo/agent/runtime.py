"""Deterministic preconditions shared by the Forgejo driver and its tests."""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess

# Cloud first (2026-11-15): Manifest harness `pi` routes `auto` to glm-5.3 and falls back to Splash itself.
MODELS = ("auto", "Qwen3.8-27B-Splash")
QWEN_SAMPLING = {"temperature": 0.7, "top_p": 0.8, "top_k": 20, "min_p": 0.0,
                 "repetition_penalty": 1.0, "chat_template_kwargs": {"enable_thinking": False}}


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
        # Remote URLs in git stderr can carry userinfo (user:token@host); drop it before surfacing.
        detail = re.sub(r"(\w+://)[^/\s@]*@", r"\1***@", err.strip())[-500:]
        raise RuntimeError(f"Command failed with exit {process.returncode}: {args[0]}" + (f": {detail}" if detail else ""))
    return out.strip()


def safe_paths(paths, protected):
    for path in paths:
        if (path.startswith((".forgejo/", ".github/", ".git", ".beads/"))
                or path in protected or ".." in Path(path).parts
                or any(p == ".env" or p.startswith(".env.") for p in Path(path).parts)
                or path.endswith((".pem", ".key"))):
            raise RuntimeError("Protected path changed; human review required")
    return paths
