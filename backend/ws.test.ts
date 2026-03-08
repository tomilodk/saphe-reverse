import { describe, expect, test, beforeAll, afterAll, mock } from "bun:test";
import { WebSocket } from "ws";
import { createWSServer, getConnectedClients } from "./ws";
import { SessionManager } from "./session-manager";
import type { Account } from "./accounts";
import http from "http";

let server: http.Server;
let port: number;

function makeAccount(username: string): Account {
  return {
    username,
    appInstallationId: `app-${username}`,
    tokens: {
      id_token: "id",
      access_token: `access-${username}`,
      refresh_token: `refresh-${username}`,
      expires_in: 3600,
      token_type: "Bearer",
      scope: "openid",
    },
    obtainedAt: Date.now(),
  };
}

const accounts = [makeAccount("a@test.com"), makeAccount("b@test.com")];

const sessionManager = new SessionManager({
  readAccounts: () => accounts,
  createGrpcClient: () => ({
    startTrip: mock(() => {}),
    sendLocationUpdate: mock(() => {}),
    stopTrip: mock(() => {}),
    close: mock(() => {}),
    getTile: mock(async () => ({ metadata: null, ways: [], staticPois: [] })),
    dynamicPois: new Map(),
    staticPois: new Map(),
    onPoiUpdate: undefined,
    onStaticPoi: undefined,
    onTileVersion: undefined,
    onConfig: undefined,
    onError: undefined,
  } as any),
});

beforeAll(async () => {
  server = http.createServer();
  createWSServer(server, sessionManager);
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

function connectClient(): Promise<{ ws: WebSocket; messages: any[] }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/pois`);
    const messages: any[] = [];
    ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
    ws.on("open", () => resolve({ ws, messages }));
  });
}

describe("WebSocket per-session protocol", () => {
  test("client receives session:ready on connect", async () => {
    const { ws, messages } = await connectClient();
    await new Promise((r) => setTimeout(r, 100));

    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0].type).toBe("session:ready");
    expect(messages[0].sessionId).toBeString();

    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  test("trip:start returns trip:started", async () => {
    const { ws, messages } = await connectClient();
    await new Promise((r) => setTimeout(r, 100));

    ws.send(JSON.stringify({ type: "trip:start", lat: 55.67, lng: 12.56, speedKmh: 80 }));
    await new Promise((r) => setTimeout(r, 100));

    const started = messages.find((m) => m.type === "trip:started");
    expect(started).toBeDefined();
    expect(started.tripUuid).toBeString();

    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  test("two clients get separate sessions", async () => {
    const c1 = await connectClient();
    const c2 = await connectClient();
    await new Promise((r) => setTimeout(r, 100));

    const s1 = c1.messages.find((m) => m.type === "session:ready");
    const s2 = c2.messages.find((m) => m.type === "session:ready");

    expect(s1).toBeDefined();
    expect(s2).toBeDefined();
    expect(s1.sessionId).not.toBe(s2.sessionId);

    c1.ws.close();
    c2.ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  test("getConnectedClients returns correct count", async () => {
    const c1 = await connectClient();
    const c2 = await connectClient();
    await new Promise((r) => setTimeout(r, 100));

    expect(getConnectedClients()).toBeGreaterThanOrEqual(2);

    c1.ws.close();
    c2.ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });
});

describe("pois:sync protocol", () => {
  test("pois:sync with empty client list returns all server POIs as added", async () => {
    const { ws, messages } = await connectClient();
    await new Promise((r) => setTimeout(r, 100));
    ws.send(JSON.stringify({ type: "trip:start", lat: 55.67, lng: 12.56, speedKmh: 80 }));
    await new Promise((r) => setTimeout(r, 100));
    ws.send(JSON.stringify({ type: "pois:sync", pois: [] }));
    await new Promise((r) => setTimeout(r, 100));
    const result = messages.find((m) => m.type === "pois:sync_result");
    expect(result).toBeDefined();
    expect(result.added).toBeArray();
    expect(result.removed).toBeArray();
    expect(result.updated).toBeArray();
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  test("pois:sync with matching POIs returns no changes", async () => {
    const { ws, messages } = await connectClient();
    await new Promise((r) => setTimeout(r, 100));
    ws.send(JSON.stringify({ type: "pois:sync", pois: [] }));
    await new Promise((r) => setTimeout(r, 100));
    const result = messages.find((m) => m.type === "pois:sync_result");
    expect(result.added.length).toBe(0);
    expect(result.removed.length).toBe(0);
    expect(result.updated.length).toBe(0);
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  test("pois:sync removes POIs client has but server doesnt", async () => {
    const { ws, messages } = await connectClient();
    await new Promise((r) => setTimeout(r, 100));
    ws.send(JSON.stringify({ type: "pois:sync", pois: [{ id: "ghost-poi", hash: 999 }] }));
    await new Promise((r) => setTimeout(r, 100));
    const result = messages.find((m) => m.type === "pois:sync_result");
    expect(result.removed).toContain("ghost-poi");
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });
});

describe("connection with location query params", () => {
  test("client can connect with lat/lng query params", async () => {
    return new Promise<void>((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws/pois?lat=55.67&lng=12.56`);
      const messages: any[] = [];
      ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
      ws.on("open", async () => {
        await new Promise((r) => setTimeout(r, 100));
        expect(messages.length).toBeGreaterThanOrEqual(1);
        expect(messages[0].type).toBe("session:ready");
        ws.close();
        await new Promise((r) => setTimeout(r, 100));
        resolve();
      });
    });
  });
});

