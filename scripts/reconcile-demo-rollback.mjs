#!/usr/bin/env node
// Preserve Postgres-only activity before returning the incomplete cutover to Turso.
// No sends, approvals, token regeneration, deletions, or Postgres writes.
import pg from 'pg';
const apply = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
const url = process.env.LUMENOSIS_TURSO_DATABASE_URL.replace(/^libsql:/, 'https:').replace(/\/$/, '') + '/v2/pipeline';
const token = process.env.LUMENOSIS_TURSO_AUTH_TOKEN;
const arg = value => value === null ? {type:'null'} : typeof value === 'number' ? {type:'integer',value:String(value)} : {type:'text',value:String(value)};
async function sql(sql, args = []) {
  const r = await fetch(url, {method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({requests:[{type:'execute',stmt:{sql,args:args.map(arg)}}]})});
  if (!r.ok) throw Error(`Turso HTTP ${r.status}`);
  const j = await r.json(); const result = j.results[0]?.response?.result;
  if (!result) throw Error('Turso SQL failed');
  return result.rows.map(row => Object.fromEntries(result.cols.map((c,i)=>[c.name,row[i].type === 'null' ? null : row[i].value])));
}
try {
  // Fail closed on Neon-only entities or divergence in send/approval records.
  for (const [source,target] of [['prospects','demo_prospects'],['listings','demo_listings'],['demo_rooms','demo_rooms'],['outreach_drafts','demo_outreach_drafts']]) {
    const left = await sql(`SELECT * FROM ${source}`);
    const right = (await pool.query(`SELECT * FROM ${target} WHERE client_id = $1`, ['default'])).rows;
    const map = new Map(left.map(row=>[row.id,row]));
    for (const row of right) {
      const existing = map.get(row.id);
      if (!existing) throw Error(`Neon-only entity in ${target}; manual reconciliation required`);
      for (const key of Object.keys(existing)) {
        if (key in row && String(existing[key] ?? '') !== String(row[key] ?? '')) {
          throw Error(`Divergent ${target}.${key}; refusing rollback`);
        }
      }
    }
    console.log(`${source}: source=${left.length}, target=${right.length}, overlapping rows match`);
  }
  const events = (await pool.query('SELECT id, client_id, demo_room_id, event, duration_seconds, created_at FROM demo_engagement_events WHERE source_rowid IS NULL ORDER BY id')).rows;
  if (events.some(e=>e.client_id !== 'default')) throw Error('Unexpected tenant');
  console.log(`Neon-native events=${events.length}; apply=${apply}`);
  if (apply) {
    // Each event uses one atomic batch, with a durable key for retries.
    await sql('CREATE TABLE IF NOT EXISTS demo_neon_event_imports (neon_id TEXT PRIMARY KEY, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    for (const e of events) {
      const key = `${e.client_id}:${e.id}`;
      const statements = [
        {sql:"INSERT INTO engagement_events (demo_room_id,event,duration_seconds,created_at) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM demo_neon_event_imports WHERE neon_id=?)", args:[e.demo_room_id,e.event,e.duration_seconds,e.created_at,key].map(arg)},
        {sql:'INSERT OR IGNORE INTO demo_neon_event_imports(neon_id) VALUES (?)',args:[arg(key)]},
      ];
      const r = await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({requests:[{type:'batch',batch:{steps:[{stmt:{sql:'BEGIN IMMEDIATE'}},...statements.map((stmt,i)=>({condition:{type:'ok',step:i},stmt})),{condition:{type:'ok',step:2},stmt:{sql:'COMMIT'}},{condition:{type:'not',cond:{type:'ok',step:3}},stmt:{sql:'ROLLBACK'}}]}}]})});
      const j=await r.json();
      const batch=j.results?.[0]?.response?.result;
      if (!r.ok || !batch || batch.step_errors?.some(Boolean)) throw Error('Event import transaction failed');
      const found=await sql('SELECT neon_id FROM demo_neon_event_imports WHERE neon_id=?',[key]);
      if(found.length!==1) throw Error('Event import readback failed');
    }
    console.log('Every native event has a verified durable import key; safe to rerun after deployment drain.');
  }
} finally { await pool.end(); }
