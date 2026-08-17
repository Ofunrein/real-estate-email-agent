# Anchors pytest's rootdir at the repo root so `core`, `channels`, etc. are
# importable from tests/ without needing PYTHONPATH set manually or an
# __init__.py in tests/. No fixtures/config here on purpose.

import os
import sys

# The legacy `agent` module lives in deprecated/ (see deprecated/README.md).
# Several legacy scripts and tests still `import agent`, so keep that folder on
# sys.path for collection. Nothing here makes deprecated code part of runtime.
sys.path.append(os.path.join(os.path.dirname(__file__), "deprecated"))
