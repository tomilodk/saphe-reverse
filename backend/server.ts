import express from "express";
import {
  requestVerificationCode,
  requestAccessToken,
  refreshAccessToken,
  registerUser,
  generateAppInstallationId,
  saveAuth,
  loadAuth,
  clearAuth,
  createTempEmail,
  waitForOTP,
  type PersistedAuth,
} from "./auth";
import { SapheGrpcClient, POI_TYPE_NAMES } from "./grpc-client";
import {
  appendAccount,
  readAccounts,
  refreshAllAccounts,
  startRefreshCron,
} from "./accounts";
import http from "http";
import { createWSServer, getConnectedClients } from "./ws";
import { SessionManager } from "./session-manager";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS for React dev server
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (_req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---- State ----
// Primary auth is kept for manual login/admin — not used for device sessions
let auth: PersistedAuth | null = null;

// ---- Bootstrap: try loading persisted tokens ----
async function bootstrap() {
  auth = loadAuth();
  if (!auth) {
    console.log("[Auth] No saved tokens found");
    return;
  }

  console.log(`[Auth] Found saved tokens for ${auth.username}`);
  const ageMs = Date.now() - auth.obtainedAt;
  const expiresMs = auth.tokens.expires_in * 1000;

  if (ageMs > expiresMs - 60000) {
    console.log("[Auth] Token expired, attempting refresh...");
    try {
      const newTokens = await refreshAccessToken(auth.tokens.refresh_token);
      auth.tokens = newTokens;
      auth.obtainedAt = Date.now();
      saveAuth(auth);
      console.log("[Auth] Token refreshed successfully");
    } catch (err: any) {
      console.log(`[Auth] Refresh failed: ${err.message}`);
      console.log("[Auth] You'll need to re-login");
      auth = null;
    }
  } else {
    console.log(
      `[Auth] Token still valid (${Math.round((expiresMs - ageMs) / 60000)}min remaining)`
    );
  }
}

// ---- Auto-register helper (used by SessionManager when pool is empty) ----
async function autoRegisterAccount(): Promise<ReturnType<typeof readAccounts>[number]> {
  console.log("[AutoReg] No accounts available, registering new one...");
  const { email, password: _mailPass, mailToken } = await createTempEmail();
  console.log(`[AutoReg] Email created: ${email}`);

  const regResult = await registerUser(email);
  if (!regResult.ok) throw new Error(`Registration failed: ${regResult.error}`);

  const otpResult = await requestVerificationCode(email);
  if (!otpResult.ok) throw new Error(`OTP request failed: ${otpResult.error}`);

  const otp = await waitForOTP(mailToken, 90000);
  console.log(`[AutoReg] OTP received for ${email}`);

  const tokens = await requestAccessToken(email, otp);
  const appInstallationId = generateAppInstallationId();

  const account = { username: email, appInstallationId, tokens, obtainedAt: Date.now() };
  appendAccount(account);
  console.log(`[AutoReg] Account ${email} registered and saved`);

  return account;
}

// ---- SessionManager ----
const sessionManager = new SessionManager({
  readAccounts,
  autoRegister: autoRegisterAccount,
  createGrpcClient: (accessToken, appInstallationId) =>
    new SapheGrpcClient(accessToken, appInstallationId),
});

// ============ API Routes ============

// -- Auth (kept for admin/manual use) --
app.get("/api/auth/status", (_req, res) => {
  res.json({
    authenticated: !!auth,
    username: auth?.username || null,
    appInstallationId: auth?.appInstallationId || null,
    tokenAgeMin: auth
      ? Math.round((Date.now() - auth.obtainedAt) / 60000)
      : null,
    tokenExpiresIn: auth ? auth.tokens.expires_in : null,
    wsClients: getConnectedClients(),
    activeSessions: sessionManager.sessionCount(),
  });
});

app.post("/api/auth/request-otp", async (req, res) => {
  try {
    const { username } = req.body;
    if (!username)
      return res.status(400).json({ ok: false, error: "username required" });

    const result = await requestVerificationCode(username);
    if (result.userNotFound) {
      return res.json({
        ok: false,
        userNotFound: true,
        message: "Account not found. Register first.",
      });
    }
    res.json({ ok: result.ok, error: result.error });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, firstName, lastName, country, language } = req.body;
    if (!email)
      return res.status(400).json({ ok: false, error: "email required" });

    const result = await registerUser(
      email,
      firstName,
      lastName,
      country,
      language
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res
        .status(400)
        .json({ ok: false, error: "username and password required" });

    const tokens = await requestAccessToken(username, password);
    const appInstallationId =
      auth?.appInstallationId || generateAppInstallationId();

    auth = { tokens, username, appInstallationId, obtainedAt: Date.now() };
    saveAuth(auth);

    res.json({ ok: true, expiresIn: tokens.expires_in });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/auth/refresh", async (_req, res) => {
  try {
    if (!auth)
      return res.status(400).json({ ok: false, error: "no saved auth" });

    const tokens = await refreshAccessToken(auth.tokens.refresh_token);
    auth.tokens = tokens;
    auth.obtainedAt = Date.now();
    saveAuth(auth);

    res.json({ ok: true, expiresIn: tokens.expires_in });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/auth/logout", (_req, res) => {
  auth = null;
  clearAuth();
  res.json({ ok: true });
});

// -- Info --
app.get("/api/poi-types", (_req, res) => {
  res.json(POI_TYPE_NAMES);
});

// -- Accounts --
app.get("/api/accounts", (_req, res) => {
  const accounts = readAccounts();
  const pool = sessionManager.getPool();
  res.json({
    total: accounts.length,
    alive: accounts.filter((a) => !a.dead).length,
    dead: accounts.filter((a) => a.dead).length,
    checkedOut: pool.activeCount(),
    accounts: accounts.map((a) => ({
      username: a.username,
      appInstallationId: a.appInstallationId,
      obtainedAt: a.obtainedAt,
      ageMin: Math.round((Date.now() - a.obtainedAt) / 60000),
      dead: a.dead || false,
      deadReason: a.deadReason,
      deadAt: a.deadAt,
      inUse: pool.isCheckedOut(a.username),
    })),
  });
});

app.post("/api/accounts/refresh", async (_req, res) => {
  try {
    const result = await refreshAllAccounts();
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============ Start ============
const PORT = process.env.PORT || 3456;

const httpServer = http.createServer(app);
createWSServer(httpServer, sessionManager);

bootstrap().then(() => {
  startRefreshCron();

  httpServer.listen(PORT, () => {
    const accounts = readAccounts();
    console.log(`\nSaphe POI Explorer: http://localhost:${PORT}`);
    console.log(`WebSocket: ws://localhost:${PORT}/ws/pois`);
    console.log(
      `Auth status: ${auth ? "logged in as " + auth.username : "not logged in"}`
    );
    console.log(
      `Accounts: ${accounts.filter((a) => !a.dead).length} alive, ${accounts.filter((a) => a.dead).length} dead\n`
    );
  });
});
