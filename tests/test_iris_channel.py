import os
import unittest
from unittest.mock import patch

from channels.iris_email import is_enabled
from personalities.iris import IRIS_CHANNEL, IRIS_NAME


class IrisChannelTests(unittest.TestCase):
    def test_iris_identity(self):
        self.assertEqual(IRIS_NAME, "Iris")
        self.assertEqual(IRIS_CHANNEL, "email")

    def test_email_channel_enabled_by_default(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertTrue(is_enabled())

    def test_email_channel_can_be_disabled(self):
        with patch.dict(os.environ, {"ENABLE_EMAIL_AGENT": "false"}):
            self.assertFalse(is_enabled())


if __name__ == "__main__":
    unittest.main()
