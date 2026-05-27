import unittest

from core.lead_matching import find_lead_index, normalize_email, normalize_name, normalize_phone


class LeadMatchingTests(unittest.TestCase):
    def test_normalize_phone_keeps_us_digits(self):
        self.assertEqual(normalize_phone("(512) 555-0199"), "15125550199")

    def test_normalize_email_lowercases(self):
        self.assertEqual(normalize_email(" Lead@Example.COM "), "lead@example.com")

    def test_normalize_name_collapses_space(self):
        self.assertEqual(normalize_name("  Jane   Smith "), "jane smith")

    def test_find_lead_index_prefers_phone(self):
        leads = [
            {"email": "wrong@example.com", "phone": "+15125550123", "full_name": "Wrong Person"},
            {"email": "lead@example.com", "phone": "", "full_name": "Lead Person"},
        ]
        self.assertEqual(find_lead_index(leads, {"email": "lead@example.com", "phone": "(512) 555-0123"}), 0)

    def test_find_lead_index_uses_email_after_phone(self):
        leads = [{"email": "lead@example.com", "phone": "", "full_name": "Lead Person"}]
        self.assertEqual(find_lead_index(leads, {"email": "LEAD@example.com", "phone": ""}), 0)

    def test_find_lead_index_uses_name_as_weak_fallback(self):
        leads = [{"email": "", "phone": "", "full_name": "Lead Person"}]
        self.assertEqual(find_lead_index(leads, {"email": "", "phone": "", "full_name": "lead person"}), 0)


if __name__ == "__main__":
    unittest.main()
