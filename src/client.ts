import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { generateOtp, verifyOtp } from "./api/identity.js";
import { listChats } from "./api/chat.js";
import { getUploadUrl, uploadToAzure, getThumbnail } from "./api/media.js";
import { ElymentsXmppClient } from "./xmpp/client.js";
import { loadSession, saveSession } from "./session.js";
import { ElymentsAuthStore } from "./store.js";
import {
  inferMediaType,
  isAudioType,
  isImageType,
  isVideoType,
  normalizeMediaType,
  resolveMimeType
} from "./media.js";
import {
  ChatSummary,
  ElymentsMessage,
  ElymentsProfile,
  ElymentsSession,
  OtpRequest,
  OtpVerifyRequest,
  RecipientEntry,
  ResolvedRecipient,
  SendTextRequest,
  SendMediaRequest
} from "./types.js";

type ElymentsClientOptions = {
  sessionPath?: string;
  storeDir?: string;
  origin?: string;
  senderName?: string;
};

type ResolveRecipientOptions = {
  isGroup?: boolean;
};

type RecipientIndex = {
  byJid: Map<string, RecipientEntry>;
  byName: Map<string, RecipientEntry[]>;
  byPhone: Map<string, RecipientEntry[]>;
};

export class ElymentsClient extends EventEmitter {
  private session: ElymentsSession | null = null;
  private xmpp: ElymentsXmppClient | null = null;
  private readonly sessionPath?: string;
  private readonly store: ElymentsAuthStore;
  private readonly origin: string;
  private senderName?: string;
  private recipientEntries: RecipientEntry[] = [];
  private recipientIndex: RecipientIndex = createEmptyRecipientIndex();

  constructor(options: ElymentsClientOptions = {}) {
    super();
    this.sessionPath = options.sessionPath;
    this.store = new ElymentsAuthStore(options.storeDir);
    this.origin = options.origin ?? "W|node|elyments-sdk";
    this.senderName = options.senderName;
  }

  async loadSession(): Promise<ElymentsSession | null> {
    if (this.sessionPath) {
      this.session = await loadSession(this.sessionPath);
    } else {
      this.session = await this.store.loadSession();
    }

    if (!this.senderName) {
      const profile = await this.store.loadProfile();
      if (profile?.senderName) {
        this.senderName = profile.senderName;
      }
    }
    await this.loadRecipientCache();
    return this.session;
  }

  async requestOtp(request: OtpRequest): Promise<unknown> {
    return generateOtp(request);
  }

  async verifyOtp(request: OtpVerifyRequest): Promise<ElymentsSession> {
    const device = await this.store.ensureDevice();
    const response = await verifyOtp({
      ...request,
      deviceToken: request.deviceToken ?? device.deviceToken,
      platformType: request.platformType ?? device.platform
    });
    const session = extractSession(response);
    this.session = session;
    if (this.sessionPath) {
      await saveSession(session, this.sessionPath);
    } else {
      await this.store.saveSession(session);
    }
    await this.saveProfile({ senderName: this.senderName, userId: session.userId });
    return session;
  }

  async listChats(): Promise<ReturnType<typeof listChats>> {
    const chats = await this.fetchChats();
    await this.updateRecipientCache(chats);
    return chats;
  }

  async listGroups(): Promise<ReturnType<typeof listChats>> {
    const chats = await this.listChats();
    return chats.filter((chat) => chat.isGroup);
  }

  async resolveRecipient(input: string, options: ResolveRecipientOptions = {}): Promise<ResolvedRecipient> {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error("Recipient is required.");
    }

    if (trimmed.includes("@")) {
      return {
        jid: trimmed,
        isGroup: trimmed.endsWith("@muclight.localhost"),
        title: trimmed
      };
    }

    const normalizedName = normalizeName(trimmed);
    const normalizedPhone = normalizePhone(trimmed);
    const cached = this.findRecipientInCache({
      normalizedName,
      normalizedPhone,
      isGroup: options.isGroup,
      hasDigits: /\d/.test(trimmed)
    });
    if (cached) {
      return { jid: cached.jid, isGroup: cached.isGroup, title: cached.title };
    }

