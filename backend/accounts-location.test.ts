import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import { readAccounts, appendAccount, updateAccountLocation } from "./accounts";
import type { Account } from "./accounts";

const ACCOUNTS_FILE = path.join(import.meta.dirname, "..", ".accounts.jsonl");

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

describe("Account location tracking", () => {
  let originalFile: string | null = null;

  beforeEach(() => {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      originalFile = fs.readFileSync(ACCOUNTS_FILE, "utf-8");
    }
    if (fs.existsSync(ACCOUNTS_FILE)) fs.unlinkSync(ACCOUNTS_FILE);
  });

  afterEach(() => {
    if (originalFile != null) {
      fs.writeFileSync(ACCOUNTS_FILE, originalFile);
    } else if (fs.existsSync(ACCOUNTS_FILE)) {
      fs.unlinkSync(ACCOUNTS_FILE);
    }
    originalFile = null;
  });

  test("updateAccountLocation sets lat/lng/timestamp", () => {
    const acct = makeAccount("a@test.com");
    appendAccount(acct);
    updateAccountLocation("a@test.com", 55.67, 12.56);
    const accounts = readAccounts();
    expect(accounts.length).toBe(1);
    expect(accounts[0].lastLat).toBe(55.67);
    expect(accounts[0].lastLng).toBe(12.56);
    expect(accounts[0].lastLocationAt).toBeGreaterThan(0);
  });

  test("updateAccountLocation only updates matching account", () => {
    appendAccount(makeAccount("a@test.com"));
    appendAccount(makeAccount("b@test.com"));
    updateAccountLocation("a@test.com", 55.67, 12.56);
    const accounts = readAccounts();
    expect(accounts[0].lastLat).toBe(55.67);
    expect(accounts[1].lastLat).toBeUndefined();
  });

  test("updateAccountLocation no-ops for unknown username", () => {
    appendAccount(makeAccount("a@test.com"));
    updateAccountLocation("unknown@test.com", 55.67, 12.56);
    const accounts = readAccounts();
    expect(accounts[0].lastLat).toBeUndefined();
  });
});
