import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { WebSocket } from "ws";
import { createWSServer, broadcastPoi, broadcastPoiBatch, getConnectedClients } from "./ws";
import http from "http";

let server: http.Server;
let port: number;

beforeAll(async () => {
  server = http.createServer();
  createWSServer(server);
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

function connectClient(): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/pois`);
    ws.on("open", () => resolve(ws));
  });
}

describe("WebSocket POI broadcast", () => {
  test("client receives POI updates", async () => {
    const ws = await connectClient();
    const messages: any[] = [];

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
    expect(messages[0].timestamp).toBeNumber();
  });

  test("multiple clients receive broadcast", async () => {
    const ws1 = await connectClient();
    const ws2 = await connectClient();
    const msgs1: any[] = [];
    const msgs2: any[] = [];

    ws1.on("message", (data) => msgs1.push(JSON.parse(data.toString())));
    ws2.on("message", (data) => msgs2.push(JSON.parse(data.toString())));

    broadcastPoi({ id: "test-2", type: "Mobile Speed Camera", state: "Active" });

    await new Promise((r) => setTimeout(r, 100));
    ws1.close();
    ws2.close();

    expect(msgs1.length).toBe(1);
    expect(msgs2.length).toBe(1);
    expect(msgs1[0].poi.id).toBe("test-2");
    expect(msgs2[0].poi.id).toBe("test-2");
  });

  test("batch broadcast sends all POIs", async () => {
    const ws = await connectClient();
    const messages: any[] = [];

    ws.on("message", (data) => messages.push(JSON.parse(data.toString())));

    broadcastPoiBatch([
      { id: "batch-1", type: "Camera", state: "Active" },
      { id: "batch-2", type: "Spot Check", state: "Active" },
    ]);

    await new Promise((r) => setTimeout(r, 100));
    ws.close();

    expect(messages.length).toBe(1);
    expect(messages[0].type).toBe("poi_batch");
    expect(messages[0].pois.length).toBe(2);
  });

  test("getConnectedClients returns correct count", async () => {
    const ws1 = await connectClient();
    const ws2 = await connectClient();

    // Give a moment for the server to register connections
    await new Promise((r) => setTimeout(r, 50));
    expect(getConnectedClients()).toBeGreaterThanOrEqual(2);

    ws1.close();
    ws2.close();
    await new Promise((r) => setTimeout(r, 100));
  });
});
