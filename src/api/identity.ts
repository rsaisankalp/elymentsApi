import { OtpRequest, OtpVerifyRequest } from "../types.js";

const IDENTITY_BASE = "https://identityapi.elyments.com/api/Identity";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
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
  });
}

export async function verifyOtp(request: OtpVerifyRequest): Promise<unknown> {
  return postJson(`${IDENTITY_BASE}/VerifyOtp/V2`, {
    CountryCode: request.countryCode,
    MobileNumber: request.phoneNumber,
    Otp: request.otp,
    DeviceToken: request.deviceToken ?? "dummy",
    PlatformType: request.platformType ?? "WEB"
  });
}
