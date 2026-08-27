import { Pool } from "pg";
import type { OnboardingIntake, OnboardingKey, OnboardingState } from "@/lib/onboarding";

let pool: Pool | null = null;
function db(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for onboarding persistence");
  pool ||= new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false } });
  return pool;
}

export type OnboardingSession = { id: string; client_id: string; state: OnboardingState; intake: OnboardingIntake; external_ids: Record<string, unknown> };

export async function upsertOnboardingIntake(input: {
  clientId: string; responseId: string; idempotencyKey: string; intake: OnboardingIntake;
  missingFields: OnboardingKey[]; submittedAt?: string;
}): Promise<OnboardingSession> {
  await db().query(`insert into clients (id, name) values ($1,$2) on conflict (id) do update set name=excluded.name, updated_at=now()`, [input.clientId, input.intake.company_name || input.clientId]);
  const result = await db().query(
    `insert into onboarding_sessions
       (client_id, provider, provider_response_id, idempotency_key, state, contact_email, company_name, intake, missing_fields, submitted_at)
     values ($1,'typeform',$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)
     on conflict (client_id, provider, provider_response_id) do update set
       intake=excluded.intake, missing_fields=excluded.missing_fields, contact_email=excluded.contact_email,
       company_name=excluded.company_name, submitted_at=excluded.submitted_at, updated_at=now()
     returning id, client_id, state, intake, external_ids`,
    [input.clientId, input.responseId, input.idempotencyKey, input.missingFields.length ? "blocked" : "intake_complete",
      input.intake.primary_contact_email, input.intake.company_name, JSON.stringify(input.intake), JSON.stringify(input.missingFields), input.submittedAt || null],
  );
  return result.rows[0] as OnboardingSession;
}

export async function recordOnboardingStep(sessionId: string, stepKey: string, status: string, providerId = "", detail: Record<string, unknown> = {}): Promise<void> {
  await db().query(
    `insert into onboarding_steps (session_id,step_key,status,provider_id,detail,started_at,completed_at)
     values ($1,$2,$3,$4,$5::jsonb,case when $3='running' then now() end,case when $3 in ('complete','blocked','failed','skipped') then now() end)
     on conflict (session_id,step_key) do update set status=excluded.status, provider_id=excluded.provider_id,
       detail=excluded.detail, started_at=coalesce(onboarding_steps.started_at,excluded.started_at), completed_at=excluded.completed_at, updated_at=now()`,
    [sessionId, stepKey, status, providerId, JSON.stringify(detail)],
  );
}

export async function updateOnboardingExternalIds(sessionId: string, externalIds: Record<string, unknown>, state?: OnboardingState): Promise<void> {
  await db().query(`update onboarding_sessions set external_ids=external_ids || $2::jsonb, state=coalesce($3,state), updated_at=now() where id=$1`, [sessionId, JSON.stringify(externalIds), state || null]);
}
