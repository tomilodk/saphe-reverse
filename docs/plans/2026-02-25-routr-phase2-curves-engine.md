# Phase 2: Curves Engine Service

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a TypeScript service that wraps OSRM routing with curvature analysis — returns color-graded route segments, rally-style curve cards, and route preference ranking (curvy/balanced/fastest).

**Architecture:** Express server on :3457. Calls OSRM for route geometry + turn instructions. Fetches detailed OSM nodes via Overpass API. Computes circumcircle radius for consecutive point triples. Classifies into rally grades. Caches results.

**Tech Stack:** Bun, Express, TypeScript

---

### Task 1: Scaffold curves-engine project

**Files:**
- Create: `backend/curves-engine/package.json`
- Create: `backend/curves-engine/tsconfig.json`
- Create: `backend/curves-engine/src/server.ts`
- Create: `backend/curves-engine/Dockerfile`

**Step 1: Create package.json**

```json
{
  "name": "curves-engine",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "bun run src/server.ts",
    "dev": "bun --watch run src/server.ts",
    "test": "bun test"
  },
  "dependencies": {
    "express": "^5.2.1",
    "@types/express": "^5.0.6"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

**Step 3: Create minimal server**

```typescript
import express from "express";

const app = express();
app.use(express.json());

const OSRM_URL = process.env.OSRM_URL || "http://localhost:5000";

app.get("/api/route/health", async (_req, res) => {
  try {
    const osrmRes = await fetch(`${OSRM_URL}/route/v1/driving/9.55,56.17;9.56,56.18`);
    const ok = osrmRes.ok;
    res.json({ status: ok ? "ok" : "osrm_down", osrm: ok });
  } catch {
    res.json({ status: "osrm_unreachable", osrm: false });
  }
});

app.get("/api/route", (_req, res) => {
  res.status(501).json({ error: "not yet implemented" });
});

const PORT = process.env.PORT || 3457;
app.listen(PORT, () => {
  console.log(`Curves Engine: http://localhost:${PORT}`);
  console.log(`OSRM backend: ${OSRM_URL}`);
});
```

**Step 4: Create Dockerfile**

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

COPY src/ ./src/

EXPOSE 3457
CMD ["bun", "run", "src/server.ts"]
```

**Step 5: Install deps and verify**

```bash
cd backend/curves-engine && bun install
OSRM_URL=http://localhost:5000 bun run dev &
sleep 2
curl -s http://localhost:3457/api/route/health | jq .
kill %1
```

Expected: `{"status": "ok", "osrm": true}` (if OSRM is running from Phase 1)

**Step 6: Commit**

```bash
git add backend/curves-engine/
git commit -m "Scaffold curves-engine service with health check"
```

---

### Task 2: Implement curvature math with tests

