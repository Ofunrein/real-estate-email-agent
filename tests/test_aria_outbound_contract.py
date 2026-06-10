import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


class AriaOutboundContractTests(unittest.TestCase):
    def test_outbound_route_secret_gated_and_uses_vapi(self):
        route = read("app/api/aria/outbound/route.ts")
        self.assertIn("assertWebhookSecret(request)", route)
        self.assertIn("placeOutboundCall", route)

    def test_outbound_posts_expected_vapi_fields(self):
        outbound = read("lib/outbound.ts")
        self.assertIn("assistantId: config.assistantId", outbound)
        self.assertIn("phoneNumberId: config.phoneNumberId", outbound)
        self.assertIn("customer: { number: input.customerNumber }", outbound)

    def test_followup_queue_uses_shared_cadence(self):
        script = read("scripts/aria-followup-queue.mjs")
        self.assertIn("selectVoiceFollowups", script)
        self.assertIn("--live", script)


if __name__ == "__main__":
    unittest.main()
