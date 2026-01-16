import { OtpRequest, OtpVerifyRequest } from "../types.js";

const IDENTITY_ROOT = "https://identityapi.elyments.com/api";
const IDENTITY_BASE = `${IDENTITY_ROOT}/Identity`;

function buildClientHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "accept": "application/json, text/plain, */*",
    "elyments-client-info":
      "{\"applicationVersion\":\"143.0.0\", \"deviceOSVersion\":\"Mac OS\",\"deviceModel\":\"chrome\",\"deviceOEMName\":\"browser\",\"deviceType\":\"Web\"}",
    "referer": "https://web.elyments.com/",
    "origin": "https://web.elyments.com",
    ...extra
  };
}

async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

export async function generateOtp(request: OtpRequest): Promise<unknown> {
  return postJson(`${IDENTITY_BASE}/GenerateOtp/V2`, {
    CountryCode: request.countryCode,
    MobileNumber: request.phoneNumber
  }, buildClientHeaders());
}

export async function verifyOtp(request: OtpVerifyRequest): Promise<unknown> {
  const payload: Record<string, string> = {
    CountryCode: request.countryCode,
    MobileNumber: request.phoneNumber,
    Otp: request.otp,
    DeviceToken: request.deviceToken ?? "dummy"
  };
  if (request.platformType) {
    payload.PlatformType = request.platformType;
  }
  return postJson(`${IDENTITY_BASE}/VerifyOtp/V2`, payload, buildClientHeaders());
}

export async function refreshSession(request: {
  userId: string;
  refreshToken: string;
  deviceToken: string;
  platformType?: string;
  accessToken?: string;
}): Promise<unknown> {
  const payload: Record<string, string> = {
    DeviceToken: request.deviceToken
  };
  if (request.platformType) {
    payload.PlatformType = request.platformType;
  }
  const res = await fetch(`${IDENTITY_BASE}/RefreshToken/V4`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...buildClientHeaders({ "authorization": `bearer ${request.refreshToken}` })
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<unknown>;
}

export async function logoutAllWebSessions(accessToken: string): Promise<unknown> {
  const res = await fetch(`${IDENTITY_ROOT}/identity/logoutAllWeb`, {
    method: "POST",
    headers: buildClientHeaders({ "authorization": `bearer ${accessToken}` })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
