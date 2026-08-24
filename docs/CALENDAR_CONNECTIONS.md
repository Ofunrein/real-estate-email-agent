# Tenant calendar connections

Each isolated client deployment owns its calendar connection. OAuth tokens are held by Composio and the application stores only the tenant-scoped connected-account reference in Neon. A connection from one `CLIENT_ID` cannot be read or disconnected by another deployment.

## Required configuration

- `CLIENT_ID`: stable identifier unique to the isolated deployment.
- `DATABASE_URL`: that client's Neon database.
- `COMPOSIO_API_KEY`: isolated Composio project credential.
- `COMPOSIO_GOOGLE_CALENDAR_AUTH_CONFIG_ID` and/or `COMPOSIO_OUTLOOK_CALENDAR_AUTH_CONFIG_ID`: OAuth configuration for the provider.
- `PUBLIC_BASE_URL`: exact deployed origin used for the signed OAuth callback.
- `PROVIDER_OAUTH_STATE_SECRET` or `NEXTAUTH_SECRET`: signs the tenant- and user-bound OAuth state.
- `CALENDAR_TIMEZONE` and the `CALENDAR_*` policy values documented in `.env.example`.

Do not put provider refresh tokens in Neon or return them from application endpoints. `GOOGLE_REFRESH_TOKEN` remains a legacy migration path only.

## Connection lifecycle

1. An authenticated dashboard user starts OAuth with `GET /api/calendar/connect/google` or `/api/calendar/connect/outlook`.
2. The callback verifies the signed, expiring state, including provider and user identity, before reconciling the connected account.
3. `GET /api/calendar/connections` returns sanitized connection status. It never returns credentials or provider payloads.
4. `DELETE /api/calendar/connections?id=<connection-id>` revokes the hosted connected account first, then marks the tenant-scoped database row disconnected.

## Scheduling contract

All channel availability requests use `queryTenantAvailability`. Booking uses `bookTenantCalendarEvent`, which:

- reads current events directly from the authoritative provider;
- applies timezone-aware business days and hours, duration, step, notice, and buffers;
- treats provider errors as unavailable;
- rechecks the exact requested slot immediately before creation;
- serializes booking attempts for the isolated client with a PostgreSQL advisory transaction lock;
- sends an idempotency key to the provider adapter;
- refuses unverified GHL booking by default.

Iris email, Theo messaging, Aria voice, and Olivia website ultimately enter through the shared `bookAppointment` path. The Iris booking webhook calls the tenant calendar service directly before recording the internal appointment.

## Safe rollout

Keep `ENABLE_CROSS_CHANNEL_BOOKING=false` until a human has completed these checks for the isolated client:

1. Connect a non-production test calendar through the dashboard.
2. Verify `/api/calendar/connections` reports the intended account and provider.
3. Create a busy event manually and confirm availability excludes the event plus configured buffers.
4. Book one approved test appointment and verify exactly one external event and one Neon appointment exist.
5. Reschedule, cancel, and verify provider and Neon state.
6. Revoke the connection and confirm availability and booking fail closed.

Creating or deleting live provider events, deploying, changing DNS, and enabling channels remain explicit approval-gated operations.
