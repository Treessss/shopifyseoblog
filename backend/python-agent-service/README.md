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
- `POST /api/v1/content/quality-gate`
- `POST /api/v1/content/repair-plan`

The current Next.js worker still owns live article generation. This service is the staged backend for moving orchestration out of TypeScript.

## Architecture Notes

- `app/api/v1` owns versioned HTTP routes.
- `app/domain` owns business rules, scoring, and workflow plans.
- `app/schemas` defines Pydantic API contracts shared with the frontend migration layer.
- `app/services` stays as a thin compatibility layer for the current API.
- `app/integrations` will own Shopify, Search Console, queue, and storage adapters.
- `app/agents` stays as the agent registry layer and will be folded into `domain/agents` over time.
