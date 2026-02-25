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
import { appendAccount, readAccounts, refreshAllAccounts, startRefreshCron } from "./accounts";
import http from "http";
import { createWSServer, broadcastPoi, broadcastError, getConnectedClients } from "./ws";

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
let auth: PersistedAuth | null = null;
let grpcClient: SapheGrpcClient | null = null;
let tripInterval: ReturnType<typeof setInterval> | null = null;
let tripUuid: string | null = null;
let currentLat = 56.1694;
let currentLng = 9.5518;
let currentSpeed = 22.2;
let currentHeading = 0;

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
    console.log(`[Auth] Token still valid (${Math.round((expiresMs - ageMs) / 60000)}min remaining)`);
  }
}

// ---- Helpers ----
function ensureClient(): SapheGrpcClient {
  if (!auth) throw new Error("Not authenticated");
  if (!grpcClient) {
    grpcClient = new SapheGrpcClient(auth.tokens.access_token, auth.appInstallationId);
    grpcClient.onPoiUpdate = (poi) => {
      console.log(`[POI] ${poi.state} ${poi.type} at ${poi.latitude?.toFixed(5)}, ${poi.longitude?.toFixed(5)}`);
      broadcastPoi(poi);
    };
    grpcClient.onTileVersion = (tile) => {
      console.log(`[Tile] ${tile.id} v${tile.version}`);
      grpcClient!.getTile(tile.id).catch((err) => {
        console.error(`[Tile Error] ${tile.id}:`, err.message);
        broadcastError("tile", err.message);
      });
    };
    grpcClient.onError = (err) => {
      console.error("[gRPC Error]", err.message);
      broadcastError("grpc", err.message);
    };
  }
  return grpcClient;
}

function stopCurrentTrip() {
  if (tripInterval) {
    clearInterval(tripInterval);
    tripInterval = null;
  }
  if (grpcClient) {
    grpcClient.stopTrip();
  }
  tripUuid = null;
}

// ============ API Routes ============

// -- Auth --
app.get("/api/auth/status", (_req, res) => {
  res.json({
    authenticated: !!auth,
    username: auth?.username || null,
    appInstallationId: auth?.appInstallationId || null,
    tokenAgeMin: auth ? Math.round((Date.now() - auth.obtainedAt) / 60000) : null,
    tokenExpiresIn: auth ? auth.tokens.expires_in : null,
    wsClients: getConnectedClients(),
  });
});

