# Mautic automation

This is the self-hosted GHL replacement for the `/apply` quiz funnel: contact store, score tags, segments, campaigns, and email follow-up.

## OCI host

1. Copy `.env.example` to `.env` and replace both values with different random passwords.
2. Run `docker compose up -d`.
3. Put HTTPS reverse proxy in front of `http://127.0.0.1:8080`.
4. Complete Mautic first-run setup, create an API-enabled admin user, then configure the website environment values below.

The `cron` service executes segment, campaign, and email queues every five minutes. Mautic is deliberately not exposed directly on port 80/443.

## Website environment

```text
MAUTIC_BASE_URL=https://automation.example.com
MAUTIC_USERNAME=api-admin
MAUTIC_PASSWORD=generated-password
```

`POST /api/lead` forwards valid quiz submissions to Mautic as contacts. It creates tags from `quiz`, result band, and optional score. Mautic campaigns own the follow-up sequence.
