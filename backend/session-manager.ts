import type { WebSocket } from "ws";
import { AccountPool } from "./account-pool";
import { Session } from "./session";
import type { Account } from "./accounts";
import type { SapheGrpcClient } from "./grpc-client";

interface SessionManagerOptions {
  readAccounts: () => Account[];
  autoRegister?: () => Promise<Account>;
  createGrpcClient: (accessToken: string, appInstallationId: string) => SapheGrpcClient;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private pool: AccountPool;
  private opts: SessionManagerOptions;

  constructor(opts: SessionManagerOptions) {
    this.opts = opts;
    this.pool = new AccountPool({
      readAccounts: opts.readAccounts,
      autoRegister: opts.autoRegister,
    });
  }

  async create(ws: WebSocket): Promise<Session | null> {
    let account: Account | null;

    if (this.opts.autoRegister) {
      try {
        account = await this.pool.checkoutOrRegister();
      } catch {
        return null;
      }
    } else {
      account = this.pool.checkout();
    }

    if (!account) return null;

    const grpcClient = this.opts.createGrpcClient(account.tokens.access_token, account.appInstallationId);
    const id = crypto.randomUUID();
    const session = new Session(id, ws, account, grpcClient);

    this.sessions.set(id, session);
    return session;
  }

  destroy(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.cleanup();
    this.pool.release(session.account.username);
    this.sessions.delete(sessionId);
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  sessionCount(): number {
    return this.sessions.size;
  }

  getPool(): AccountPool {
    return this.pool;
  }
}