app.post("/api/auth/request-otp", async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ ok: false, error: "username required" });

    const result = await requestVerificationCode(username);
    if (result.userNotFound) {
      return res.json({ ok: false, userNotFound: true, message: "Account not found. Register first." });
    }
    res.json({ ok: result.ok, error: result.error });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, firstName, lastName, country, language } = req.body;
    if (!email) return res.status(400).json({ ok: false, error: "email required" });

    const result = await registerUser(email, firstName, lastName, country, language);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ ok: false, error: "username and password required" });

    const tokens = await requestAccessToken(username, password);
    const appInstallationId = auth?.appInstallationId || generateAppInstallationId();

    auth = { tokens, username, appInstallationId, obtainedAt: Date.now() };
    saveAuth(auth);

    // Reset client so it picks up new token
    if (grpcClient) { grpcClient.close(); grpcClient = null; }

    res.json({ ok: true, expiresIn: tokens.expires_in });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/auth/refresh", async (_req, res) => {
  try {
    if (!auth) return res.status(400).json({ ok: false, error: "no saved auth" });

    const tokens = await refreshAccessToken(auth.tokens.refresh_token);
    auth.tokens = tokens;
    auth.obtainedAt = Date.now();
    saveAuth(auth);

    if (grpcClient) grpcClient.updateToken(tokens.access_token);

    res.json({ ok: true, expiresIn: tokens.expires_in });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/auth/auto-register", async (_req, res) => {
  try {
    res.json({ ok: true, status: "starting" });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// SSE endpoint for auto-register progress
app.get("/api/auth/auto-register-stream", async (_req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (data: any) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    send({ step: "Creating temp email..." });
    const { email, password: _mailPass, mailToken } = await createTempEmail();
    send({ step: `Email created: ${email}` });

    send({ step: "Registering account..." });
    const regResult = await registerUser(email);
    if (!regResult.ok) {
      send({ step: `Registration failed: ${regResult.error}`, error: true });
      res.end();
      return;
    }
    send({ step: "Account registered" });

    send({ step: "Requesting OTP..." });
    const otpResult = await requestVerificationCode(email);
    if (!otpResult.ok) {
      send({ step: `OTP request failed: ${otpResult.error}`, error: true });
      res.end();
      return;
    }
    send({ step: "OTP sent, waiting for email..." });

    const otp = await waitForOTP(mailToken, 90000);
    send({ step: `OTP received: ${otp}` });

    send({ step: "Exchanging OTP for tokens..." });
    const tokens = await requestAccessToken(email, otp);
    const appInstallationId = generateAppInstallationId();

    auth = { tokens, username: email, appInstallationId, obtainedAt: Date.now() };
    saveAuth(auth);

    // Persist to accounts JSONL
    appendAccount({ username: email, appInstallationId, tokens, obtainedAt: Date.now() });

    if (grpcClient) { grpcClient.close(); grpcClient = null; }

    send({ step: "Done! Logged in.", done: true, email });
  } catch (err: any) {
    send({ step: `Error: ${err.message}`, error: true });
  }

  res.end();
});

app.post("/api/auth/logout", (_req, res) => {
  stopCurrentTrip();
  if (grpcClient) { grpcClient.close(); grpcClient = null; }
  auth = null;
  clearAuth();
  res.json({ ok: true });
});

// -- Trip / POIs --
app.post("/api/trip/start", async (req, res) => {
  try {
    if (!auth) return res.status(401).json({ ok: false, error: "not authenticated" });

    const { latitude, longitude, speedKmh = 80, heading = 0, updateIntervalMs = 60000 } = req.body;
    if (latitude == null || longitude == null) return res.status(400).json({ ok: false, error: "latitude and longitude required" });

    stopCurrentTrip();

    currentLat = latitude;
    currentLng = longitude;
    currentSpeed = (speedKmh || 80) / 3.6;
    currentHeading = heading || 0;

    const client = ensureClient();
    tripUuid = crypto.randomUUID();

    client.startTrip(currentLat, currentLng, currentSpeed, currentHeading);

    // Periodic updates at the configured interval
    tripInterval = setInterval(() => {
      if (grpcClient && tripUuid) {
        grpcClient.sendLocationUpdate(tripUuid, currentLat, currentLng, currentSpeed, currentHeading);
      }
    }, updateIntervalMs);

    res.json({ ok: true, tripUuid });
  } catch (err: any) {
    broadcastError("trip", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/trip/move", (req, res) => {
  const { latitude, longitude, speedKmh, heading } = req.body;
  if (latitude != null) currentLat = latitude;
  if (longitude != null) currentLng = longitude;
  if (speedKmh != null) currentSpeed = speedKmh / 3.6;
  if (heading != null) currentHeading = heading;

  // Immediately send update when user navigates
  if (grpcClient && tripUuid) {
    grpcClient.sendLocationUpdate(tripUuid, currentLat, currentLng, currentSpeed, currentHeading);
  }
  res.json({ ok: true });
});

app.post("/api/trip/stop", (_req, res) => {
  stopCurrentTrip();
  res.json({ ok: true });
});

app.get("/api/pois", (_req, res) => {
  if (!grpcClient) return res.json({ dynamic: [], static: [] });
  res.json(grpcClient.getAllPois());
});

app.get("/api/poi-types", (_req, res) => {
  res.json(POI_TYPE_NAMES);
});

// -- Accounts --
app.get("/api/accounts", (_req, res) => {
  const accounts = readAccounts();
  res.json({
    total: accounts.length,
    alive: accounts.filter(a => !a.dead).length,
    dead: accounts.filter(a => a.dead).length,
    accounts: accounts.map(a => ({
      username: a.username,
      appInstallationId: a.appInstallationId,
      obtainedAt: a.obtainedAt,
      ageMin: Math.round((Date.now() - a.obtainedAt) / 60000),
      dead: a.dead || false,
      deadReason: a.deadReason,
      deadAt: a.deadAt,
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
createWSServer(httpServer);

bootstrap().then(() => {
  startRefreshCron();

  httpServer.listen(PORT, () => {
    const accounts = readAccounts();
    console.log(`\nSaphe POI Explorer: http://localhost:${PORT}`);
    console.log(`WebSocket: ws://localhost:${PORT}/ws/pois`);
    console.log(`Auth status: ${auth ? 'logged in as ' + auth.username : 'not logged in'}`);
    console.log(`Accounts: ${accounts.filter(a => !a.dead).length} alive, ${accounts.filter(a => a.dead).length} dead\n`);
  });
});
