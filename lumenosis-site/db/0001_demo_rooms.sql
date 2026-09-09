CREATE TABLE IF NOT EXISTS prospects (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  email TEXT NOT NULL,
  business_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'REALTOR®',
  sender_inbox TEXT NOT NULL DEFAULT 'iris-demo@agentmail.to',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL,
  price INTEGER NOT NULL,
  beds REAL NOT NULL,
  baths REAL NOT NULL,
  square_feet INTEGER NOT NULL,
  acreage REAL NOT NULL,
  mls TEXT NOT NULL,
  details_json TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  verified_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS demo_rooms (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  config_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS outreach_drafts (
  id TEXT PRIMARY KEY,
  demo_room_id TEXT NOT NULL UNIQUE REFERENCES demo_rooms(id) ON DELETE CASCADE,
  sender_name TEXT NOT NULL,
  sender_inbox TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  sent_at TEXT,
  provider_message_id TEXT
);

CREATE TABLE IF NOT EXISTS engagement_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  demo_room_id TEXT NOT NULL REFERENCES demo_rooms(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  duration_seconds INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_demo_rooms_status ON demo_rooms(status);
CREATE INDEX IF NOT EXISTS idx_events_demo_room ON engagement_events(demo_room_id, created_at);
