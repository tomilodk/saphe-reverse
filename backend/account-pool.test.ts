import { describe, test, expect, beforeEach } from "bun:test";
import { AccountPool } from "./account-pool";
import type { Account } from "./accounts";

function makeAccount(username: string, dead = false): Account {
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
    dead,
  };
}

describe("AccountPool", () => {
  let pool: AccountPool;

  beforeEach(() => {
    pool = new AccountPool({ readAccounts: () => [] });
  });

  test("checkout returns null when pool is empty", () => {
    expect(pool.checkout()).toBeNull();
  });

  test("checkout returns alive account", () => {
    const accts = [makeAccount("a@test.com")];
    pool = new AccountPool({ readAccounts: () => accts });
    const account = pool.checkout();
    expect(account).not.toBeNull();
    expect(account!.username).toBe("a@test.com");
  });

  test("checkout skips dead accounts", () => {
    const accts = [makeAccount("dead@test.com", true), makeAccount("alive@test.com")];
    pool = new AccountPool({ readAccounts: () => accts });
    const account = pool.checkout();
    expect(account!.username).toBe("alive@test.com");
  });

  test("checkout does not return already checked-out account", () => {
    const accts = [makeAccount("a@test.com")];
    pool = new AccountPool({ readAccounts: () => accts });
    pool.checkout();
    expect(pool.checkout()).toBeNull();
  });

  test("release makes account available again", () => {
    const accts = [makeAccount("a@test.com")];
    pool = new AccountPool({ readAccounts: () => accts });
    pool.checkout();
    pool.release("a@test.com");
    const account = pool.checkout();
    expect(account!.username).toBe("a@test.com");
  });

  test("activeCount tracks checked-out accounts", () => {
    const accts = [makeAccount("a@test.com"), makeAccount("b@test.com")];
    pool = new AccountPool({ readAccounts: () => accts });
    expect(pool.activeCount()).toBe(0);
    pool.checkout();
    expect(pool.activeCount()).toBe(1);
    pool.checkout();
    expect(pool.activeCount()).toBe(2);
    pool.release("a@test.com");
    expect(pool.activeCount()).toBe(1);
  });

  function makeAccountWithLocation(username: string, lat: number, lng: number, dead = false): Account {
    return {
      username,
      appInstallationId: `app-${username}`,
      tokens: { id_token: "id", access_token: `access-${username}`, refresh_token: `refresh-${username}`, expires_in: 3600, token_type: "Bearer", scope: "openid" },
      obtainedAt: Date.now(),
      dead,
      lastLat: lat,
      lastLng: lng,
      lastLocationAt: Date.now(),
    };
  }

  test("checkout with location returns closest account", () => {
    const accts = [
      makeAccountWithLocation("far@test.com", 57.0, 12.0),
      makeAccountWithLocation("close@test.com", 55.68, 12.57),
    ];
    pool = new AccountPool({ readAccounts: () => accts });
    const account = pool.checkout(55.67, 12.56);
    expect(account!.username).toBe("close@test.com");
  });

  test("checkout with location skips accounts beyond 75km", () => {
    const accts = [makeAccountWithLocation("far@test.com", 57.5, 12.0)];
    pool = new AccountPool({ readAccounts: () => accts });
    const account = pool.checkout(55.67, 12.56);
    expect(account).toBeNull();
  });

  test("checkout with location falls back to any account without location", () => {
    const accts = [makeAccount("noLocation@test.com")];
    pool = new AccountPool({ readAccounts: () => accts });
    const account = pool.checkout(55.67, 12.56);
    expect(account!.username).toBe("noLocation@test.com");
  });

  test("checkout without location still works (backward compat)", () => {
    const accts = [makeAccountWithLocation("a@test.com", 57.0, 12.0)];
    pool = new AccountPool({ readAccounts: () => accts });
    const account = pool.checkout();
    expect(account!.username).toBe("a@test.com");
  });

  test("checkout with location prefers no-location accounts over too-far accounts", () => {
    const accts = [
      makeAccountWithLocation("far@test.com", 60.0, 12.0),
      makeAccount("noLoc@test.com"),
    ];
    pool = new AccountPool({ readAccounts: () => accts });
    const account = pool.checkout(55.67, 12.56);
    expect(account!.username).toBe("noLoc@test.com");
  });

  test("checkoutOrRegister creates new account when all are too far", async () => {
    const accts = [makeAccountWithLocation("far@test.com", 60.0, 12.0)];
    const newAcct = makeAccount("new@test.com");
    pool = new AccountPool({
      readAccounts: () => accts,
      autoRegister: async () => newAcct,
    });
    const account = await pool.checkoutOrRegister(55.67, 12.56);
    expect(account.username).toBe("new@test.com");
  });
});