**Files:**
- Create: `backend/curves-engine/src/curvature.ts`
- Create: `backend/curves-engine/src/curvature.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, expect, test } from "bun:test";
import {
  haversineDistance,
  circumcircleRadius,
  classifyRadius,
  computeSegmentCurvatures,
  type CurvatureGrade,
} from "./curvature";

describe("haversineDistance", () => {
  test("returns ~111km for 1 degree of latitude", () => {
    const d = haversineDistance(56.0, 9.0, 57.0, 9.0);
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });

  test("returns 0 for same point", () => {
    expect(haversineDistance(56.0, 9.0, 56.0, 9.0)).toBe(0);
  });
});

describe("circumcircleRadius", () => {
  test("returns large radius for nearly collinear points", () => {
    // Three points in a near-straight line
    const r = circumcircleRadius(
      56.0, 9.0,
      56.001, 9.0,
      56.002, 9.0
    );
    expect(r).toBeGreaterThan(5000);
  });

  test("returns small radius for tight curve", () => {
    // Three points forming a tight curve (right-angle-ish)
    const r = circumcircleRadius(
      56.0, 9.0,
      56.0003, 9.0003,
      56.0, 9.0006
    );
    expect(r).toBeLessThan(100);
  });
});

describe("classifyRadius", () => {
  test("hairpin for <30m", () => {
    expect(classifyRadius(20)).toEqual({ grade: "hairpin", color: "#9c27b0", weight: 2.0, call: "Hairpin" });
  });

  test("grade 1 for <60m", () => {
    expect(classifyRadius(45).grade).toBe("1");
  });

  test("grade 3 for ~150m", () => {
    expect(classifyRadius(150).grade).toBe("3");
  });

  test("flat for >600m", () => {
    expect(classifyRadius(1000).grade).toBe("flat");
    expect(classifyRadius(1000).weight).toBe(0);
  });
});

describe("computeSegmentCurvatures", () => {
  test("returns segments with curvature data", () => {
    // Simple L-shaped path
    const coords: [number, number][] = [
      [56.0, 9.0],
      [56.001, 9.0],
      [56.001, 9.001],
      [56.001, 9.002],
    ];
    const segments = computeSegmentCurvatures(coords);
    expect(segments.length).toBe(3);
    expect(segments[0]).toHaveProperty("radius");
    expect(segments[0]).toHaveProperty("grade");
    expect(segments[0]).toHaveProperty("color");
  });

  test("computes total curvature score", () => {
    const coords: [number, number][] = [
      [56.0, 9.0],
      [56.001, 9.0],
      [56.001, 9.001],
    ];
    const segments = computeSegmentCurvatures(coords);
    const totalScore = segments.reduce((sum, s) => sum + s.curvatureScore, 0);
    expect(totalScore).toBeGreaterThan(0);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd backend/curves-engine && bun test
```

Expected: FAIL — module `./curvature` not found

**Step 3: Implement curvature.ts**

```typescript
const EARTH_RADIUS = 6371000; // meters
const MAX_RADIUS = 10000;

export type CurvatureGrade = "hairpin" | "1" | "2" | "3" | "4" | "5" | "6" | "flat";

export interface GradeInfo {
  grade: CurvatureGrade;
  color: string;
  weight: number;
  call: string;
}

export interface CurvatureSegment {
  from: [number, number]; // [lat, lng]
  to: [number, number];
  radius: number;
  grade: CurvatureGrade;
  color: string;
  weight: number;
  length: number; // meters
  curvatureScore: number; // length * weight
}

const GRADE_TABLE: { maxRadius: number; info: GradeInfo }[] = [
  { maxRadius: 30,  info: { grade: "hairpin", color: "#9c27b0", weight: 2.0, call: "Hairpin" } },
  { maxRadius: 60,  info: { grade: "1",       color: "#f44336", weight: 1.6, call: "1" } },
  { maxRadius: 100, info: { grade: "2",       color: "#ff5722", weight: 1.3, call: "2" } },
  { maxRadius: 175, info: { grade: "3",       color: "#ff9800", weight: 1.0, call: "3" } },
  { maxRadius: 250, info: { grade: "4",       color: "#ffc107", weight: 0.8, call: "4" } },
  { maxRadius: 400, info: { grade: "5",       color: "#cddc39", weight: 0.5, call: "5" } },
  { maxRadius: 600, info: { grade: "6",       color: "#8bc34a", weight: 0.2, call: "6" } },
];

const FLAT_INFO: GradeInfo = { grade: "flat", color: "#4caf50", weight: 0, call: "" };

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function circumcircleRadius(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  lat3: number, lon3: number
): number {
  const a = haversineDistance(lat1, lon1, lat2, lon2);
  const b = haversineDistance(lat2, lon2, lat3, lon3);
  const c = haversineDistance(lat1, lon1, lat3, lon3);

  if (a === 0 || b === 0 || c === 0) return MAX_RADIUS;

  const s = (a + b + c) * (b + c - a) * (c + a - b) * (a + b - c);
  if (s <= 0) return MAX_RADIUS;

  return (a * b * c) / Math.sqrt(s);
}

export function classifyRadius(radius: number): GradeInfo {
  for (const entry of GRADE_TABLE) {
    if (radius < entry.maxRadius) return entry.info;
  }
  return FLAT_INFO;
}

export function computeSegmentCurvatures(coords: [number, number][]): CurvatureSegment[] {
  if (coords.length < 2) return [];

  const segments: CurvatureSegment[] = [];

  for (let i = 0; i < coords.length - 1; i++) {
    const [lat1, lng1] = coords[i];
    const [lat2, lng2] = coords[i + 1];
    const length = haversineDistance(lat1, lng1, lat2, lng2);

    let radius = MAX_RADIUS;

    // Use circumcircle with previous point
    if (i > 0) {
      const [lat0, lng0] = coords[i - 1];
      const r1 = circumcircleRadius(lat0, lng0, lat1, lng1, lat2, lng2);
      radius = Math.min(radius, r1);
    }

    // Use circumcircle with next point
    if (i + 2 < coords.length) {
      const [lat3, lng3] = coords[i + 2];
      const r2 = circumcircleRadius(lat1, lng1, lat2, lng2, lat3, lng3);
      radius = Math.min(radius, r2);
    }

    const info = classifyRadius(radius);

    segments.push({
      from: [lat1, lng1],
      to: [lat2, lng2],
      radius,
      grade: info.grade,
      color: info.color,
      weight: info.weight,
      length,
      curvatureScore: length * info.weight,
    });
  }

  return segments;
}

export function computeTotalCurvatureScore(segments: CurvatureSegment[]): number {
  return segments.reduce((sum, s) => sum + s.curvatureScore, 0);
}
```

