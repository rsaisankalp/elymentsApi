import "dotenv/config";
import { ElymentsClient } from "../src/client.js";

const COUNTRY_CODE = process.env.ELYMENTS_COUNTRY_CODE ?? "+91";
const PHONE_NUMBER = process.env.ELYMENTS_PHONE ?? "";
const OTP = process.env.ELYMENTS_OTP ?? "";

export function createClient(): ElymentsClient {
  return new ElymentsClient({
    sessionPath: process.env.ELYMENTS_SESSION_PATH,
    storeDir: process.env.ELYMENTS_STORE_DIR,
    origin: process.env.ELYMENTS_ORIGIN,
    senderName: process.env.ELYMENTS_SENDER_NAME
  });
}

export async function ensureSession(client: ElymentsClient): Promise<void> {
  const session = await client.loadSession();
  if (session) return;
  if (!PHONE_NUMBER) {
    throw new Error("Set ELYMENTS_PHONE in .env to request OTP.");
  }
  if (!OTP) {
    await client.requestOtp({ countryCode: COUNTRY_CODE, phoneNumber: PHONE_NUMBER });
    throw new Error("OTP requested. Set ELYMENTS_OTP in .env and rerun.");
  }
  await client.verifyOtp({ countryCode: COUNTRY_CODE, phoneNumber: PHONE_NUMBER, otp: OTP });
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}
