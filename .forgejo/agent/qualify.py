#!/usr/bin/env python3
"""Manual inference qualification using disposable code and no publication token."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from driver import infer
from runtime import MODELS


def main():
    if os.environ.get("FORGEJO_TOKEN"):
        raise RuntimeError("Qualification must not receive a publication token")
    manifest = Path(os.environ["AGENT_SKILLS_MANIFEST"])
    manifest_hash = hashlib.sha256(manifest.read_bytes()).hexdigest()
    original = Path.cwd()
    # Restrict profile creation to the fixture tree, so cleanup can be asserted
    # without confusing another job's concurrent temporary profiles.
    previous_tempdir = tempfile.tempdir
    with tempfile.TemporaryDirectory(prefix="workflow-qualification-") as folder:
        root = Path(folder)
        tempfile.tempdir = str(root)
        try:
            os.chdir(root)
            Path("calculator.py").write_text("def add(a, b):\n    return a - b\n")
            test = "import unittest\nfrom calculator import add\nclass AdditionTests(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(add(2, 3), 5)\n"
            Path("test_calculator.py").write_text(test)
            argv = [sys.executable, "-m", "unittest", "discover"]
            red = subprocess.run(argv, capture_output=True, timeout=30)
            if red.returncode == 0 or b"AssertionError" not in red.stderr:
                raise RuntimeError("Fixture did not fail for its intended assertion")
            infer("Synthetic coding qualification in this disposable directory only. Read installed tdd, unslop, and session-closeout skills. Fix calculator.add to add two numbers. Run the existing unittest and verify red to green. Do not commit, publish, access credentials, or change the test. There is no issue tracker or project documentation to update. Keep the response concise.", {"model": MODELS[0], "inferenceTimeoutSeconds": 480}, True)
            if Path("test_calculator.py").read_text() != test:
                raise RuntimeError("Qualification test was modified")
            green = subprocess.run(argv, capture_output=True, timeout=30)
            if green.returncode != 0:
                raise RuntimeError("Qualification remained red")
            if list(root.glob("forgejo-pi-*")):
                raise RuntimeError("Temporary inference profile was not cleaned")
            print(json.dumps({"qualification": "passed", "model": MODELS[0],
                              "manifest_sha256": manifest_hash, "red_exit": red.returncode,
                              "green_exit": green.returncode, "profile_cleanup": True}))
        finally:
            os.chdir(original)
            tempfile.tempdir = previous_tempdir


if __name__ == "__main__":
    main()
