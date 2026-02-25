# Phase 6: End-to-End Integration Testing

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Verify the complete system works end-to-end — all backend services running via docker-compose, app connects to live backend, full navigation journey from search to arrival with POI alerts.

**Architecture:** docker-compose brings up saphe + OSRM + curves-engine. Expo app connects to all services. Maestro E2E flow validates the complete user journey.

**Tech Stack:** docker-compose, Maestro, Expo, xcrun simctl

---

### Task 1: Verify all backend services

**Step 1: Start full docker-compose stack**

```bash
cd /Users/milo/milodev/gits/routr
docker compose -f backend/docker-compose.yml up --build -d
```

**Step 2: Wait for all services healthy**

```bash
# Poll until all healthy (max 60s)
for i in $(seq 1 12); do
  HEALTHY=$(docker compose -f backend/docker-compose.yml ps --format json | grep -c '"healthy"')
  echo "Healthy: $HEALTHY/3"
  [ "$HEALTHY" -ge 3 ] && break
  sleep 5
done
```

**Step 3: Verify each service independently**

```bash
# Saphe
curl -sf http://localhost:3456/api/auth/status | jq . && echo "PASS: saphe" || echo "FAIL: saphe"

# OSRM
curl -sf "http://localhost:5000/route/v1/driving/9.55,56.17;12.57,55.68?steps=true" | jq '.routes | length' && echo "PASS: osrm" || echo "FAIL: osrm"

# Curves engine
curl -sf http://localhost:3457/api/route/health | jq . && echo "PASS: curves-engine" || echo "FAIL: curves-engine"

# Full route through curves-engine (exercises OSRM connection)
curl -sf "http://localhost:3457/api/route?from=56.17,9.55&to=55.68,12.57&preference=curvy" | jq '{
  routes: (.routes | length),
  first_label: .routes[0].label,
  score: .routes[0].curvatureScore,
  curves: (.routes[0].curves | length),
  turns: (.routes[0].turns | length),
  segments: (.routes[0].segments | length)
}' && echo "PASS: full route pipeline" || echo "FAIL: full route pipeline"
```

Expected: All 4 checks PASS

**Step 4: Document results**

Write to `backend/INTEGRATION-TEST.md`:

```markdown
# Integration Test Results

## Date: YYYY-MM-DD

### Services
- [x] saphe:3456 — healthy, /api/auth/status responds
- [x] osrm:5000 — healthy, route query returns steps
- [x] curves-engine:3457 — healthy, OSRM connected
- [x] Full route pipeline — curvature scored, curves extracted, turns parsed

### Route: Silkeborg → Copenhagen
- Routes returned: N
- Scenic curvature score: XXXX
- Curve cards: N
- Turn instructions: N
- Segments with color: N
```

**Step 5: Commit**

```bash
git add backend/INTEGRATION-TEST.md
git commit -m "Verify backend integration: all services healthy and connected"
```

---

### Task 2: Create Maestro E2E test flows

**Files:**
- Create: `app/maestro/search-and-navigate.yaml`
- Create: `app/maestro/poi-alert.yaml`

**Step 1: Install Maestro if not present**

```bash
which maestro || curl -Ls "https://get.maestro.mobile.dev" | bash
```

**Step 2: Create search and navigate flow**

```yaml
# app/maestro/search-and-navigate.yaml
appId: com.routr.app
---
- launchApp:
    clearState: true

# Home screen - map should render
- assertVisible:
    id: "search-bar"
    timeout: 10000
- takeScreenshot: "01-home-screen"

# Tap search bar
- tapOn:
    id: "search-bar"

# Type destination
- inputText: "København"
- waitForAnimationToEnd

# Wait for results
- assertVisible:
    text: "København"
    timeout: 5000
- takeScreenshot: "02-search-results"

# Select first result
- tapOn:
    text: "København"
    index: 0

# Navigation screen should load
- waitForAnimationToEnd:
    timeout: 15000

# Route should be displayed
- takeScreenshot: "03-navigation-route"

# Route selector should show options
- assertVisible:
    id: "route-option-Scenic"
    optional: true

# Try selecting scenic route
- tapOn:
    id: "route-option-Scenic"
    optional: true
- takeScreenshot: "04-scenic-route"

# Verify navigation UI elements
- assertVisible:
    id: "stop-nav"

# Stop navigation
- tapOn:
    id: "stop-nav"

# Back to home
- assertVisible:
    id: "search-bar"
- takeScreenshot: "05-back-home"
```

**Step 3: Create POI alert flow (requires GPS mock)**

```yaml
# app/maestro/poi-alert.yaml
appId: com.routr.app
tags:
  - requires-gps-mock
---
- launchApp

# Start navigation to a known POI area
- tapOn:
    id: "search-bar"
- inputText: "Silkeborg"
- tapOn:
    text: "Silkeborg"
    index: 0

# Wait for route to load
- waitForAnimationToEnd:
    timeout: 15000

# At this point, with GPS mock near a POI:
# - POI notification should appear at 1-2km
# - Fullscreen alert should appear at <500m

- takeScreenshot: "poi-01-navigation"

# If POI alert is visible
- assertVisible:
    id: "poi-notification"
    optional: true
    timeout: 10000
- takeScreenshot: "poi-02-notification"

- assertVisible:
    id: "poi-fullscreen-alert"
    optional: true
    timeout: 30000
- takeScreenshot: "poi-03-fullscreen-alert"
```