    const chats = await this.fetchChats();
    if (chats.length) {
      await this.updateRecipientCache(chats);
    }
    const refreshed = this.findRecipientInCache({
      normalizedName,
      normalizedPhone,
      isGroup: options.isGroup,
      hasDigits: /\d/.test(trimmed)
    });
    if (refreshed) {
      return { jid: refreshed.jid, isGroup: refreshed.isGroup, title: refreshed.title };
    }

    const groupHint = options.isGroup ? " group" : "";
    throw new Error(
      `Recipient not found.${groupHint ? " Try exact group name or JID." : " Use a JID or exact chat title, or map a phone alias."}`
    );
  }

  async connectXmpp(): Promise<void> {
    const session = this.requireSession();
    const device = await this.store.ensureDevice();
    if (!this.xmpp) {
      this.xmpp = new ElymentsXmppClient({
        session,
        origin: this.origin,
        resource: device.resource
      });
      this.xmpp.on("message", (message: ElymentsMessage) => this.emit("message", message));
      this.xmpp.on("online", () => this.emit("online"));
      this.xmpp.on("offline", () => this.emit("offline"));
      this.xmpp.on("error", (error) => this.emit("error", error));
    }
    await this.xmpp.connect();
  }

  async disconnectXmpp(): Promise<void> {
    if (!this.xmpp) return;
    await this.xmpp.disconnect();
  }

  async sendText(
    request: Omit<SendTextRequest, "senderName"> & { senderName?: string }
  ): Promise<string> {
    const session = this.requireSession();
    const senderName = request.senderName ?? this.senderName ?? session.userId;
    if (!senderName) {
      throw new Error("senderName is required to send messages.");
    }
    await this.connectXmpp();
    return this.xmpp!.sendText({ ...request, senderName });
  }

  async sendGroupText(jid: string, text: string): Promise<string> {
    return this.sendText({ jid, text, isGroup: true });
  }

  async sendMedia(
    request: Omit<SendMediaRequest, "senderName"> & { senderName?: string }
  ): Promise<string> {
    const session = this.requireSession();
    const senderName = request.senderName ?? this.senderName ?? session.userId;
    if (!senderName) {
      throw new Error("senderName is required to send media.");
    }
    await this.connectXmpp();
    return this.xmpp!.sendMedia({ ...request, senderName });
  }

  async uploadAndSendMedia(
    filePath: string,
    recipientInput: string,
    options: ResolveRecipientOptions & { caption?: string; senderName?: string; type?: string } = {}
  ): Promise<string> {
    const session = this.requireSession();
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const recipient = await this.resolveRecipient(recipientInput, options);
    const fileName = path.basename(filePath);
    const normalizedType = normalizeMediaType(options.type);
    const infoType = normalizedType ?? inferMediaType(filePath);
    const mimeType = resolveMimeType(filePath);
    const stat = fs.statSync(filePath);
    const lastModified = Math.trunc(stat.mtimeMs);
    const postedTime = Date.now();

    // 1. Get Upload URL
    const { objectId, url: uploadUrl } = await getUploadUrl(session.chatAccessToken);

    // 2. Upload to Azure
    await uploadToAzure(uploadUrl, filePath);

    // 3. Get Thumbnail
    let thumbnailUrl: string | undefined;
    try {
      if (isImageType(infoType) || isVideoType(infoType)) {
        const thumb = await getThumbnail(session.chatAccessToken, objectId, infoType);
        thumbnailUrl = thumb.url;
      }
    } catch (e) {
      // Ignore thumbnail error and proceed
    }

    let duration: string | number | undefined;
    if ((isAudioType(infoType) || isVideoType(infoType)) && process.env.ELYMENTS_DISABLE_DURATION !== "1") {
      duration = await resolveDurationSeconds(filePath);
    }

    // 4. Send Message
    return this.sendMedia({
      jid: recipient.jid,
      isGroup: recipient.isGroup,
      senderName: options.senderName,
      caption: options.caption,
      media: {
        type: infoType,
        url: uploadUrl.split("?")[0],
        id: objectId,
        name: fileName,
        size: stat.size,
        mimeType,
        thumbnailUrl,
        duration,
        lastModified,
        postedTime
      }
    });
  }

  async fetchHistory(jid: string, max = 100): Promise<void> {
    await this.connectXmpp();
    await this.xmpp!.fetchHistory(jid, max);
  }

  async fetchHistoryMessages(jid: string, max = 100, timeoutMs = 8000): Promise<ElymentsMessage[]> {
    await this.connectXmpp();
    const results: ElymentsMessage[] = [];
    const onMessage = (msg: ElymentsMessage) => {
      if (msg.from.includes(jid) || msg.to.includes(jid)) {
        results.push(msg);
      }
    };

    this.on("message", onMessage);
    await this.xmpp!.fetchHistory(jid, max);
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
    this.off("message", onMessage);

    return results;
  }

  setSenderName(senderName: string): void {
    this.senderName = senderName;
    void this.saveProfile({ senderName });
  }

  private requireSession(): ElymentsSession {
    if (!this.session) {
      throw new Error("Session not loaded. Call loadSession() or verifyOtp().");
    }
    return this.session;
  }

  private async saveProfile(partial: ElymentsProfile): Promise<void> {
    const existing = await this.store.loadProfile();
    const profile: ElymentsProfile = {
      ...existing,
      ...partial,
      updatedAt: new Date().toISOString()
    };
    await this.store.saveProfile(profile);
  }

  protected async fetchChats(): Promise<ChatSummary[]> {
    const session = this.requireSession();
    return listChats(session.accessToken);
  }

  private async loadRecipientCache(): Promise<void> {
    const cached = await this.store.loadRecipients();
    if (!cached || cached.length === 0) return;
    this.recipientEntries = cached;
    this.recipientIndex = buildRecipientIndex(cached);
  }

  private async updateRecipientCache(chats: ChatSummary[]): Promise<void> {
    const updatedAt = new Date().toISOString();
    const entries: RecipientEntry[] = chats.map((chat) => ({
      jid: chat.jid,
      title: chat.title,
      isGroup: chat.isGroup,
      numbers: dedupeNumbers([
        ...extractNumbers(chat.raw),
        ...extractNumbersFromText(chat.title)
      ]),
      updatedAt
    }));
    this.recipientEntries = entries;
    this.recipientIndex = buildRecipientIndex(entries);
    await this.store.saveRecipients(entries);
  }

  private async persistRecipientCache(): Promise<void> {
    this.recipientIndex = buildRecipientIndex(this.recipientEntries);
    await this.store.saveRecipients(this.recipientEntries);
  }

  private findRecipientInCache(input: {
    normalizedName: string;
    normalizedPhone: string;
    isGroup?: boolean;
    hasDigits: boolean;
  }): RecipientEntry | null {
    const { normalizedName, normalizedPhone, isGroup, hasDigits } = input;
    const pick = (entries: RecipientEntry[]): RecipientEntry | null => {
      if (!entries.length) return null;
      if (typeof isGroup === "boolean") {
        const filtered = entries.filter((entry) => entry.isGroup === isGroup);
        return filtered[0] ?? null;
      }
      return entries[0] ?? null;
    };

    if (hasDigits && normalizedPhone) {
      const phoneMatches = this.recipientIndex.byPhone.get(normalizedPhone);
      const pickPhone = phoneMatches ? pick(phoneMatches) : null;
      if (pickPhone) return pickPhone;

      const fuzzy = this.recipientEntries.filter((entry) =>
        entry.numbers.some(
          (number) => number.endsWith(normalizedPhone) || normalizedPhone.endsWith(number)
        )
      );
      const pickFuzzy = pick(fuzzy);
      if (pickFuzzy) return pickFuzzy;
    }

    if (normalizedName) {
      const directByName = this.recipientIndex.byName.get(normalizedName);
      const pickName = directByName ? pick(directByName) : null;
      if (pickName) return pickName;

      const partial = this.recipientEntries.filter((entry) =>
        entry.title.toLowerCase().includes(normalizedName)
      );
      const pickPartial = pick(partial);
      if (pickPartial) return pickPartial;
    }

    return null;
  }

  async addRecipientAlias(
    input: string,
    phone: string,
    options: ResolveRecipientOptions = {}
  ): Promise<RecipientEntry> {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      throw new Error("Phone number is required for alias.");
    }

    const recipient = await this.resolveRecipient(input, options);
    if (this.recipientEntries.length === 0) {
      await this.listChats();
    }

    let entry = this.recipientIndex.byJid.get(recipient.jid);
    if (!entry) {
      await this.listChats();
      entry = this.recipientIndex.byJid.get(recipient.jid);
    }
    if (!entry) {
      throw new Error("Recipient not found in cache. Run listChats first.");
    }

    if (!entry.numbers.includes(normalizedPhone)) {
      entry.numbers.push(normalizedPhone);
      entry.updatedAt = new Date().toISOString();
      await this.persistRecipientCache();
    }

    return entry;
  }
}

