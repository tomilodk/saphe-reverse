# Phase 1: OSRM Service

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Set up OSRM routing engine in docker-compose with Denmark map data, verified with route queries that return turn-by-turn directions including roundabout exit numbers.

**Architecture:** OSRM runs as a Docker container with pre-processed PBF data. An init script downloads and processes the data. An updater sidecar refreshes weekly.

**Tech Stack:** OSRM Docker image, Geofabrik PBF, docker-compose

---

### Task 1: Create OSRM data setup script

**Files:**
- Create: `backend/osrm-setup.sh`

**Step 1: Write the setup script**

```bash
#!/bin/bash
set -e

REGION="${OSRM_REGION:-europe/denmark-latest}"
DATA_DIR="$(dirname "$0")/osrm-data"

mkdir -p "$DATA_DIR"

echo "[OSRM Setup] Downloading ${REGION}.osm.pbf from Geofabrik..."
wget -O "$DATA_DIR/region-latest.osm.pbf" \
  "https://download.geofabrik.de/${REGION}.osm.pbf"

echo "[OSRM Setup] Running osrm-extract..."
docker run --rm -v "$DATA_DIR:/data" osrm/osrm-backend \
  osrm-extract -p /opt/car.lua /data/region-latest.osm.pbf

echo "[OSRM Setup] Running osrm-partition..."
docker run --rm -v "$DATA_DIR:/data" osrm/osrm-backend \
  osrm-partition /data/region-latest.osrm

echo "[OSRM Setup] Running osrm-customize..."
docker run --rm -v "$DATA_DIR:/data" osrm/osrm-backend \
  osrm-customize /data/region-latest.osrm

echo "[OSRM Setup] Done! Data ready in $DATA_DIR"
```

**Step 2: Make executable**

```bash
chmod +x backend/osrm-setup.sh
```

**Step 3: Run the setup script (downloads ~200MB, processes ~2 min)**

```bash
cd /Users/milo/milodev/gits/routr
bash backend/osrm-setup.sh
```

Expected: `osrm-data/` directory contains `region-latest.osrm` and associated files

**Step 4: Verify data files exist**

```bash
ls -la backend/osrm-data/region-latest.osrm
```

Expected: File exists, non-zero size

**Step 5: Commit setup script (not the data)**

```bash
git add backend/osrm-setup.sh
git commit -m "Add OSRM data setup script"
```

---

### Task 2: Add OSRM service to docker-compose

**Files:**
- Modify: `backend/docker-compose.yml`

**Step 1: Add osrm and osrm-updater services**

Add after the saphe service:

```yaml
  osrm:
    image: osrm/osrm-backend
    ports:
      - "5000:5000"
    volumes:
      - ./osrm-data:/data:ro
    command: osrm-routed --algorithm mld /data/region-latest.osrm
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5000/route/v1/driving/9.55,56.17;9.56,56.18"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped

  osrm-updater:
    image: osrm/osrm-backend
    profiles: ["updater"]
    volumes:
      - ./osrm-data:/data
    environment:
      OSRM_REGION: ${OSRM_REGION:-europe/denmark-latest}
    entrypoint: /bin/bash
    command:
      - -c
      - |
        while true; do
          echo "[OSRM Update] Downloading $${OSRM_REGION}.osm.pbf..."
          wget -O /data/region-latest.osm.pbf "https://download.geofabrik.de/$${OSRM_REGION}.osm.pbf"
          echo "[OSRM Update] Extracting..."
          osrm-extract -p /opt/car.lua /data/region-latest.osm.pbf
          osrm-partition /data/region-latest.osrm
          osrm-customize /data/region-latest.osrm
          echo "[OSRM Update] Done. Sleeping 7 days."
          sleep 604800
        done
```

Note: `profiles: ["updater"]` means it doesn't start by default. Run with `docker compose --profile updater up` to include it.

**Step 2: Start OSRM service**

```bash
docker compose -f backend/docker-compose.yml up osrm -d
```

**Step 3: Wait for healthy**

```bash
docker compose -f backend/docker-compose.yml ps osrm
```

Expected: Status shows "healthy"

**Step 4: Commit**

```bash
git add backend/docker-compose.yml
git commit -m "Add OSRM service to docker-compose"
```

---

### Task 3: Verify OSRM routing with test queries

**Step 1: Basic route query (Silkeborg to Copenhagen)**

```bash
curl -s "http://localhost:5000/route/v1/driving/9.5518,56.1694;12.5683,55.6761?steps=true&alternatives=3&overview=full&geometries=polyline" | jq '{routes_count: (.routes | length), first_distance: .routes[0].distance, first_duration: .routes[0].duration}'
```

Expected: `routes_count` >= 1, `first_distance` > 200000 (meters), `first_duration` > 0

**Step 2: Verify roundabout exit numbers**

```bash
curl -s "http://localhost:5000/route/v1/driving/9.5518,56.1694;12.5683,55.6761?steps=true" | jq '[.routes[0].legs[0].steps[] | select(.maneuver.type == "roundabout" or .maneuver.type == "rotary")] | .[0]'
```

Expected: JSON object with `maneuver.type: "roundabout"` and `maneuver.exit: <number>`

If no roundabouts on this route, try a shorter local route known to have roundabouts:

```bash
# Silkeborg area roundabout (Ringvejen/Viborgvej)
curl -s "http://localhost:5000/route/v1/driving/9.5350,56.1750;9.5600,56.1800?steps=true" | jq '[.routes[0].legs[0].steps[] | select(.maneuver.type == "roundabout" or .maneuver.type == "rotary")]'
```

**Step 3: Verify alternatives parameter**

```bash
curl -s "http://localhost:5000/route/v1/driving/9.5518,56.1694;12.5683,55.6761?alternatives=3&overview=full" | jq '.routes | length'
```

Expected: 2 or 3 (OSRM returns up to the requested number if alternatives exist)

**Step 4: Verify exclude parameter (no motorway)**

```bash
curl -s "http://localhost:5000/route/v1/driving/9.5518,56.1694;12.5683,55.6761?exclude=motorway&overview=full" | jq '.routes[0].duration'
```

Expected: Duration is longer than without exclude (avoiding motorway = slower route)

**Step 5: Document results**

Write a brief `backend/osrm-data/VERIFICATION.md`:

```markdown
# OSRM Verification Results

- Date: YYYY-MM-DD
- Region: denmark-latest
- Route query: OK (Silkeborg → Copenhagen, X routes)
- Roundabout exits: OK (exit number present)
- Alternatives: OK (N routes returned)
- Exclude motorway: OK (longer duration)
```

**Step 6: Commit**

```bash
git add backend/osrm-data/VERIFICATION.md
git commit -m "Verify OSRM service: routes, roundabouts, alternatives, exclude"
```

---

### Phase 1 Verification Checklist

```bash
# All must pass:
curl -sf "http://localhost:5000/route/v1/driving/9.55,56.17;12.57,55.68?steps=true" > /dev/null && echo "PASS: basic route" || echo "FAIL"
curl -sf "http://localhost:5000/route/v1/driving/9.55,56.17;12.57,55.68?alternatives=3" | jq -e '.routes | length >= 2' > /dev/null && echo "PASS: alternatives" || echo "FAIL"
docker compose -f backend/docker-compose.yml ps osrm | grep -q healthy && echo "PASS: health check" || echo "FAIL"
```
