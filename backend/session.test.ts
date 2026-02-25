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
});
