# railway-provision-sandbox

A template for companies to deploy permissioned projects in a SSO/Trusted Domains workspace.

## Use Case

When an organization uses Railway with SSO or Trusted Domains, new members who join the workspace automatically get broad access. This service solves the problem of scoping new members to their own sandboxed project instead.

Users join the workspace as VIEWER (configured via the Trusted Domains default role in the Railway dashboard). When a user joins, this service:

1. **Creates a dedicated project** named after their email (e.g., `jane-doe-a3f2b1`)
2. **Grants them ADMIN** on that project only — they have full control within their sandbox

This gives organizations a self-service onboarding flow where each member gets an isolated environment to deploy into, without access to other members' projects or shared infrastructure.

## How It Works

The service runs as a webhook listener. You configure a Railway notification rule for the `WorkspaceMember.joined` event, pointing at this service's `/webhook` endpoint. When a new member joins via SSO/Trusted Domains, Railway fires the webhook and this service handles the rest.

```
WorkspaceMember.joined webhook
        │
        ▼
   POST /webhook
        │
        ▼
  1. Create sandboxed project
  2. Grant member → ADMIN on project
```

## Setup

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `RAILWAY_API_TOKEN` | Yes | API token with workspace admin permissions |
| `WORKSPACE_ID` | Yes | The workspace to provision projects in |
| `WEBHOOK_SECRET` | No | HMAC secret for verifying webhook signatures (recommended) |
| `PORT` | No | Server port (default: 3000) |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, or `error` (default: `info`) |

`RAILWAY_PUBLIC_DOMAIN` is automatically set by Railway when the service has a public domain.

### Deploy to Railway

1. Deploy this repo to your workspace
2. Set the environment variables above (set `WEBHOOK_SECRET` to a random string to secure the endpoint)
3. The service auto-creates its notification rule on startup — no manual dashboard config needed
4. New members joining via SSO/Trusted Domains will be automatically provisioned

When `WEBHOOK_SECRET` is set, the service passes it to Railway when creating the notification rule and verifies the `x-webhook-signature` HMAC-SHA256 header on every incoming request. Unsigned requests are rejected with 401.

### Run Locally

```sh
bun install
bun run dev
```

### Run Tests

```sh
bun test
```

## Endpoints

- `GET /health` — Health check
- `POST /webhook` — Receives `WorkspaceMember.joined` events
- `GET /` — Service identifier
