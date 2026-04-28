# PingMaster

PingMaster is a full-stack monitoring and incident response platform for websites and web endpoints. It combines uptime checks, performance insights, alerts, maintenance scheduling, public status pages, and AI-assisted incident workflows in one workspace-based system.

The product is built around a simple idea: detection alone is not enough. A monitoring system should also explain what changed, what matters most, and what should be handled first.

## What PingMaster Does

- Tracks website and endpoint health with recurring checks
- Records incidents and supports updates, resolution notes, and shared response workflows
- Sends alerts through configured delivery channels
- Supports scheduled maintenance windows and suppresses pings or alerts during active maintenance
- Publishes public-facing status pages for service communication
- Uses the PageSpeed Insights API and Gemini-powered analysis to add performance context and action-oriented reporting
- Supports workspace-based collaboration with email invites and shared operational resources

## Product Areas

### Monitoring

PingMaster treats monitoring as more than simple uptime tracking. Each monitor carries current state, recent behavior, latency context, and a rolling summary used across the dashboard, status page, and incident workflows.

### Incident Response

Incidents are tied to monitored services and handled inside the same system. The app supports incident creation, updates, resolution, and AI-generated suggestions for creation and closure so operators can move faster without losing control of the message.

### Performance Insight

For eligible webpage-style targets, PingMaster uses the PageSpeed Insights API to pull normalized performance signals. These signals are reused in monitor reports so the platform can surface both reliability issues and user-facing performance issues.

### Team Collaboration

Workspaces act as the collaboration boundary. Monitors, incidents, alerts, and status pages belong to the workspace, while invites and membership keep access simple and operationally focused.

## System Design Notes

PingMaster is split into two main parts:

- `frontend/`
  React + Vite application for the dashboard, incidents, alerts, status pages, billing, team workflows, and AI-driven operator views
- `worker/`
  Cloudflare Worker backend for monitor APIs, incident logic, workspace and team access control, alerting, billing, and Redis-backed persistence

Redis is used as the main application store. To keep the product responsive without over-reading history on every page load, the system uses compact monitor summaries, cached aggregates, and staged data loading for heavier views.

Some of the important performance decisions in the project:

- lightweight dashboard summary loading before full monitor data
- rolling per-monitor summaries instead of recomputing from full history on every read
- workspace-scoped caching for public status payloads and monitor workspaces
- lazy or staged loading for secondary data such as detailed activity and heavier monitor views

## Tech Stack

- React
- Vite
- Cloudflare Workers
- Upstash Redis
- Firebase Authentication
- PageSpeed Insights API
- Gemini API
- Razorpay

## Local Setup

### 1. Install dependencies

Frontend:

```powershell
cd frontend
npm install
```

Worker:

```powershell
cd worker
npm install
```

### 2. Configure environment variables

Frontend uses standard Vite-style Firebase and API environment variables.  
Worker variables are documented in `worker/.env.example`.

### 3. Start the app

Frontend:

```powershell
cd frontend
npm run dev
```

Worker:

```powershell
cd worker
npm run dev
```

Default local URLs:

- Frontend: `http://localhost:5173`
- Worker: `http://127.0.0.1:8787`

## Useful Commands

Frontend build:

```powershell
cd frontend
npm run build
```

Frontend lint:

```powershell
cd frontend
npm run lint
```

Worker auth smoke test:

```powershell
cd worker
npm run test:auth
```

## Repository Structure

```text
PingMaster/
|-- frontend/   # React client
|-- worker/     # Cloudflare Worker backend
`-- docs/       # Supporting project documents and diagrams
```

## Current Focus

The project currently emphasizes:

- operational monitoring with actionable context
- faster incident response through AI-assisted suggestions
- efficient data access through cached summaries and reduced Redis reads
- clean workspace boundaries for shared monitoring and response workflows

## Note

This repository contains both product code and supporting project artifacts such as reports, diagrams, and poster material. The application code lives mainly inside `frontend/` and `worker/`.
