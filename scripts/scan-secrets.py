#!/usr/bin/env python3
"""Fail when tracked source contains likely live credentials."""

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SELF = Path(__file__).resolve().relative_to(ROOT).as_posix()
PATTERNS = {
    "Apify token": re.compile(rb"apify_" + rb"api_[A-Za-z0-9_-]{20,}"),
    "GitHub token": re.compile(rb"(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})"),
    "OpenAI token": re.compile(rb"sk-(?:proj-)?[A-Za-z0-9_-]{20,}"),
    "AWS access key": re.compile(rb"AKIA[0-9A-Z]{16}"),
    "Slack token": re.compile(rb"xox[baprs]-[A-Za-z0-9-]{20,}"),
    "Google API key": re.compile(rb"AIza[A-Za-z0-9_-]{30,}"),
    "Stripe secret": re.compile(rb"sk_" + rb"(?:live|test)_[A-Za-z0-9]{20,}"),
    "private key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "hardcoded secret": re.compile(
        rb"(?i)(?:api[_-]?key|auth[_-]?token|access[_-]?token|secret|password)"
        rb"\s*[=:]\s*[\"']([A-Za-z0-9_./+=-]{20,})[\"']"
    ),
}
SAFE_WORDS = (b"placeholder", b"your_", b"example", b"process.env", b"os.getenv")


def tracked_files() -> list[str]:
    output = subprocess.check_output(["git", "-C", str(ROOT), "ls-files", "-z"])
    return [item.decode("utf-8", "replace") for item in output.split(b"\0") if item]


def main() -> int:
    findings: list[tuple[str, int, str]] = []
    for relative in tracked_files():
        if relative == SELF:
            continue
        path = ROOT / relative
        try:
            data = path.read_bytes()
        except OSError:
            continue
        if b"\0" in data[:4096]:
            continue
        for name, pattern in PATTERNS.items():
            for match in pattern.finditer(data):
                value = match.group(1) if name == "hardcoded secret" else match.group(0)
                if any(word in value.lower() for word in SAFE_WORDS):
                    continue
                line = data.count(b"\n", 0, match.start()) + 1
                findings.append((relative, line, name))

    if findings:
        print(f"Secret scan failed: {len(findings)} potential credential(s)")
        for relative, line, name in findings[:20]:
            print(f"{relative}:{line}: {name}")
        if len(findings) > 20:
            print(f"... {len(findings) - 20} additional finding(s) omitted")
        return 1

    print(f"Secret scan passed: {len(tracked_files())} tracked files checked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