**Step 4: Run tests to verify they pass**

```bash
cd backend/curves-engine && bun test
```

Expected: All tests PASS

**Step 5: Commit**

```bash
git add backend/curves-engine/src/curvature.ts backend/curves-engine/src/curvature.test.ts
git commit -m "Implement curvature math: haversine, circumcircle radius, rally grading"
```

---

### Task 3: Implement curve direction detection with tests

**Files:**
- Create: `backend/curves-engine/src/curves.ts`
- Create: `backend/curves-engine/src/curves.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, expect, test } from "bun:test";
import { bearing, turnDirection, extractCurveCards } from "./curves";
import type { CurvatureSegment } from "./curvature";

describe("bearing", () => {
  test("north is ~0", () => {
    const b = bearing(56.0, 9.0, 56.1, 9.0);
    expect(Math.abs(b)).toBeLessThan(1);
  });

  test("east is ~90", () => {
    const b = bearing(56.0, 9.0, 56.0, 9.1);
    expect(b).toBeGreaterThan(85);
    expect(b).toBeLessThan(95);
  });
});

describe("turnDirection", () => {
  test("detects left turn", () => {
    // Going north then turning west
    expect(turnDirection(0, 270)).toBe("L");
  });

  test("detects right turn", () => {
    // Going north then turning east
    expect(turnDirection(0, 90)).toBe("R");
  });
});

describe("extractCurveCards", () => {
  test("extracts curves from segments, skipping flat", () => {
    const segments: CurvatureSegment[] = [
      { from: [56.0, 9.0], to: [56.001, 9.0], radius: 1000, grade: "flat", color: "#4caf50", weight: 0, length: 111, curvatureScore: 0 },
      { from: [56.001, 9.0], to: [56.001, 9.001], radius: 80, grade: "2", color: "#ff5722", weight: 1.3, length: 60, curvatureScore: 78 },
      { from: [56.001, 9.001], to: [56.001, 9.002], radius: 1000, grade: "flat", color: "#4caf50", weight: 0, length: 60, curvatureScore: 0 },
    ];
    const cards = extractCurveCards(segments);
    expect(cards.length).toBe(1);
    expect(cards[0].grade).toBe("2");
    expect(cards[0].direction).toMatch(/^[LR]$/);
  });
});
```

**Step 2: Run tests — should fail**

```bash
cd backend/curves-engine && bun test
```

**Step 3: Implement curves.ts**

