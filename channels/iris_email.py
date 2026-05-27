from __future__ import annotations

import os

from agent import main as run_legacy_email_loop
from personalities.iris import IRIS_CHANNEL, IRIS_NAME


def is_enabled() -> bool:
    return os.getenv("ENABLE_EMAIL_AGENT", "true").strip().lower() in {"1", "true", "yes", "on"}


def run() -> None:
    if not is_enabled():
        print(f"{IRIS_NAME} {IRIS_CHANNEL} channel disabled by ENABLE_EMAIL_AGENT=false")
        return
    run_legacy_email_loop()


if __name__ == "__main__":
    run()
