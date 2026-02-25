import fs from "fs";
import path from "path";
import { refreshAccessToken, type TokenResponse } from "./auth";

const ACCOUNTS_FILE = path.join(import.meta.dir, "..", ".accounts.jsonl");

export interface Account {
  username: string;
  appInstallationId: string;
  tokens: TokenResponse;
  obtainedAt: number;
  dead?: boolean;
  deadReason?: string;
  deadAt?: number;
}

export function readAccounts(): Account[] {
  try {
    if (!fs.existsSync(ACCOUNTS_FILE)) return [];
    const lines = fs.readFileSync(ACCOUNTS_FILE, "utf-8").trim().split("\n");
    return lines.filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function writeAccounts(accounts: Account[]): void {
  const data = accounts.map((a) => JSON.stringify(a)).join("\n") + "\n";
  fs.writeFileSync(ACCOUNTS_FILE, data);
}

export function appendAccount(account: Account): void {
  fs.appendFileSync(ACCOUNTS_FILE, JSON.stringify(account) + "\n");
}

export function getAliveAccounts(): Account[] {
  return readAccounts().filter((a) => !a.dead);
}

export async function refreshAllAccounts(): Promise<{
  refreshed: number;
  died: number;
  skipped: number;
  errors: string[];
}> {
  const accounts = readAccounts();
  let refreshed = 0;
  let died = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const account of accounts) {
    if (account.dead) {
      skipped++;
      continue;
    }

    try {
      const newTokens = await refreshAccessToken(account.tokens.refresh_token);
      account.tokens = newTokens;
      account.obtainedAt = Date.now();
      refreshed++;
      console.log(`[Accounts] Refreshed ${account.username}`);
    } catch (err: any) {
      const msg = err.message || "";
      const statusMatch = msg.match(/\((\d+)\)/);
      const status = statusMatch ? Number(statusMatch[1]) : 0;

      if (status >= 400 && status < 500) {
        account.dead = true;
        account.deadReason = msg;
        account.deadAt = Date.now();
        died++;
        console.log(`[Accounts] Marked dead: ${account.username} (${status})`);
      } else {
        // 5xx or network error — skip, retry next cycle
        skipped++;
        errors.push(`${account.username}: ${msg}`);
        console.log(`[Accounts] Skipped ${account.username}: ${msg}`);
      }
    }
  }

  writeAccounts(accounts);
  return { refreshed, died, skipped, errors };
}

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
let cronTimer: ReturnType<typeof setInterval> | null = null;

export function startRefreshCron(): void {
  if (cronTimer) return;

  console.log("[Accounts] Refresh cron started (every 30min)");
  cronTimer = setInterval(async () => {
    const accounts = getAliveAccounts();
    if (accounts.length === 0) return;

    console.log(`[Accounts] Refreshing ${accounts.length} alive accounts...`);
    const result = await refreshAllAccounts();
    console.log(
      `[Accounts] Done: ${result.refreshed} refreshed, ${result.died} died, ${result.skipped} skipped`
    );
  }, REFRESH_INTERVAL_MS);
}

export function stopRefreshCron(): void {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
  }
}