```typescript
import type { CurvatureSegment } from "./curvature";

export interface CurveCard {
  type: string;        // "L2", "R5", "Hairpin"
  direction: "L" | "R";
  grade: string;
  radius: number;
  lat: number;
  lng: number;
  distanceFromStart: number; // meters
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function turnDirection(bearingBefore: number, bearingAfter: number): "L" | "R" {
  let diff = (bearingAfter - bearingBefore + 360) % 360;
  return diff > 180 ? "L" : "R";
}

export function extractCurveCards(segments: CurvatureSegment[]): CurveCard[] {
  const cards: CurveCard[] = [];
  let distFromStart = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    if (seg.grade !== "flat") {
      // Determine direction from bearings of adjacent segments
      const prevSeg = segments[i - 1] || seg;
      const bearBefore = bearing(prevSeg.from[0], prevSeg.from[1], prevSeg.to[0], prevSeg.to[1]);
      const bearAfter = bearing(seg.from[0], seg.from[1], seg.to[0], seg.to[1]);
      const dir = turnDirection(bearBefore, bearAfter);

      const call = seg.grade === "hairpin" ? "Hairpin" : seg.grade;
      cards.push({
        type: `${dir}${call}`,
        direction: dir,
        grade: seg.grade,
        radius: seg.radius,
        lat: seg.from[0],
        lng: seg.from[1],
        distanceFromStart: distFromStart,
      });
    }

    distFromStart += seg.length;
  }

  // Merge consecutive same-grade segments into single curve cards
  const merged: CurveCard[] = [];
  for (const card of cards) {
    const prev = merged[merged.length - 1];
    if (prev && prev.grade === card.grade && prev.direction === card.direction) {
      continue; // Same curve continuation, skip
    }
    merged.push(card);
  }

  return merged;
}
```

**Step 4: Run tests**

```bash
cd backend/curves-engine && bun test
```

Expected: All PASS

**Step 5: Commit**

```bash
git add backend/curves-engine/src/curves.ts backend/curves-engine/src/curves.test.ts
git commit -m "Implement curve direction detection and curve card extraction"
```

---

### Task 4: Implement Overpass fetcher with caching

**Files:**
- Create: `backend/curves-engine/src/overpass.ts`
- Create: `backend/curves-engine/src/overpass.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, expect, test } from "bun:test";
import { buildOverpassQuery, parseCoordsFromOverpassResponse } from "./overpass";

describe("buildOverpassQuery", () => {
  test("builds query for bounding box", () => {
    const query = buildOverpassQuery(56.16, 9.54, 56.18, 9.56);
    expect(query).toContain("[out:json]");
    expect(query).toContain("way");
    expect(query).toContain("highway");
    expect(query).toContain("56.16,9.54,56.18,9.56");
  });
});

describe("parseCoordsFromOverpassResponse", () => {
  test("extracts coordinates from way nodes", () => {
    const response = {
      elements: [
        {
          type: "way",
          id: 123,
          nodes: [1, 2, 3],
          geometry: [
            { lat: 56.17, lon: 9.55 },
            { lat: 56.171, lon: 9.551 },
            { lat: 56.172, lon: 9.552 },
          ],
        },
      ],
    };
    const coords = parseCoordsFromOverpassResponse(response);
    expect(coords.length).toBe(3);
    expect(coords[0]).toEqual([56.17, 9.55]);
  });
});
```

**Step 2: Run — should fail**

```bash
cd backend/curves-engine && bun test src/overpass.test.ts
```

**Step 3: Implement overpass.ts**

```typescript
import fs from "fs";
import path from "path";
import crypto from "crypto";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const CACHE_DIR = path.join(import.meta.dir, "..", ".cache", "overpass");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function buildOverpassQuery(south: number, west: number, north: number, east: number): string {
  return `[out:json][timeout:30];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential)$"](${south},${west},${north},${east});
