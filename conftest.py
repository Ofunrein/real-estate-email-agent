# Anchors pytest's rootdir at the repo root so `core`, `channels`, etc. are
# importable from tests/ without needing PYTHONPATH set manually or an
# __init__.py in tests/. No fixtures/config here on purpose.
