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
