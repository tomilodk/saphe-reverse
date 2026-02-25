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
});
