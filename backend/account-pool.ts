import type { Account } from "./accounts";
import { haversineDistance } from "./geo";

const MAX_DISTANCE_M = 75_000; // 75km

interface AccountPoolOptions {
  readAccounts: () => Account[];
  autoRegister?: () => Promise<Account>;
}

export class AccountPool {
  private checkedOut = new Set<string>();
  private opts: AccountPoolOptions;

  constructor(opts: AccountPoolOptions) {
    this.opts = opts;
  }

  checkout(lat?: number, lng?: number): Account | null {
    const accounts = this.opts.readAccounts();
    const available = accounts.filter(
      (a) => !a.dead && !this.checkedOut.has(a.username)
    );

    if (available.length === 0) return null;

    // No location provided — return first available (backward compat)
    if (lat == null || lng == null) {
      this.checkedOut.add(available[0].username);
      return available[0];
    }

    // Separate accounts with and without location data
    const withLocation: Array<{ account: Account; distance: number }> = [];
    const withoutLocation: Account[] = [];

    for (const acct of available) {
      if (acct.lastLat != null && acct.lastLng != null) {
        const distance = haversineDistance(lat, lng, acct.lastLat, acct.lastLng);
        if (distance <= MAX_DISTANCE_M) {
          withLocation.push({ account: acct, distance });
        }
      } else {
        withoutLocation.push(acct);
      }
    }

    // Prefer closest account within 75km
    if (withLocation.length > 0) {
      withLocation.sort((a, b) => a.distance - b.distance);
      const best = withLocation[0].account;
      this.checkedOut.add(best.username);
      return best;
    }

    // Fall back to accounts without location data
    if (withoutLocation.length > 0) {
      this.checkedOut.add(withoutLocation[0].username);
      return withoutLocation[0];
    }

    // All accounts are too far
    return null;
  }

  async checkoutOrRegister(lat?: number, lng?: number): Promise<Account> {
    const existing = this.checkout(lat, lng);
    if (existing) return existing;

    if (!this.opts.autoRegister) {
      throw new Error("No accounts available and auto-register not configured");
    }

    const newAccount = await this.opts.autoRegister();
    this.checkedOut.add(newAccount.username);
    return newAccount;
  }

  release(username: string): void {
    this.checkedOut.delete(username);
  }

  activeCount(): number {
    return this.checkedOut.size;
  }

  isCheckedOut(username: string): boolean {
    return this.checkedOut.has(username);
  }
}