describe("heartbeat", () => {
  test("ping message returns pong", async () => {
    const { ws, messages } = await connectClient();
    await new Promise((r) => setTimeout(r, 100));
    ws.send(JSON.stringify({ type: "ping" }));
    await new Promise((r) => setTimeout(r, 100));
    const pong = messages.find((m) => m.type === "pong");
    expect(pong).toBeDefined();
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });
});

describe("trip lifecycle edge cases", () => {
  test("trip:start without lat/lng returns error", async () => {
    const { ws, messages } = await connectClient();
    await new Promise((r) => setTimeout(r, 100));
    ws.send(JSON.stringify({ type: "trip:start" }));
    await new Promise((r) => setTimeout(r, 100));
    const err = messages.find((m) => m.type === "backend_error" && m.source === "trip");
    expect(err).toBeDefined();
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  test("trip:move before trip:start is a no-op", async () => {
    const { ws, messages } = await connectClient();
    await new Promise((r) => setTimeout(r, 100));
    ws.send(JSON.stringify({ type: "trip:move", lat: 55.68, lng: 12.57, speedKmh: 90 }));
    await new Promise((r) => setTimeout(r, 100));
    const errors = messages.filter((m) => m.type === "backend_error" && m.source === "trip");
    expect(errors.length).toBe(0);
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  test("trip:stop without active trip sends trip:stopped", async () => {
    const { ws, messages } = await connectClient();
    await new Promise((r) => setTimeout(r, 100));
    ws.send(JSON.stringify({ type: "trip:stop" }));
    await new Promise((r) => setTimeout(r, 100));
    const stopped = messages.find((m) => m.type === "trip:stopped");
    expect(stopped).toBeDefined();
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  test("multiple trip:start restarts cleanly", async () => {
    const { ws, messages } = await connectClient();
    await new Promise((r) => setTimeout(r, 100));
    ws.send(JSON.stringify({ type: "trip:start", lat: 55.67, lng: 12.56, speedKmh: 80 }));
    await new Promise((r) => setTimeout(r, 100));
    ws.send(JSON.stringify({ type: "trip:start", lat: 55.68, lng: 12.57, speedKmh: 90 }));
    await new Promise((r) => setTimeout(r, 100));
    const started = messages.filter((m) => m.type === "trip:started");
    expect(started.length).toBe(2);
    expect(started[0].tripUuid).not.toBe(started[1].tripUuid);
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  test("unknown message type doesnt crash server", async () => {
    const { ws, messages } = await connectClient();
    await new Promise((r) => setTimeout(r, 100));
    ws.send(JSON.stringify({ type: "totally:unknown", data: 123 }));
    await new Promise((r) => setTimeout(r, 100));
    ws.send(JSON.stringify({ type: "trip:start", lat: 55.67, lng: 12.56 }));
    await new Promise((r) => setTimeout(r, 100));
    const started = messages.find((m) => m.type === "trip:started");
    expect(started).toBeDefined();
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  test("malformed JSON doesnt crash server", async () => {
    const { ws, messages } = await connectClient();
    await new Promise((r) => setTimeout(r, 100));
    ws.send("this is not json {{{");
    await new Promise((r) => setTimeout(r, 100));
    ws.send(JSON.stringify({ type: "trip:start", lat: 55.67, lng: 12.56 }));
    await new Promise((r) => setTimeout(r, 100));
    const started = messages.find((m) => m.type === "trip:started");
    expect(started).toBeDefined();
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });
});

describe("session cleanup", () => {
  test("client disconnect releases account back to pool", async () => {
    const c1 = await connectClient();
    const c2 = await connectClient();
    await new Promise((r) => setTimeout(r, 100));
    c1.ws.close();
    await new Promise((r) => setTimeout(r, 200));
    const c3 = await connectClient();
    await new Promise((r) => setTimeout(r, 100));
    const ready = c3.messages.find((m) => m.type === "session:ready");
    expect(ready).toBeDefined();
    c2.ws.close();
    c3.ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });
});
