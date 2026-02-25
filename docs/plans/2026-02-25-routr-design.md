# Routr — Navigation App with Rally Curvature + Saphe POI Radar

**Date:** 2026-02-25
**Status:** Approved

## Overview

Routr is a mobile navigation app (React Native + Expo) that provides A-to-B routing with two unique features:

1. **Rally-style curvature annotations** — route polyline color-graded by turn radius, with upcoming curve cards using rally pace note terminology (L3, R5, Hairpin, etc.)
2. **Live Saphe POI radar** — speed cameras, law enforcement, etc. overlaid on the route with fullscreen alerts, sound, and vibration when approaching

Users can also request "curvy" routes that prefer twisty roads over highways.

---

## Repo Structure

```
~/milodev/gits/
├── saphe-reverse/              # Standalone repo (stripped to backend only)
│   ├── backend/
│   ├── proto/
│   ├── Dockerfile
│   └── package.json
│
└── routr/                      # Main repo → github.com/tomilodk/routr
    ├── app/                    # Expo React Native app
    ├── web/                    # Saphe POC (moved from saphe-reverse/frontend/, untouched)
    ├── backend/
    │   ├── docker-compose.yml  # Orchestrates all backend services
    │   ├── saphe-reverse/      # git subtree of saphe-reverse repo
    │   ├── curves-engine/      # Routing + curvature service
    │   └── osrm-data/          # OSRM pre-processed map data (gitignored)
    ├── CLAUDE.md
    └── package.json
```

**Subtree commands:**
- Add: `git subtree add --prefix=backend/saphe-reverse git@github.com:tomilodk/saphe-reverse.git main --squash`
- Push: `git subtree push --prefix=backend/saphe-reverse git@github.com:tomilodk/saphe-reverse.git main`

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                  PHONE (Expo App)                      │
│                                                        │
│  GPS ──► WS to saphe:3456        → live POI alerts     │
│  GPS ──► GET curves-engine:3457  → curvature route     │
│  GPS ──► local distance calc     → POI countdown       │
└────────────┬──────────────────┬─────────────────────────┘
             │                  │
             ▼                  ▼
┌────────────────┐  ┌─────────────────────┐
│  saphe:3456    │  │  curves-engine:3457 │
│                │  │                     │
│  gRPC → Saphe  │  │  GET /api/route     │
│  WS /ws/pois   │  │    → OSRM routing   │
│  Account pool  │  │    → Overpass fetch  │
│  Token refresh │  │    → curvature calc  │
└────────────────┘  │    → cache results   │
                    │         │            │
                    │         ▼            │
                    │    osrm:5000         │
                    │    (pre-processed)   │
                    └─────────────────────┘
```

### docker-compose.yml

```yaml
services:
  saphe:
    build: ./saphe-reverse
    ports: ["3456:3456"]
    volumes: ["./.accounts.jsonl:/app/.accounts.jsonl"]
    healthcheck:
      test: curl -f http://localhost:3456/api/auth/status
      interval: 10s

  osrm:
    image: osrm/osrm-backend
    ports: ["5000:5000"]
    volumes: ["./osrm-data:/data"]
    command: osrm-routed --algorithm mld /data/region-latest.osrm
    healthcheck:
      test: curl -f http://localhost:5000/health
      interval: 10s

  curves-engine:
    build: ./curves-engine
    ports: ["3457:3457"]
    environment:
      OSRM_URL: http://osrm:5000
    depends_on:
      osrm:
        condition: service_healthy
    healthcheck:
      test: curl -f http://localhost:3457/api/route/health
      interval: 10s

  osrm-updater:
    image: osrm/osrm-backend
    volumes: ["./osrm-data:/data"]
    environment:
      OSRM_REGION: europe/denmark-latest
    entrypoint: /bin/bash
    command: -c 'while true; do wget -O /data/region-latest.osm.pbf https://download.geofabrik.de/${OSRM_REGION}.osm.pbf && osrm-extract -p /opt/car.lua /data/region-latest.osm.pbf && osrm-partition /data/region-latest.osrm && osrm-customize /data/region-latest.osrm && echo "Done. Sleeping 7 days." && sleep 604800; done'
```

---

## Curves Engine API

```
GET /api/route?from=lat,lng&to=lat,lng&preference=curvy|balanced|fastest&exclude=motorway

