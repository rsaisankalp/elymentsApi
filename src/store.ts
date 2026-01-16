import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  ElymentsDevice,
  ElymentsProfile,
  ElymentsSession,
  LocalContact,
  RecipientEntry
} from "./types.js";

const DEFAULT_STORE_DIR = "~/.elyments";

export class ElymentsAuthStore {
  readonly rootDir: string;
  readonly authDir: string;
  readonly sessionPath: string;
  readonly devicePath: string;
  readonly profilePath: string;
  readonly recipientPath: string;
  readonly contactsPath: string;

  constructor(rootDir?: string) {
    this.rootDir = resolveStoreDir(rootDir);
    this.authDir = path.join(this.rootDir, "auth");
    this.sessionPath = path.join(this.authDir, "session.json");
    this.devicePath = path.join(this.authDir, "device.json");
    this.profilePath = path.join(this.authDir, "profile.json");
    this.recipientPath = path.join(this.authDir, "recipients.json");
    this.contactsPath = resolveContactsPath() ?? path.join(this.authDir, "contacts.json");
  }

  async ensureDirs(): Promise<void> {
    await fs.mkdir(this.authDir, { recursive: true });
  }

  async loadSession(): Promise<ElymentsSession | null> {
    return readJson<ElymentsSession>(this.sessionPath);
  }

  async saveSession(session: ElymentsSession): Promise<void> {
    await this.ensureDirs();
    const payload: ElymentsSession = {
      ...session,
      savedAt: new Date().toISOString()
    };
    await writeJson(this.sessionPath, payload);
  }

  async loadDevice(): Promise<ElymentsDevice | null> {
    return readJson<ElymentsDevice>(this.devicePath);
  }

  async saveDevice(device: ElymentsDevice): Promise<void> {
    await this.ensureDirs();
    await writeJson(this.devicePath, device);
  }

  async ensureDevice(): Promise<ElymentsDevice> {
    const existing = await this.loadDevice();
    const envDeviceId = process.env.ELYMENTS_DEVICE_ID?.trim();
    const envDeviceToken = process.env.ELYMENTS_DEVICE_TOKEN?.trim();
    const envPlatform = process.env.ELYMENTS_DEVICE_PLATFORM?.trim().toUpperCase();
    const envResource = process.env.ELYMENTS_RESOURCE?.trim();

    if (existing) {
      // Check if existing device has valid (non-empty) values
      const hasValidDevice = existing.deviceId && existing.deviceToken;
      if (hasValidDevice && !envDeviceId && !envDeviceToken && !envPlatform && !envResource) {
        return existing;
      }
      // Regenerate empty values or use env overrides
      const deviceId = envDeviceId || existing.deviceId || crypto.randomUUID();
      const deviceToken = envDeviceToken || existing.deviceToken || crypto.randomUUID();
      const platform = (envPlatform as ElymentsDevice["platform"]) ?? existing.platform ?? "WEB";
      const resource = envResource || existing.resource || `web-${deviceId.slice(0, 8)}`;
      const updated: ElymentsDevice = {
        ...existing,
        deviceId,
        deviceToken,
        platform,
        resource
      };
      await this.saveDevice(updated);
      return updated;
    }

    const deviceId = envDeviceId || crypto.randomUUID();
    const deviceToken = envDeviceToken || crypto.randomUUID();
    const resource = envResource || `web-${deviceId.slice(0, 8)}`;
    const platform = (envPlatform as ElymentsDevice["platform"]) ?? "WEB";
    const device: ElymentsDevice = {
      deviceId,
      deviceToken,
      platform,
      resource,
      createdAt: new Date().toISOString()
    };
    await this.saveDevice(device);
    return device;
  }

  async loadProfile(): Promise<ElymentsProfile | null> {
    return readJson<ElymentsProfile>(this.profilePath);
  }

  async saveProfile(profile: ElymentsProfile): Promise<void> {
    await this.ensureDirs();
    await writeJson(this.profilePath, profile);
  }

  async loadRecipients(): Promise<RecipientEntry[] | null> {
    return readJson<RecipientEntry[]>(this.recipientPath);
  }

  async saveRecipients(entries: RecipientEntry[]): Promise<void> {
    await this.ensureDirs();
    await writeJson(this.recipientPath, entries);
  }

  async loadContacts(): Promise<LocalContact[] | null> {
    return readJson<LocalContact[]>(this.contactsPath);
  }

  async saveContacts(entries: LocalContact[]): Promise<void> {
    await this.ensureDirs();
    await writeJson(this.contactsPath, entries);
  }
}

export function resolveStoreDir(storeDir?: string): string {
  const raw = storeDir?.trim() || process.env.ELYMENTS_STORE_DIR || DEFAULT_STORE_DIR;
  if (raw.startsWith("~/")) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
}

export function resolveContactsPath(input?: string): string | undefined {
  const raw = input?.trim() || process.env.ELYMENTS_CONTACTS_PATH;
  if (!raw) return undefined;
  if (raw.startsWith("~/")) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  const data = JSON.stringify(payload, null, 2);
  await fs.writeFile(filePath, data, "utf8");
}
