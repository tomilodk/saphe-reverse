import type { Account } from "./accounts";

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

  checkout(): Account | null {
    const accounts = this.opts.readAccounts();
    for (const acct of accounts) {
      if (!acct.dead && !this.checkedOut.has(acct.username)) {
        this.checkedOut.add(acct.username);
        return acct;
      }
    }
    return null;
  }

  async checkoutOrRegister(): Promise<Account> {
    const existing = this.checkout();
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
