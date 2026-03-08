import { describe, test, expect, mock } from "bun:test";
import { Session } from "./session";

function mockGrpcClient() {
  return {
    startTrip: mock(() => {}),
    sendLocationUpdate: mock(() => {}),
    stopTrip: mock(() => {}),
    close: mock(() => {}),
    dynamicPois: new Map(),
    staticPois: new Map(),
    onPoiUpdate: undefined as any,
    onStaticPoi: undefined as any,
    onTileVersion: undefined as any,
    onConfig: undefined as any,
    onError: undefined as any,
  };
}

function mockWs() {
  const sent: string[] = [];
  return {
    send: mock((data: string) => sent.push(data)),
    readyState: 1,
    _sent: sent,
  };
}

describe("Session", () => {
  test("startTrip creates gRPC trip and sets tripUuid", () => {
    const client = mockGrpcClient();
    const ws = mockWs();
    const session = new Session("s1", ws as any, { username: "a@test.com" } as any, client as any);

    session.startTrip(55.67, 12.56, 80, 0);

    expect(client.startTrip).toHaveBeenCalledWith(55.67, 12.56, 80 / 3.6, 0);
    expect(session.tripUuid).not.toBeNull();
  });

  test("moveTrip sends location update", () => {
    const client = mockGrpcClient();
    const ws = mockWs();
    const session = new Session("s1", ws as any, { username: "a@test.com" } as any, client as any);

    session.startTrip(55.67, 12.56, 80, 0);
    session.moveTrip(55.68, 12.57, 90, 45);

    expect(client.sendLocationUpdate).toHaveBeenCalled();
  });

  test("moveTrip without active trip is a no-op", () => {
    const client = mockGrpcClient();
    const ws = mockWs();
    const session = new Session("s1", ws as any, { username: "a@test.com" } as any, client as any);

    session.moveTrip(55.68, 12.57, 90, 45);

    expect(client.sendLocationUpdate).not.toHaveBeenCalled();
  });

  test("stopTrip clears trip state", () => {
    const client = mockGrpcClient();
    const ws = mockWs();
    const session = new Session("s1", ws as any, { username: "a@test.com" } as any, client as any);

    session.startTrip(55.67, 12.56, 80, 0);
    session.stopTrip();

    expect(client.stopTrip).toHaveBeenCalled();
    expect(session.tripUuid).toBeNull();
  });

  test("cleanup stops trip and closes gRPC client", () => {
    const client = mockGrpcClient();
    const ws = mockWs();
    const session = new Session("s1", ws as any, { username: "a@test.com" } as any, client as any);

    session.startTrip(55.67, 12.56, 80, 0);
    session.cleanup();

    expect(client.stopTrip).toHaveBeenCalled();
    expect(client.close).toHaveBeenCalled();
  });

  test("sendMessage sends JSON to WebSocket", () => {
    const client = mockGrpcClient();
    const ws = mockWs();
    const session = new Session("s1", ws as any, { username: "a@test.com" } as any, client as any);

    session.sendMessage({ type: "test", data: 123 });

    expect(ws._sent.length).toBe(1);
    const parsed = JSON.parse(ws._sent[0]);
    expect(parsed.type).toBe("test");
    expect(parsed.data).toBe(123);
  });

  test("session tracks sent POIs for sync", () => {
    const client = mockGrpcClient();
    const ws = mockWs();
    const session = new Session("s1", ws as any, { username: "a@test.com" } as any, client as any);

    // Simulate the grpc client calling onPoiUpdate
    client.onPoiUpdate!({
      id: "poi1", type: "Fixed Speed Camera", typeCode: 0x010102,
      state: "Active", latitude: 55.67, longitude: 12.56,
      isTest: false, version: 1, hash: 100
    });

    expect(session.sentPois.has("poi1")).toBe(true);
    expect(session.sentPois.get("poi1")!.hash).toBe(100);
  });

  test("session removes deleted POIs from tracking", () => {
    const client = mockGrpcClient();
    const ws = mockWs();
    const session = new Session("s1", ws as any, { username: "a@test.com" } as any, client as any);

    client.onPoiUpdate!({
      id: "poi1", type: "Fixed Speed Camera", typeCode: 0x010102,
      state: "Active", latitude: 55.67, longitude: 12.56,
      isTest: false, version: 1, hash: 100
    });
    client.onPoiUpdate!({
      id: "poi1", type: "Fixed Speed Camera", typeCode: 0x010102,
      state: "Deleted", latitude: 55.67, longitude: 12.56,
      isTest: false, version: 2, hash: 101
    });

    expect(session.sentPois.has("poi1")).toBe(false);
  });

  test("handlePoisSync returns diff between client and server POIs", () => {
    const client = mockGrpcClient();
    const ws = mockWs();
    const session = new Session("s1", ws as any, { username: "a@test.com" } as any, client as any);

    const poi1 = { id: "poi1", type: "Fixed Speed Camera", typeCode: 0x010102, state: "Active", latitude: 55.67, longitude: 12.56, isTest: false, version: 1, hash: 100 };
    const poi2 = { id: "poi2", type: "Mobile Speed Camera", typeCode: 0x010101, state: "Active", latitude: 55.68, longitude: 12.57, isTest: false, version: 1, hash: 200 };
    client.onPoiUpdate!(poi1);
    client.onPoiUpdate!(poi2);

    const result = session.handlePoisSync([
      { id: "poi1", hash: 100 },
      { id: "poi3", hash: 300 },
    ]);

    expect(result.added.length).toBe(1);
    expect(result.added[0].id).toBe("poi2");
    expect(result.removed).toEqual(["poi3"]);
    expect(result.updated.length).toBe(0);
  });

  test("handlePoisSync detects updated POIs (different hash)", () => {
    const client = mockGrpcClient();
    const ws = mockWs();
    const session = new Session("s1", ws as any, { username: "a@test.com" } as any, client as any);

    client.onPoiUpdate!({
      id: "poi1", type: "Fixed Speed Camera", typeCode: 0x010102,
      state: "Active", latitude: 55.67, longitude: 12.56,
      isTest: false, version: 2, hash: 150
    });

    const result = session.handlePoisSync([{ id: "poi1", hash: 100 }]);

    expect(result.updated.length).toBe(1);
    expect(result.updated[0].id).toBe("poi1");
    expect(result.updated[0].hash).toBe(150);
    expect(result.added.length).toBe(0);
    expect(result.removed.length).toBe(0);
  });

  test("handlePoisSync with empty client and server returns all empty", () => {
    const client = mockGrpcClient();
    const ws = mockWs();
    const session = new Session("s1", ws as any, { username: "a@test.com" } as any, client as any);

    const result = session.handlePoisSync([]);
    expect(result.added.length).toBe(0);
    expect(result.removed.length).toBe(0);
    expect(result.updated.length).toBe(0);
  });
});
