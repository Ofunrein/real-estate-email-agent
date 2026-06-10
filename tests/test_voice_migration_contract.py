import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


class VoiceMigrationContractTests(unittest.TestCase):
    def test_voice_calls_table_has_dashboard_columns(self):
        sql = read("db/migrations/003_voice.sql")
        self.assertIn("create table if not exists voice_calls", sql)
        for column in (
            "client_id",
            "call_id",
            "thread_ref",
            "direction",
            "duration_sec",
            "disposition",
            "intents text[]",
            "actions jsonb",
            "transcript",
            "recording_url",
        ):
            self.assertIn(column, sql, f"voice_calls missing column: {column}")

    def test_voice_calls_scoped_and_unique_per_client(self):
        sql = read("db/migrations/003_voice.sql")
        self.assertIn("references clients(id) on delete cascade", sql)
        self.assertIn("unique (client_id, call_id)", sql)
        self.assertIn("idx_voice_calls_client_created_at", sql)


if __name__ == "__main__":
    unittest.main()