function normalizePhone(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? digits.slice(1) : digits;
}

function normalizeName(input: string): string {
  return input.trim().toLowerCase();
}

function extractNumbersFromText(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/\+?\d{6,}/g) ?? [];
  return matches.map((value) => normalizePhone(value)).filter(Boolean);
}

function dedupeNumbers(values: string[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    if (value) unique.add(value);
  }
  return Array.from(unique);
}

function createEmptyRecipientIndex(): RecipientIndex {
  return {
    byJid: new Map(),
    byName: new Map(),
    byPhone: new Map()
  };
}

function buildRecipientIndex(entries: RecipientEntry[]): RecipientIndex {
  const index = createEmptyRecipientIndex();
  for (const entry of entries) {
    index.byJid.set(entry.jid, entry);
    const nameKey = normalizeName(entry.title);
    if (nameKey) {
      const bucket = index.byName.get(nameKey);
      if (bucket) {
        bucket.push(entry);
      } else {
        index.byName.set(nameKey, [entry]);
      }
    }
    for (const number of entry.numbers) {
      if (!number) continue;
      const bucket = index.byPhone.get(number);
      if (bucket) {
        bucket.push(entry);
      } else {
        index.byPhone.set(number, [entry]);
      }
    }
  }
  return index;
}

function extractNumbers(raw: any): string[] {
  const values: string[] = [];
  const add = (value?: string) => {
    if (!value) return;
    const normalized = normalizePhone(value);
    if (normalized) values.push(normalized);
  };

  add(raw?.phone);
  add(raw?.phoneNumber);
  add(raw?.phone_number);
  add(raw?.mobile);
  add(raw?.mobileNumber);
  add(raw?.mobile_number);
  add(raw?.contact_number);
  add(raw?.contact_mobile);
  add(raw?.contact?.phone);
  add(raw?.contact?.mobile);
  add(raw?.contact?.mobileNumber);
  add(raw?.contact?.phoneNumber);

  return values;
}

function extractSession(response: any): ElymentsSession {
  const data = response?.result ?? response?.data ?? response;
  const userId = data?.userId ?? data?.user_id ?? data?.user?.id;
  const accessToken = data?.accessToken ?? data?.access_token ?? data?.token;
  const chatAccessToken = data?.chatAccessToken ?? data?.chat_access_token ?? data?.chatToken;
  const refreshToken = data?.refreshToken ?? data?.refresh_token;

  if (!userId || !accessToken || !chatAccessToken) {
    throw new Error("VerifyOtp response missing required fields.");
  }

  return {
    userId,
    accessToken,
    chatAccessToken,
    refreshToken
  };
}

const execFileAsync = promisify(execFile);

async function resolveDurationSeconds(filePath: string): Promise<string | undefined> {
  const probe = process.env.ELYMENTS_FFPROBE ?? "ffprobe";
  if (!probe) return undefined;
  try {
    const { stdout } = await execFileAsync(probe, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath
    ]);
    const value = Number(String(stdout).trim());
    if (!Number.isFinite(value) || value <= 0) return undefined;
    return value.toFixed(2);
  } catch {
    return undefined;
  }
}
