import importlib
import unittest


class IrisStyleTrainingTests(unittest.TestCase):
    def setUp(self):
        import agent
        self.agent = agent
        self.agent._STYLE_TRAINING_CACHE.clear()
        self._orig_enabled = self.agent.ENABLE_STYLE_TRAINING
        self._orig_db = self.agent.DATABASE_URL

    def tearDown(self):
        self.agent.ENABLE_STYLE_TRAINING = self._orig_enabled
        self.agent.DATABASE_URL = self._orig_db
        self.agent._STYLE_TRAINING_CACHE.clear()

    def test_flag_off_is_identity(self):
        self.agent.ENABLE_STYLE_TRAINING = False
        self.assertEqual(self.agent._style_suffix(), "")
        self.assertEqual(self.agent._with_style("SYSTEM PROMPT"), "SYSTEM PROMPT")

    def test_flag_on_bad_db_is_failsafe(self):
        # Enabled but DB unreachable -> must degrade to "" (never break Iris).
        self.agent.ENABLE_STYLE_TRAINING = True
        self.agent.DATABASE_URL = "postgresql://invalid:invalid@127.0.0.1:1/none"
        self.agent._STYLE_TRAINING_CACHE.clear()
        self.assertEqual(self.agent._style_suffix(), "")
        self.assertEqual(self.agent._with_style("SYS"), "SYS")

    def test_with_style_appends_cached_block(self):
        # Simulate a fetched block in cache and confirm it is appended.
        self.agent.ENABLE_STYLE_TRAINING = True
        self.agent.DATABASE_URL = "postgresql://x"
        self.agent._STYLE_TRAINING_CACHE["block"] = "\n\nVOICE_BLOCK"
        self.assertEqual(self.agent._with_style("SYS"), "SYS\n\nVOICE_BLOCK")


if __name__ == "__main__":
    unittest.main()