out geom;`;
}

export function parseCoordsFromOverpassResponse(response: any): [number, number][] {
  const coords: [number, number][] = [];
  for (const element of response.elements || []) {
    if (element.type === "way" && element.geometry) {
      for (const node of element.geometry) {
        coords.push([node.lat, node.lon]);
      }
    }
  }
  return coords;
}

function getCachePath(query: string): string {
  const hash = crypto.createHash("md5").update(query).digest("hex");
  return path.join(CACHE_DIR, `${hash}.json`);
}

function readCache(cachePath: string): any | null {
  try {
    if (!fs.existsSync(cachePath)) return null;
    const stat = fs.statSync(cachePath);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) {
      fs.unlinkSync(cachePath);
      return null;
    }
    return JSON.parse(fs.readFileSync(cachePath, "utf-8"));
  } catch {
    return null;
  }
}

export async function fetchRouteCorridorNodes(
  routeCoords: [number, number][],
  bufferDeg: number = 0.005 // ~500m buffer
): Promise<[number, number][]> {
  // Compute bounding box of route + buffer
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
  for (const [lat, lng] of routeCoords) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  }
  south -= bufferDeg;
  north += bufferDeg;
  west -= bufferDeg;
  east += bufferDeg;

  const query = buildOverpassQuery(south, west, north, east);
  const cachePath = getCachePath(query);

  // Check cache
  const cached = readCache(cachePath);
  if (cached) {
    console.log("[Overpass] Cache hit");
    return parseCoordsFromOverpassResponse(cached);
  }

  // Fetch from Overpass
  console.log("[Overpass] Fetching from API...");
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!res.ok) throw new Error(`Overpass API error: ${res.status}`);
  const data = await res.json();

  // Write cache
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(data));

  return parseCoordsFromOverpassResponse(data);
}
```

**Step 4: Run tests**

```bash
cd backend/curves-engine && bun test src/overpass.test.ts
```

Expected: PASS (unit tests only, no network calls)

**Step 5: Commit**

```bash
git add backend/curves-engine/src/overpass.ts backend/curves-engine/src/overpass.test.ts
git commit -m "Implement Overpass API fetcher with disk cache"
```

---

### Task 5: Implement polyline decoder with tests

**Files:**
- Create: `backend/curves-engine/src/polyline.ts`
- Create: `backend/curves-engine/src/polyline.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, expect, test } from "bun:test";
import { decodePolyline } from "./polyline";

describe("decodePolyline", () => {
  test("decodes OSRM polyline5 format", () => {
    // Known encoded polyline: (38.5, -120.2), (40.7, -120.95), (43.252, -126.453)
    const encoded = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";
    const coords = decodePolyline(encoded);
    expect(coords.length).toBe(3);
    expect(coords[0][0]).toBeCloseTo(38.5, 1);
    expect(coords[0][1]).toBeCloseTo(-120.2, 1);
  });
});
```

**Step 2: Implement polyline.ts**

```typescript
export function decodePolyline(encoded: string, precision: number = 5): [number, number][] {
  const factor = Math.pow(10, precision);
  const coords: [number, number][] = [];
  let lat = 0;
  let lng = 0;
  let i = 0;

  while (i < encoded.length) {
    // Decode latitude
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(i++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    // Decode longitude
    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(i++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push([lat / factor, lng / factor]);
  }

  return coords;
}
```

**Step 3: Run tests**

```bash
cd backend/curves-engine && bun test src/polyline.test.ts
```

Expected: PASS

**Step 4: Commit**

```bash
git add backend/curves-engine/src/polyline.ts backend/curves-engine/src/polyline.test.ts
git commit -m "Implement polyline decoder for OSRM geometry"
```

---

### Task 6: Implement the /api/route endpoint

**Files:**
- Modify: `backend/curves-engine/src/server.ts`

**Step 1: Implement the full route endpoint**

Replace the placeholder in server.ts:

