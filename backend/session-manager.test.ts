import { describe, test, expect, mock, beforeEach } from "bun:test";
import { SessionManager } from "./session-manager";
import type { Account } from "./accounts";

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

function mockWs() {
  const sent: string[] = [];
  return {
    send: mock((data: string) => sent.push(data)),
    readyState: 1,
    _sent: sent,
  };
}

describe("SessionManager", () => {
  test("create returns a session with a checked-out account", async () => {
    const accts = [makeAccount("a@test.com")];
    const mgr = new SessionManager({
      readAccounts: () => accts,
      createGrpcClient: (token, appId) => ({
        startTrip: mock(() => {}),
        sendLocationUpdate: mock(() => {}),
        stopTrip: mock(() => {}),
        close: mock(() => {}),
        dynamicPois: new Map(),
        staticPois: new Map(),
      } as any),
    });

    const ws = mockWs();
    const session = await mgr.create(ws as any);

    expect(session).not.toBeNull();
    expect(session!.account.username).toBe("a@test.com");
    expect(mgr.sessionCount()).toBe(1);
  });

  test("destroy releases account back to pool", async () => {
    const accts = [makeAccount("a@test.com")];
    const mgr = new SessionManager({
      readAccounts: () => accts,
      createGrpcClient: () => ({
        startTrip: mock(() => {}),
        sendLocationUpdate: mock(() => {}),
        stopTrip: mock(() => {}),
        close: mock(() => {}),
        dynamicPois: new Map(),
        staticPois: new Map(),
      } as any),
    });

    const ws = mockWs();
    const session = await mgr.create(ws as any);
    mgr.destroy(session!.id);

    expect(mgr.sessionCount()).toBe(0);

    // Account should be available again
    const ws2 = mockWs();
    const session2 = await mgr.create(ws2 as any);
    expect(session2!.account.username).toBe("a@test.com");
  });

  test("create returns null when no accounts available and no auto-register", async () => {
    const mgr = new SessionManager({
      readAccounts: () => [],
      createGrpcClient: () => ({} as any),
    });

    const ws = mockWs();
    const session = await mgr.create(ws as any);
    expect(session).toBeNull();
  });
});
