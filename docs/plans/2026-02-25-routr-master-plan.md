# Routr Master Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a mobile navigation app with rally-style curvature annotations and live Saphe POI radar alerts.

**Architecture:** Three backend services (saphe-reverse, curves-engine, OSRM) orchestrated via docker-compose, consumed by a React Native + Expo mobile app. Each service is independently testable before integration.

**Tech Stack:** React Native + Expo, TypeScript, Express, OSRM (Docker), Overpass API, gRPC, WebSocket, react-native-maps, Maestro

---

## Agent Team Structure

Create a team with these agents:

| Agent | Type | Phases | Isolation |
|-------|------|--------|-----------|
| **team-lead** | orchestrator | Phase 0, Phase 6, integration | main branch |
| **backend-saphe** | general-purpose | Phase 3 | worktree |
| **backend-curves** | general-purpose | Phase 1 + Phase 2 | worktree |
| **app-dev** | general-purpose | Phase 4 + Phase 5 | worktree |

## Execution Order & Dependencies

```
Phase 0: Repo Setup (team-lead, SEQUENTIAL FIRST)
    │
    │   After Phase 0 is committed to main, spawn agents in parallel:
    │
    ├──► Phase 1: OSRM Service (backend-curves)
    │        └──► Phase 2: Curves Engine (backend-curves, after Phase 1 verified)
    │
    ├──► Phase 3: Saphe WebSocket + Docker (backend-saphe)
    │
    └──► Phase 4: App Scaffold + Navigation (app-dev)
              └──► Phase 5: POI Radar + Alerts (app-dev, after Phase 3 verified)
    │
    └──► Phase 6: End-to-End Integration (team-lead, after ALL phases verified)
```

## Phase Plans

Each phase has its own detailed plan:

- `docs/plans/2026-02-25-routr-phase0-repo-setup.md`
- `docs/plans/2026-02-25-routr-phase1-osrm.md`
- `docs/plans/2026-02-25-routr-phase2-curves-engine.md`
- `docs/plans/2026-02-25-routr-phase3-saphe-ws.md`
- `docs/plans/2026-02-25-routr-phase4-app-navigation.md`
- `docs/plans/2026-02-25-routr-phase5-app-poi-radar.md`
- `docs/plans/2026-02-25-routr-phase6-e2e.md`

## Verification Gates

**CRITICAL: No phase merges to main until its verification passes.**

### Gate 1: Backend Services (Phases 1-3)

Each backend agent must demonstrate:

```bash
# backend-curves: OSRM is alive
curl -s "http://localhost:5000/route/v1/driving/9.55,56.17;12.56,55.67?steps=true" | jq '.routes[0].legs[0].steps[:3]'
# Expected: JSON with step objects containing maneuver.type

# backend-curves: curves-engine returns graded routes
curl -s "http://localhost:3457/api/route?from=56.17,9.55&to=55.67,12.56&preference=curvy" | jq '.routes | length'
# Expected: 3

# backend-saphe: WebSocket pushes POIs
wscat -c ws://localhost:3456/ws/pois
# Expected: connection established, receives POI JSON on trip activity

# All services: docker compose health
docker compose -f backend/docker-compose.yml ps
# Expected: all services "healthy"
```

### Gate 2: App (Phases 4-5)

App agent must demonstrate via Expo MCP / Maestro:

- Screenshot: home screen with map rendered
- Screenshot: route displayed with color-graded polyline
- Screenshot: curve card showing rally notation
- Screenshot: roundabout instruction with exit number
- Screenshot: POI fullscreen alert
- Maestro flow: search → select route → navigation screen

### Gate 3: E2E (Phase 6)

Team lead runs full Maestro flow:

1. `docker compose up` — all services healthy
2. App launches, connects to live backend
3. Search destination → 3 route alternatives shown
4. Select "Scenic" → color-graded route on map
5. Simulated GPS drive → curve cards appear
6. Approach POI → alert triggers with sound/vibration
7. Pass POI → alert auto-dismisses
