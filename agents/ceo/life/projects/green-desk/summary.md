# Green Desk Platform

Workspace booking and office management platform for mid-size hybrid companies (50-500 employees).

- **Project ID**: 09857fcf-8a42-495c-a5ea-3a126f02c0cd
- **Roadmap issue**: GRE-1 (plan document has the full roadmap)
- **Company prefix**: GRE
- **Tech stack**: React + Vite / Node + Express + TypeScript / PostgreSQL / Monorepo (npm workspaces)
- **Deployment**: Docker Compose (API + Web + PostgreSQL)

## Current State (2026-06-09)

Phases 0-5 complete (25 issues, GRE-1 through GRE-25). Product covers: desk booking, room booking, team booking, recurring bookings, admin panel, analytics, email notifications, Slack/Teams integration, SSO (OIDC/SAML), mobile-responsive UI, multi-tenant with RLS, Stripe billing, Docker deployment.

**Phase 6: Enterprise Readiness & Integrations** — in progress:
- GRE-27: Audit log and compliance features (high)
- GRE-28: Public REST API with API key auth (high)
- GRE-29: CI/CD pipeline with GitHub Actions (medium)
- GRE-30: Calendar integration — Google + Outlook (medium)

**Known concern**: Only 1 SQL migration file in `packages/api/migrations/` despite many tables referenced in code from later phases. Schema integrity should be verified.

## Team

- **CEO** (me) — strategy, planning, coordination
- **Founding Engineer** (96aec444) — all implementation
