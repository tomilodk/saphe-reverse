const BASE = '';

async function json<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, opts);
  return res.json();
}

function post<T>(url: string, body?: unknown): Promise<T> {
  return json(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export interface AuthStatus {
  authenticated: boolean;
  username: string | null;
  appInstallationId: string | null;
  tokenAgeMin: number | null;
  tokenExpiresIn: number | null;
}

export interface PoiData {
  id: string;
  type: string;
  typeCode: number;
  state?: string;
  latitude?: number;
  longitude?: number;
  speedLimitKmh?: number;
  roadName?: string;
  city?: string;
  countryCode?: string;
  isTest: boolean;
  version?: number;
  hash?: number;
}

export interface PoisResponse {
  dynamic: PoiData[];
  static: PoiData[];
}

export const api = {
  getAuthStatus: () => json<AuthStatus>('/api/auth/status'),
  requestOtp: (username: string) => post<{ ok: boolean; userNotFound?: boolean; error?: string }>('/api/auth/request-otp', { username }),
  register: (email: string) => post<{ ok: boolean; error?: string }>('/api/auth/register', { email }),
  login: (username: string, password: string) => post<{ ok: boolean; expiresIn?: number; error?: string }>('/api/auth/login', { username, password }),
  refresh: () => post<{ ok: boolean; expiresIn?: number; error?: string }>('/api/auth/refresh'),
  logout: () => post<{ ok: boolean }>('/api/auth/logout'),
  startTrip: (latitude: number, longitude: number, speedKmh: number, heading: number, updateIntervalMs: number) =>
    post<{ ok: boolean; tripUuid?: string; error?: string }>('/api/trip/start', { latitude, longitude, speedKmh, heading, updateIntervalMs }),
  moveTrip: (latitude: number, longitude: number) => post<{ ok: boolean }>('/api/trip/move', { latitude, longitude }),
  stopTrip: () => post<{ ok: boolean }>('/api/trip/stop'),
  getPois: () => json<PoisResponse>('/api/pois'),
  getPoiTypes: () => json<Record<string, string>>('/api/poi-types'),
};
