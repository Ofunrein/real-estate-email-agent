import json
import os
from collections import Counter, defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from dotenv import load_dotenv

from agent import get_gmail_service
from core.sheet_schema import CONVERSATION_EVENTS_TAB, LEAD_MEMORY_TAB
from core.sheets_store import read_table


def group_events_by_thread(events: list[dict]) -> dict[str, list[dict]]:
    grouped = defaultdict(list)
    for event in events:
        grouped[event.get("thread_ref") or "unknown"].append(event)
    return dict(grouped)


def build_metrics(leads: list[dict], events: list[dict]) -> dict:
    channels = Counter(event.get("channel") or "unknown" for event in events)
    needs_human = sum(1 for lead in leads if lead.get("handoff_status") == "needs_human")
    needs_human += sum(1 for event in events if event.get("status") == "needs_human")
    return {
        "lead_count": len(leads),
        "event_count": len(events),
        "needs_human": needs_human,
        "channels": dict(channels),
    }


def load_inbox_data(sheets, spreadsheet_id: str) -> dict:
    leads = read_table(sheets, spreadsheet_id, LEAD_MEMORY_TAB)
    events = read_table(sheets, spreadsheet_id, CONVERSATION_EVENTS_TAB)
    return {
        "leads": leads,
        "events": events,
        "metrics": build_metrics(leads, events),
        "threads": group_events_by_thread(events),
    }


def render_index() -> str:
    return """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Inbox</title>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #17201b; background: #f4f1eb; }
    .layout { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
    nav { background: #17201b; color: #f8f2e8; padding: 24px 16px; }
    nav h1 { font-size: 20px; margin: 0 0 24px; }
    nav button { width: 100%; text-align: left; border: 0; background: transparent; color: inherit; padding: 10px 12px; border-radius: 6px; font-size: 15px; cursor: pointer; }
    nav button.active { background: #d85c3a; color: white; }
    main { padding: 24px; }
    .cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
    .card { background: white; border: 1px solid #ddd7cd; border-radius: 8px; padding: 14px; }
    .card strong { display: block; font-size: 28px; }
    .panel { background: white; border: 1px solid #ddd7cd; border-radius: 8px; overflow: hidden; }
    .row { display: grid; grid-template-columns: 170px 1fr 140px; gap: 12px; padding: 12px 14px; border-top: 1px solid #eee7dd; }
    .row:first-child { border-top: 0; }
    .thread { padding: 14px; border-top: 1px solid #eee7dd; }
    .message { background: #f8f6f1; border-radius: 8px; padding: 10px; margin-top: 8px; white-space: pre-wrap; }
    @media (max-width: 760px) { .layout { grid-template-columns: 1fr; } nav { position: sticky; top: 0; } .cards { grid-template-columns: 1fr 1fr; } .row { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="layout">
    <nav>
      <h1>Agent Inbox</h1>
      <button class="active" data-view="overview">Overview</button>
      <button data-view="leads">Leads</button>
      <button data-view="email">Email</button>
      <button data-view="events">Events</button>
      <button data-view="metrics">Metrics</button>
    </nav>
    <main id="app">Loading...</main>
  </div>
  <script>
    let data = null;
    let view = "overview";
    const app = document.getElementById("app");
    document.querySelectorAll("nav button").forEach(button => {
      button.addEventListener("click", () => {
        document.querySelectorAll("nav button").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        view = button.dataset.view;
        render();
      });
    });
    async function loadData() {
      const response = await fetch("/api/data");
      data = await response.json();
      render();
    }
    function card(label, value) {
      return `<div class="card"><span>${label}</span><strong>${value}</strong></div>`;
    }
    function overview() {
      const m = data.metrics;
      return `<div class="cards">${card("Leads", m.lead_count)}${card("Events", m.event_count)}${card("Needs human", m.needs_human)}${card("Email events", m.channels.email || 0)}</div>${eventsList(data.events.slice(-20).reverse())}`;
    }
    function leads() {
      return `<div class="panel">${data.leads.map(lead => `<div class="row"><strong>${lead.full_name || lead.email || lead.phone || "Unknown"}</strong><span>${lead.summary || lead.intent || ""}</span><span>${lead.next_action || ""}</span></div>`).join("") || "<div class='row'>No leads yet</div>"}</div>`;
    }
    function eventsList(events) {
      return `<div class="panel">${events.map(event => `<div class="row"><strong>${event.channel || "unknown"} / ${event.event_type || ""}</strong><span>${event.summary || event.message_text || ""}</span><span>${event.status || ""}</span></div>`).join("") || "<div class='row'>No events yet</div>"}</div>`;
    }
    function emailThreads() {
      const threads = Object.entries(data.threads).filter(([, events]) => events.some(event => event.channel === "email"));
      return `<div class="panel">${threads.map(([thread, events]) => `<div class="thread"><strong>${thread}</strong>${events.map(event => `<div class="message">${event.direction || ""} ${event.agent_name || ""}\\n${event.message_text || event.summary || ""}</div>`).join("")}</div>`).join("") || "<div class='row'>No email threads yet</div>"}</div>`;
    }
    function render() {
      if (!data) return;
      if (view === "overview") app.innerHTML = overview();
      if (view === "leads") app.innerHTML = leads();
      if (view === "email") app.innerHTML = emailThreads();
      if (view === "events") app.innerHTML = eventsList(data.events.slice().reverse());
      if (view === "metrics") app.innerHTML = `<pre>${JSON.stringify(data.metrics, null, 2)}</pre>`;
    }
    loadData();
    setInterval(loadData, 15000);
  </script>
</body>
</html>"""


class AgentInboxHandler(BaseHTTPRequestHandler):
    sheets = None
    spreadsheet_id = ""

    def _send(self, body: str, content_type: str = "text/html") -> None:
        encoded = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/data":
            data = load_inbox_data(self.sheets, self.spreadsheet_id)
            self._send(json.dumps(data), "application/json")
            return
        self._send(render_index())


def run(host: str = "127.0.0.1", port: int = 8787) -> None:
    load_dotenv()
    spreadsheet_id = os.getenv("GOOGLE_SHEET_ID", "").strip()
    if not spreadsheet_id:
        raise RuntimeError("GOOGLE_SHEET_ID is required")
    _, sheets = get_gmail_service()
    AgentInboxHandler.sheets = sheets
    AgentInboxHandler.spreadsheet_id = spreadsheet_id
    server = ThreadingHTTPServer((host, port), AgentInboxHandler)
    print(f"Agent Inbox running at http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run(port=int(os.getenv("AGENT_INBOX_PORT", "8787")))
