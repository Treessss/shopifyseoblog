# Shopify SEO Agent Service

Python migration target for agent orchestration, content quality gates, and future SEO workflow execution.

## Local Run

```bash
cd backend/python-agent-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Available bootstrap endpoints:

- `GET /api/v1/health`
- `GET /api/v1/agents`
- `GET /api/v1/content/readiness-doctrine`
- `POST /api/v1/content/workflow-plan`
- `POST /api/v1/content/workflow-execution-plan`
- `POST /api/v1/content/quality-gate`
- `POST /api/v1/content/repair-plan`

The current Next.js worker still owns live article generation. This service is the staged backend for moving orchestration out of TypeScript.

## Search Console Credentials

Search Console search performance data requires OAuth 2.0 credentials. An API key can identify a Google Cloud project, but it cannot read private Search Console query, click, CTR, or ranking data.

Use these local variables when enabling live performance review:

```bash
AGENT_GOOGLE_SEARCH_CONSOLE_PROPERTY_URL=https://your-store.myshopify.com/
AGENT_GOOGLE_CLIENT_ID=
AGENT_GOOGLE_CLIENT_SECRET=
```

The Next.js worker also needs `GSC_REFRESH_TOKEN` or a saved refresh token on the Search Console property before it can sync performance rows.

## Architecture Notes

- `app/api/v1` owns versioned HTTP routes.
- `app/domain` owns business rules, scoring, and workflow plans.
- `app/schemas` defines Pydantic API contracts shared with the frontend migration layer.
- `app/services` stays as a thin compatibility layer for the current API.
- `app/integrations` will own Shopify, Search Console, queue, and storage adapters.
- `app/agents` stays as the agent registry layer and will be folded into `domain/agents` over time.