```typescript
import express from "express";
import { computeSegmentCurvatures, computeTotalCurvatureScore } from "./curvature";
import { extractCurveCards } from "./curves";
import { fetchRouteCorridorNodes } from "./overpass";
import { decodePolyline } from "./polyline";

const app = express();
app.use(express.json());

const OSRM_URL = process.env.OSRM_URL || "http://localhost:5000";

// LRU cache for route results
const routeCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_MAX = 500;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getCachedRoute(key: string): any | null {
  const entry = routeCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    routeCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedRoute(key: string, data: any): void {
  if (routeCache.size >= CACHE_MAX) {
    const oldest = routeCache.keys().next().value;
    if (oldest) routeCache.delete(oldest);
  }
  routeCache.set(key, { data, timestamp: Date.now() });
}

interface RouteResult {
  label: string;
  curvatureScore: number;
  durationMin: number;
  distanceKm: number;
  geometry: string;
  segments: any[];
  curves: any[];
  turns: any[];
  selected: boolean;
}

app.get("/api/route/health", async (_req, res) => {
  try {
    const osrmRes = await fetch(`${OSRM_URL}/route/v1/driving/9.55,56.17;9.56,56.18`);
    res.json({ status: osrmRes.ok ? "ok" : "osrm_down", osrm: osrmRes.ok });
  } catch {
    res.json({ status: "osrm_unreachable", osrm: false });
  }
});

app.get("/api/route", async (req, res) => {
  try {
    const { from, to, preference = "balanced", exclude } = req.query as Record<string, string>;

    if (!from || !to) {
      return res.status(400).json({ error: "from and to query params required (lat,lng)" });
    }

    const [fromLat, fromLng] = from.split(",").map(Number);
    const [toLat, toLng] = to.split(",").map(Number);

    if (isNaN(fromLat) || isNaN(fromLng) || isNaN(toLat) || isNaN(toLng)) {
      return res.status(400).json({ error: "Invalid coordinates" });
    }

    // Check cache
    const cacheKey = `${from}|${to}|${preference}|${exclude || ""}`;
    const cached = getCachedRoute(cacheKey);
    if (cached) return res.json(cached);

    // Call OSRM
    let osrmUrl = `${OSRM_URL}/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?steps=true&alternatives=3&overview=full&geometries=polyline`;
    if (exclude) osrmUrl += `&exclude=${exclude}`;

    const osrmRes = await fetch(osrmUrl);
    if (!osrmRes.ok) {
      return res.status(502).json({ error: `OSRM error: ${osrmRes.status}` });
    }
    const osrmData = await osrmRes.json() as any;

    if (!osrmData.routes || osrmData.routes.length === 0) {
      return res.status(404).json({ error: "No route found" });
    }

    // Process each route alternative
    const routeResults: RouteResult[] = [];

    for (const route of osrmData.routes) {
      const routeCoords = decodePolyline(route.geometry);

      // Fetch detailed OSM nodes for this route corridor
      let detailedCoords: [number, number][];
      try {
        detailedCoords = await fetchRouteCorridorNodes(routeCoords);
        if (detailedCoords.length < 3) detailedCoords = routeCoords;
      } catch {
        detailedCoords = routeCoords; // Fallback to OSRM coords
      }

      // Compute curvature for the route geometry (use OSRM coords for the route itself)
      const segments = computeSegmentCurvatures(routeCoords);
      const totalScore = computeTotalCurvatureScore(segments);
      const curveCards = extractCurveCards(segments);

      // Extract turn instructions from OSRM
      const turns = route.legs.flatMap((leg: any) => {
        let dist = 0;
        return (leg.steps || []).map((step: any) => {
          const turn = {
            type: step.maneuver?.type || "unknown",
            modifier: step.maneuver?.modifier || "",
            exit: step.maneuver?.exit,
            name: step.name || "",
            distanceFromStart: dist,
            duration: step.duration,
            distance: step.distance,
          };
          dist += step.distance;
          return turn;
        }).filter((t: any) => t.type !== "depart" && t.type !== "arrive");
      });

      routeResults.push({
        label: "", // Set after sorting
        curvatureScore: totalScore,
        durationMin: Math.round(route.duration / 60),
        distanceKm: Math.round(route.distance / 100) / 10,
        geometry: route.geometry,
        segments: segments.map(s => ({
          from: s.from,
          to: s.to,
          radius: Math.round(s.radius),
          grade: s.grade,
          color: s.color,
        })),
        curves: curveCards,
        turns,
        selected: false,
      });
    }

    // Sort by curvature score (highest first)
    routeResults.sort((a, b) => b.curvatureScore - a.curvatureScore);

    // Label routes
    if (routeResults.length >= 3) {
      routeResults[0].label = "Scenic";
      routeResults[routeResults.length - 1].label = "Fastest";
      for (let i = 1; i < routeResults.length - 1; i++) {
        routeResults[i].label = "Balanced";
      }
    } else if (routeResults.length === 2) {
      routeResults[0].label = "Scenic";
      routeResults[1].label = "Fastest";
    } else {
      routeResults[0].label = "Route";
    }

    // Select based on preference
    for (const r of routeResults) {
      if (preference === "curvy" && r.label === "Scenic") r.selected = true;
      else if (preference === "fastest" && r.label === "Fastest") r.selected = true;
      else if (preference === "balanced" && r.label === "Balanced") r.selected = true;
    }
    // Fallback: select first if none matched
    if (!routeResults.some(r => r.selected)) routeResults[0].selected = true;

    const response = { routes: routeResults };
    setCachedRoute(cacheKey, response);
    res.json(response);
  } catch (err: any) {
    console.error("[Route Error]", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3457;
app.listen(PORT, () => {
  console.log(`Curves Engine: http://localhost:${PORT}`);
  console.log(`OSRM backend: ${OSRM_URL}`);
});
```

**Step 2: Test locally**

```bash
cd backend/curves-engine
OSRM_URL=http://localhost:5000 bun run dev &
sleep 2
curl -s "http://localhost:3457/api/route?from=56.17,9.55&to=55.68,12.57&preference=curvy" | jq '{routes_count: (.routes | length), first_label: .routes[0].label, first_score: .routes[0].curvatureScore, first_curves: (.routes[0].curves | length)}'
kill %1
```

Expected: JSON with routes_count >= 1, label "Scenic", curvatureScore > 0, curves count > 0

**Step 3: Commit**

```bash
git add backend/curves-engine/src/server.ts
git commit -m "Implement /api/route endpoint with curvature analysis and route ranking"
```

---

### Task 7: Add curves-engine to docker-compose

**Files:**
- Modify: `backend/docker-compose.yml`

**Step 1: Add curves-engine service**

```yaml
  curves-engine:
    build: ./curves-engine
    ports:
      - "3457:3457"
    environment:
      OSRM_URL: http://osrm:5000
      PORT: "3457"
    depends_on:
      osrm:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3457/api/route/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped
```

**Step 2: Test full stack**

```bash
cd /Users/milo/milodev/gits/routr
docker compose -f backend/docker-compose.yml up --build -d
sleep 10
docker compose -f backend/docker-compose.yml ps
curl -s http://localhost:3457/api/route/health | jq .
curl -s "http://localhost:3457/api/route?from=56.17,9.55&to=55.68,12.57" | jq '.routes | length'
docker compose -f backend/docker-compose.yml down
```

Expected: All services healthy, route returns results

**Step 3: Commit**

```bash
git add backend/docker-compose.yml
git commit -m "Add curves-engine to docker-compose"
```

---

### Phase 2 Verification Checklist

```bash
# All must pass:
cd backend/curves-engine && bun test && echo "PASS: unit tests" || echo "FAIL"
curl -sf "http://localhost:3457/api/route/health" | jq -e '.osrm == true' > /dev/null && echo "PASS: OSRM connected" || echo "FAIL"
curl -sf "http://localhost:3457/api/route?from=56.17,9.55&to=55.68,12.57&preference=curvy" | jq -e '.routes | length >= 1' > /dev/null && echo "PASS: route with curvature" || echo "FAIL"
curl -sf "http://localhost:3457/api/route?from=56.17,9.55&to=55.68,12.57" | jq -e '.routes[0].curves | length >= 1' > /dev/null && echo "PASS: curve cards" || echo "FAIL"
curl -sf "http://localhost:3457/api/route?from=56.17,9.55&to=55.68,12.57" | jq -e '.routes[0].turns | length >= 1' > /dev/null && echo "PASS: turn instructions" || echo "FAIL"
```
