import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";

const AUTH_URL = "https://auth-gateway.saphe.com";
const CLIENT_ID = "android";
const SCOPE =
  "openid profile email app_gateway app_features activation_codes offline_access";

const TOKEN_FILE = path.join(import.meta.dirname, "..", ".tokens.json");

export interface TokenResponse {
  id_token: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface PersistedAuth {
  tokens: TokenResponse;
  username: string;
  appInstallationId: string;
  obtainedAt: number; // epoch ms
}

// ---- Persistence ----

export function saveAuth(auth: PersistedAuth): void {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(auth, null, 2));
}

export function loadAuth(): PersistedAuth | null {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
    }
  } catch {}
  return null;
}

export function clearAuth(): void {
  try {
    fs.unlinkSync(TOKEN_FILE);
  } catch {}
}

// ---- Registration ----

export async function registerUser(
  email: string,
  firstName: string = "Alex",
  lastName: string = "Driver",
  country: string = "SE",
  language: string = "en"
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(
    `${AUTH_URL}/api/NativeAccount/RegisterUserAsync`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        Email: email,
        FirstName: firstName,
        LastName: lastName,
        EmailMarketingOptOut: "true",
        Country: country,
        Language: language,
        client_id: CLIENT_ID,
      }),
    }
  );

  if (res.ok) return { ok: true };

  const text = await res.text();
  // Check if it's a duplicate email (already registered)
  if (text.includes("DuplicateEmail") || text.includes("duplicate")) {
    return { ok: true }; // Already registered is fine
  }
  return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` };
}

// ---- OTP ----

export async function requestVerificationCode(
  username: string
): Promise<{ ok: boolean; userNotFound?: boolean; error?: string }> {
  const res = await fetch(
    `${AUTH_URL}/api/NativeAccount/RequestVerificationCodeAsync`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        UserName: username,
        client_id: CLIENT_ID,
      }),
    }
  );

  if (res.ok) return { ok: true };

  const text = await res.text();
  if (text.includes("user_not_found")) {
    return { ok: false, userNotFound: true };
  }
  return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` };
}

// ---- Token exchange ----

export async function requestAccessToken(
  username: string,
  password: string
): Promise<TokenResponse> {
  const res = await fetch(`${AUTH_URL}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      scope: SCOPE,
      UserName: username,
      Password: password,
      grant_type: "password",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token request failed (${res.status}): ${text}`);
  }

  return res.json();
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<TokenResponse> {
  const res = await fetch(`${AUTH_URL}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  return res.json();
}

// ---- Temp email (mail.tm) ----

const MAIL_TM_API = "https://api.mail.tm";

export async function createTempEmail(): Promise<{
  email: string;
  password: string;
  mailToken: string;
}> {
  // Get available domains
  const domainsRes = await fetch(`${MAIL_TM_API}/domains?page=1`);
  const domainsData: any = await domainsRes.json();
  const domains = domainsData["hydra:member"] || domainsData;
  if (!domains?.length) throw new Error("No temp email domains available");
  const domain = domains[0].domain;

  const localPart = `saphe${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `${localPart}@${domain}`;
  const password = uuidv4();

  // Create account
  const createRes = await fetch(`${MAIL_TM_API}/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: email, password }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Failed to create temp email: ${err}`);
  }

  // Get auth token for checking inbox
  const tokenRes = await fetch(`${MAIL_TM_API}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: email, password }),
  });

  if (!tokenRes.ok) throw new Error("Failed to get mail.tm token");
  const tokenData: any = await tokenRes.json();

  return { email, password, mailToken: tokenData.token };
}

export async function waitForOTP(
  mailToken: string,
  maxWaitMs: number = 60000
): Promise<string> {
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(`${MAIL_TM_API}/messages?page=1`, {
      headers: { Authorization: `Bearer ${mailToken}` },
    });

    if (res.ok) {
      const data: any = await res.json();
      const messages = data["hydra:member"] || data;

      if (messages?.length > 0) {
        // Get full message
        const msgRes = await fetch(`${MAIL_TM_API}/messages/${messages[0].id}`, {
          headers: { Authorization: `Bearer ${mailToken}` },
        });

        if (msgRes.ok) {
          const msg: any = await msgRes.json();
          const body = msg.text || msg.html || "";

          // Extract 6-digit OTP code
          const otpMatch = body.match(/\b(\d{6})\b/);
          if (otpMatch) return otpMatch[1];

          // Sometimes it's in subject
          const subjectMatch = (msg.subject || "").match(/\b(\d{6})\b/);
          if (subjectMatch) return subjectMatch[1];
        }
      }
    }

    await new Promise((r) => setTimeout(r, 3000));
  }

  throw new Error("Timed out waiting for OTP email");
}

export function generateAppInstallationId(): string {
  return uuidv4();
}
