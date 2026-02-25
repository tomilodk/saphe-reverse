# Phase 3: Saphe Backend — WebSocket + Docker

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a WebSocket endpoint to the saphe-reverse backend that pushes live POI updates to connected clients, and verify the Dockerfile works in docker-compose.

**Architecture:** The existing Express server gets a WebSocket upgrade handler at `/ws/pois`. When the gRPC stream receives POI updates, they're broadcast to all connected WebSocket clients. The app will connect to this instead of polling GET /api/pois.

**Tech Stack:** Bun (native WebSocket support), Express, ws library

---

### Task 1: Add ws dependency

**Files:**
- Modify: `backend/saphe-reverse/package.json`

**Step 1: Install ws**

```bash
cd backend/saphe-reverse
bun add ws @types/ws
```

**Step 2: Commit**

```bash
git add package.json bun.lock
git commit -m "Add ws package for WebSocket support"
```

---

### Task 2: Implement WebSocket endpoint with tests

**Files:**
- Create: `backend/saphe-reverse/backend/ws.ts`
- Create: `backend/saphe-reverse/backend/ws.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { WebSocket } from "ws";
import { createWSServer, broadcastPoi } from "./ws";
import http from "http";

let server: http.Server;
let port: number;

beforeAll(async () => {
  server = http.createServer();
  const wss = createWSServer(server);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as any).port;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
});

describe("WebSocket POI broadcast", () => {
  test("client receives POI updates", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/pois`);
    const messages: any[] = [];

    await new Promise<void>((resolve) => {
      ws.on("open", resolve);
    });

    ws.on("message", (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    broadcastPoi({
      id: "test-1",
      type: "Fixed Speed Camera",
      typeCode: 1,
      state: "Active",
      latitude: 56.17,
      longitude: 9.55,
      speedLimitKmh: 80,
      roadName: "Silkeborgvej",
      city: "Silkeborg",
    });

    await new Promise((r) => setTimeout(r, 100));
    ws.close();

    expect(messages.length).toBe(1);
    expect(messages[0].type).toBe("poi_update");
    expect(messages[0].poi.id).toBe("test-1");
  });
});
```

**Step 2: Run test — should fail**

```bash
cd backend/saphe-reverse && bun test backend/ws.test.ts
```

**Step 3: Implement ws.ts**

```typescript
import { WebSocketServer, WebSocket } from "ws";
import type http from "http";

let wss: WebSocketServer | null = null;

export function createWSServer(server: http.Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: "/ws/pois" });

  wss.on("connection", (ws) => {
    console.log("[WS] Client connected");
    ws.on("close", () => console.log("[WS] Client disconnected"));
    ws.on("error", (err) => console.error("[WS] Error:", err.message));
  });

  return wss;
}

export function broadcastPoi(poi: any): void {
  if (!wss) return;
  const message = JSON.stringify({ type: "poi_update", poi, timestamp: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

export function broadcastPoiBatch(pois: any[]): void {
  if (!wss) return;
  const message = JSON.stringify({ type: "poi_batch", pois, timestamp: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

export function getConnectedClients(): number {
  return wss?.clients.size || 0;
}
```

**Step 4: Run test**

```bash
cd backend/saphe-reverse && bun test backend/ws.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/ws.ts backend/ws.test.ts
git commit -m "Implement WebSocket POI broadcast endpoint"
```

---

### Task 3: Integrate WebSocket into server.ts

**Files:**
- Modify: `backend/saphe-reverse/backend/server.ts`

**Step 1: Wire up WebSocket server and POI broadcast**

Add imports at top of server.ts:

```typescript
import http from "http";
import { createWSServer, broadcastPoi, getConnectedClients } from "./ws";
```

Replace the `app.listen` at the bottom with:

```typescript
const httpServer = http.createServer(app);
createWSServer(httpServer);

httpServer.listen(PORT, () => {
  const accounts = readAccounts();
  console.log(`\nSaphe POI Explorer: http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}/ws/pois`);
  console.log(`Auth status: ${auth ? 'logged in as ' + auth.username : 'not logged in'}`);
  console.log(`Accounts: ${accounts.filter(a => !a.dead).length} alive, ${accounts.filter(a => a.dead).length} dead\n`);
});
```

In `ensureClient()`, update the `onPoiUpdate` callback to also broadcast:

```typescript
grpcClient.onPoiUpdate = (poi) => {
  console.log(`[POI] ${poi.state} ${poi.type} at ${poi.latitude?.toFixed(5)}, ${poi.longitude?.toFixed(5)}`);
  broadcastPoi(poi);
};
```

Add a WebSocket status to the auth status endpoint:

```typescript
app.get("/api/auth/status", (_req, res) => {
  res.json({
    authenticated: !!auth,
    username: auth?.username || null,
    appInstallationId: auth?.appInstallationId || null,
    tokenAgeMin: auth ? Math.round((Date.now() - auth.obtainedAt) / 60000) : null,
    tokenExpiresIn: auth ? auth.tokens.expires_in : null,
    wsClients: getConnectedClients(),
  });
});
```

**Step 2: Test server starts with WebSocket**

```bash
cd backend/saphe-reverse && bun run dev &
sleep 2
curl -s http://localhost:3456/api/auth/status | jq .wsClients
kill %1
```

Expected: `0` (no WS clients connected)

**Step 3: Test WebSocket connection**

```bash
# In one terminal:
cd backend/saphe-reverse && bun run dev &
sleep 2
# In another (or same with background):
echo '{}' | websocat ws://localhost:3456/ws/pois &
sleep 1
curl -s http://localhost:3456/api/auth/status | jq .wsClients
kill %1 %2
```

Expected: `wsClients: 1`

**Step 4: Commit**

```bash
git add backend/server.ts
git commit -m "Integrate WebSocket into server.ts, broadcast POI updates to WS clients"
```

---

### Task 4: Verify Dockerfile in docker-compose

**Step 1: Build and start in docker-compose**

```bash
cd /Users/milo/milodev/gits/routr
docker compose -f backend/docker-compose.yml build saphe
docker compose -f backend/docker-compose.yml up saphe -d
sleep 5
```

**Step 2: Verify health check**

```bash
docker compose -f backend/docker-compose.yml ps saphe
curl -s http://localhost:3456/api/auth/status | jq .
```

Expected: Service healthy, JSON response

**Step 3: Verify WebSocket through Docker**

```bash
echo '{}' | timeout 3 websocat ws://localhost:3456/ws/pois || echo "WS connection established (timeout is normal)"
```

**Step 4: Commit if any docker-compose changes needed**

```bash
docker compose -f backend/docker-compose.yml down
```

---

### Phase 3 Verification Checklist

```bash
# All must pass:
cd backend/saphe-reverse && bun test && echo "PASS: unit tests" || echo "FAIL"
curl -sf http://localhost:3456/api/auth/status | jq -e '.wsClients != null' > /dev/null && echo "PASS: WS status field" || echo "FAIL"
curl -sf http://localhost:3456/api/pois > /dev/null && echo "PASS: REST still works" || echo "FAIL"
docker compose -f backend/docker-compose.yml ps saphe | grep -q healthy && echo "PASS: Docker healthy" || echo "FAIL"
```