**Step 4: Commit**

```bash
git add app/maestro/
git commit -m "Add Maestro E2E test flows for search, navigation, POI alerts"
```

---

### Task 3: Run E2E test flow

**Step 1: Ensure backend is running**

```bash
docker compose -f backend/docker-compose.yml ps | grep healthy
```

**Step 2: Start Expo app in simulator**

```bash
cd app && npx expo start --ios &
sleep 10
```

**Step 3: Run Maestro search and navigate flow**

```bash
cd app && maestro test maestro/search-and-navigate.yaml
```

Expected: All steps pass, screenshots saved to `~/.maestro/screenshots/`

**Step 4: Review screenshots**

```bash
ls ~/.maestro/screenshots/
open ~/.maestro/screenshots/01-home-screen.png
open ~/.maestro/screenshots/03-navigation-route.png
```

Expected:
- 01: Map with "Where to?" bar
- 02: Search results showing København
- 03: Navigation screen with color-graded route
- 04: Scenic route selected
- 05: Back to home screen

**Step 5: Document E2E results**

Append to `backend/INTEGRATION-TEST.md`:

```markdown
### Maestro E2E Flow
- [x] Home screen: map renders, search bar visible
- [x] Search: Nominatim returns results for "København"
- [x] Navigation: route displayed with color-graded polyline
- [x] Route selector: Scenic/Balanced/Fastest options shown
- [x] Stop navigation: returns to home screen
- [ ] POI alerts: requires GPS mock near known POIs (manual test)
```

**Step 6: Commit**

```bash
git add backend/INTEGRATION-TEST.md
git commit -m "E2E test results: search and navigation flow passing"
```

---

### Task 4: Create GPS mock for POI alert testing

**Files:**
- Create: `app/maestro/silkeborg-drive.gpx`

**Step 1: Create GPX file simulating a drive through Silkeborg**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Routr Test">
  <trk>
    <name>Silkeborg Test Drive</name>
    <trkseg>
      <!-- Start at Silkeborg center -->
      <trkpt lat="56.1694" lon="9.5518"><time>2026-01-01T00:00:00Z</time></trkpt>
      <trkpt lat="56.1700" lon="9.5530"><time>2026-01-01T00:00:05Z</time></trkpt>
      <trkpt lat="56.1710" lon="9.5550"><time>2026-01-01T00:00:10Z</time></trkpt>
      <trkpt lat="56.1720" lon="9.5570"><time>2026-01-01T00:00:15Z</time></trkpt>
      <trkpt lat="56.1730" lon="9.5590"><time>2026-01-01T00:00:20Z</time></trkpt>
      <trkpt lat="56.1740" lon="9.5610"><time>2026-01-01T00:00:25Z</time></trkpt>
      <trkpt lat="56.1750" lon="9.5630"><time>2026-01-01T00:00:30Z</time></trkpt>
      <!-- Continue along main road -->
      <trkpt lat="56.1760" lon="9.5650"><time>2026-01-01T00:00:35Z</time></trkpt>
      <trkpt lat="56.1770" lon="9.5670"><time>2026-01-01T00:00:40Z</time></trkpt>
      <trkpt lat="56.1780" lon="9.5690"><time>2026-01-01T00:00:45Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>
```

**Step 2: Load GPX in iOS Simulator**

```bash
# Set simulated location via Xcode's simctl
xcrun simctl location booted set 56.1694,9.5518
# Or load the GPX route:
# In Xcode: Debug → Simulate Location → Custom Location
```

**Step 3: Commit**

```bash
git add app/maestro/silkeborg-drive.gpx
git commit -m "Add GPS mock GPX for POI alert testing"
```

---

### Task 5: Final verification and push

**Step 1: Run all unit tests**

```bash
cd backend/curves-engine && bun test && echo "PASS: curves-engine tests" || echo "FAIL"
cd backend/saphe-reverse && bun test && echo "PASS: saphe tests" || echo "FAIL"
cd app && bun test && echo "PASS: app tests" || echo "FAIL"
```

**Step 2: Run Maestro E2E**

```bash
cd app && maestro test maestro/search-and-navigate.yaml && echo "PASS: E2E" || echo "FAIL"
```

**Step 3: Push everything**

```bash
cd /Users/milo/milodev/gits/routr
git push origin main

# Also push saphe subtree changes if any
git subtree push --prefix=backend/saphe-reverse saphe-origin main
```

**Step 4: Final screenshot gallery**

```bash
xcrun simctl io booted screenshot /tmp/routr-final-home.png
# Navigate to route, take more screenshots
```

---

### Phase 6 Complete Verification Summary

```
BACKEND SERVICES:
  [?] saphe:3456 healthy
  [?] osrm:5000 healthy
  [?] curves-engine:3457 healthy
  [?] Full route pipeline (Silkeborg → Copenhagen)

UNIT TESTS:
  [?] curves-engine: curvature math, curve cards, polyline
  [?] saphe: WebSocket broadcast
  [?] app: POI radar distance, bearing, alert levels

E2E FLOW:
  [?] Home → Search → Navigate → Route displayed
  [?] Color-graded route polyline visible
  [?] Curve card with rally notation shown
  [?] Turn instruction with road name shown
  [?] Route selector: Scenic/Balanced/Fastest
  [?] Stop navigation returns to home
  [?] POI alert (requires GPS mock + active Saphe session)
```