Response:
{
  "routes": [
    {
      "label": "Scenic",
      "curvatureScore": 4820,
      "durationMin": 42,
      "distanceKm": 48.3,
      "geometry": "encoded_polyline",
      "segments": [
        { "from": [lat,lng], "to": [lat,lng], "radius": 45, "grade": 3, "color": "#ff6600" }
      ],
      "curves": [
        { "type": "L3", "distanceFromStart": 2400, "lat": 56.12, "lng": 9.48, "radius": 52 }
      ],
      "turns": [
        { "type": "turn", "modifier": "right", "name": "Silkeborgvej", "distanceFromStart": 1200 },
        { "type": "roundabout", "exit": 2, "name": "Ringvejen", "distanceFromStart": 3400 }
      ],
      "selected": true
    }
  ]
}
```

**Rally grade mapping:**

| Grade | Radius | Color | Call |
|-------|--------|-------|------|
| Hairpin | <30m | #9c27b0 | Hairpin |
| 1 | <60m | #f44336 | 1 |
| 2 | <100m | #ff5722 | 2 |
| 3 | <175m | #ff9800 | 3 |
| 4 | <250m | #ffc107 | 4 |
| 5 | <400m | #cddc39 | 5 |
| 6 | <600m | #8bc34a | 6 |
| Flat | >600m | #4caf50 | — |

**Caching:** LRU in-memory for routes (~500 entries). Disk cache for Overpass responses (TTL 7 days).

---

## App Screens

### 1. Home / Search
- Full-screen map centered on current GPS location
- Search bar at top: "Where to?"
- Tap → search screen with autocomplete (Nominatim / Photon, free)

### 2. Route Selection
- After destination chosen, show 3 route alternatives on map
- Cards at bottom: Scenic (curvy), Balanced, Fastest
- Each shows: duration, distance, curvature score visualization
- Default selection based on preference setting

### 3. Navigation (active route)
- Map with color-graded route polyline
- Blue position marker at bottom center (heading-up orientation)
- Top card: next curve (rally notation) — "L3 in 200m"
- Below that: next OSRM turn instruction — "Turn right onto Silkeborgvej"
- Roundabout icon with exit number when applicable
- Bottom bar: ETA, remaining distance, Stop button

### 4. POI Alert (fullscreen overlay)
- Triggered when approaching filtered POI
- ~2km: top notification + single vibration
- ~500m: fullscreen overlay + alarm sound + continuous vibration
- Shows: POI type, distance countdown, speed limit, road name
- Auto-dismisses when POI is behind (bearing > 90° from heading)

### 5. Settings
- Route preference default (curvy/balanced/fastest)
- POI filter toggles (default: Camera* + Law Enforcement)
- Alert sounds on/off
- OSRM server URL (for self-hosted flexibility)

---

## POI Alert Logic

- Default filter: `type.includes("Camera") || type === "Law Enforcement"`
- App receives POI positions via WebSocket from saphe backend
- Every 1s, app computes haversine distance from GPS to each active POI
- Alert thresholds:
  - >5km: no alert
  - 2-5km: small dot on map
  - 1-2km: top notification card + single vibration
  - <500m: fullscreen overlay + alarm sound + continuous vibration
  - Behind user (bearing check): auto-dismiss

---

## Implementation Phases & Verification Strategy

### Phase 0: Repo Setup & Migration
- Strip saphe-reverse to backend only (remove frontend/)
- Create Dockerfile for saphe-reverse
- Create routr repo with git subtree
- Move web POC to routr/web/

**Verification:** `docker build` saphe-reverse succeeds, `curl /api/auth/status` returns JSON.

### Phase 1: OSRM Service (backend/docker-compose)
- Set up OSRM in docker-compose with Denmark PBF
- Create setup script for initial data download + processing
- Add health check endpoint
- Add osrm-updater sidecar

**Verification (independent):**
- `curl "http://localhost:5000/route/v1/driving/9.55,56.17;12.56,55.67?steps=true&alternatives=3"` returns valid routes
- Response includes roundabout maneuvers with exit numbers
- Health check returns OK

### Phase 2: Curves Engine Service
- Create curves-engine Express service
- Implement curvature.ts (circumcircle radius, rally grading)
- Implement overpass.ts (fetch OSM nodes for route corridor)
- Implement route scoring and alternative ranking
- Add caching layer
- Create Dockerfile

**Verification (independent):**
- Unit tests for curvature math (known radius inputs → expected grades)
- Unit tests for rally classification thresholds
- Integration test: `curl /api/route?from=56.17,9.55&to=55.67,12.56&preference=curvy` returns 3 ranked routes with segments, curves, turns
- Verify color-graded segments have valid hex colors
- Verify curve cards have correct L/R direction and grade
- Health check confirms OSRM connectivity

### Phase 3: Saphe Backend Enhancements
- Add WebSocket endpoint `/ws/pois` (push POI updates instead of polling)
- Add Dockerfile
- Test in docker-compose alongside OSRM + curves-engine

**Verification (independent):**
- WebSocket connects and receives POI updates
- Existing REST endpoints still work (`/api/pois`, `/api/trip/start`, etc.)
- Docker health check passes
- Full `docker compose up` brings up all 3 services, all health checks green

### Phase 4: Expo App — Scaffold + Map + Navigation
- Create Expo project in app/
- Set up Expo MCP Server for autonomous development
- Implement home screen with map (react-native-maps, Apple Maps on iOS)
- Implement search / destination picker
- Implement route display (call curves-engine, render color-graded polyline)
- Implement turn-by-turn instructions (OSRM steps)
- Implement curve cards (rally notation overlay)
- Implement roundabout icon with exit number
- Implement route preference selector (Scenic/Balanced/Fastest)

**Verification (independent):**
- Expo MCP: screenshot home screen, verify map renders
- Maestro flow: tap search → enter destination → verify route appears on map
- Maestro flow: verify curve card shows rally notation
- Maestro flow: verify roundabout instruction shows exit number
- Maestro flow: verify route preference toggle changes displayed route
- Mock curves-engine responses for offline testing

### Phase 5: Expo App — POI Radar + Alerts
- Implement WebSocket connection to saphe backend
- Implement local distance calculation (haversine from GPS to POIs)
- Implement POI markers on map
- Implement alert thresholds (2km notification, 500m fullscreen)
- Implement fullscreen alert overlay with countdown
- Implement sound (expo-av), vibration (expo-haptics), notifications
- Implement auto-dismiss when POI is behind

**Verification (independent):**
- Unit test: haversine distance calculation
- Unit test: bearing calculation for auto-dismiss
- Unit test: alert threshold logic
- Maestro flow: simulate GPS near a POI → verify alert appears
- Maestro flow: verify fullscreen overlay shows POI type + distance
- Maestro flow: verify alert dismisses after passing POI

### Phase 6: End-to-End Integration Testing
- Full docker-compose up (saphe + curves-engine + OSRM)
- App connects to live backend
- Complete flow: search → select route → navigate → approach POI → alert

**Verification (end-to-end):**
- Maestro flow: full navigation journey with mocked GPS
  1. Launch app
  2. Search for destination
  3. Select "Scenic" route
  4. Verify color-graded route on map
  5. Simulate driving along route
  6. Verify curve cards appear at correct positions
  7. Verify roundabout instruction with exit number
  8. Approach speed camera POI
  9. Verify 2km notification
  10. Verify 500m fullscreen alert with sound
  11. Pass POI, verify auto-dismiss
  12. Arrive at destination

---

## Agent Team Strategy

The overall implementation should be executed by an **agent team** for parallel work:

### Team Structure
- **Team Lead** — orchestrates tasks, reviews integration, runs E2E tests
- **backend-saphe** — Phase 0 (repo migration) + Phase 3 (WebSocket + Dockerfile)
- **backend-curves** — Phase 1 (OSRM) + Phase 2 (curves-engine)
- **app-dev** — Phase 4 (map + navigation) + Phase 5 (POI radar + alerts)

### Execution Order
```
Phase 0 (repo setup)           ← team lead, sequential first
    │
    ├──► Phase 1 (OSRM)        ← backend-curves agent (worktree)
    ├──► Phase 3 (saphe WS)    ← backend-saphe agent (worktree)
    └──► Phase 4 (app scaffold) ← app-dev agent (worktree)
              │
              ▼
         Phase 2 (curves-engine) ← backend-curves (after OSRM verified)
              │
              ▼
         Phase 5 (POI alerts)    ← app-dev (after saphe WS verified)
              │
              ▼
         Phase 6 (E2E)          ← team lead integrates + tests
```

### Verification Gates
Each agent MUST pass its independent verification before the team lead integrates:
1. **backend-curves:** OSRM responds to route queries + curves-engine returns graded routes
2. **backend-saphe:** WebSocket pushes POIs + Docker health checks pass
3. **app-dev:** Map renders + navigation flow works with mocked backend
4. **Integration:** `docker compose up` all green + app connects to live services
5. **E2E:** Full Maestro flow passes end-to-end
