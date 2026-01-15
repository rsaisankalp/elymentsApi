import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { generateOtp, verifyOtp, refreshSession, logoutAllWebSessions } from "./api/identity.js";
import { listChats } from "./api/chat.js";
import { syncContacts } from "./api/profile.js";
import { getUploadUrl, getDownloadUrls, uploadToAzure, getThumbnail } from "./api/media.js";
import { ElymentsXmppClient } from "./xmpp/client.js";
import { loadSession, saveSession } from "./session.js";
import { ElymentsAuthStore } from "./store.js";
import {
  inferMediaType,
  isAudioType,
  isImageType,
  isVideoType,
  normalizeMediaType,
  resolveMimeType,
  type MediaInfoType
} from "./media.js";
import {
  ChatSummary,
  ElymentsMessage,
  ElymentsProfile,
  ElymentsSession,
  LocalContact,
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
  private refreshPromise: Promise<ElymentsSession> | null = null;
  private refreshFailure: { at: number; message: string } | null = null;

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
    await this.syncContactsOnStart();
    return this.session;
  }

  async requestOtp(request: OtpRequest): Promise<unknown> {
    return generateOtp(normalizeOtpRequest(request));
  }

  async verifyOtp(request: OtpVerifyRequest): Promise<ElymentsSession> {
    const normalized = normalizeOtpRequest(request);
    const device = await this.store.ensureDevice();
    const response = await verifyOtp({
      ...normalized,
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
    await this.ensureValidSession();
    const chats = await this.fetchChats();
    await this.updateRecipientCache(chats);
    return chats;
  }

  async listGroups(): Promise<ReturnType<typeof listChats>> {
    const chats = await this.listChats();
    return chats.filter((chat) => chat.isGroup);
  }

  async logoutAllWebSessions(): Promise<void> {
    await this.withAutoRefresh(async () => {
      await logoutAllWebSessions(this.requireSession().accessToken);
    });
  }

  async refreshSession(): Promise<ElymentsSession> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    if (this.refreshFailure && Date.now() - this.refreshFailure.at < 30_000) {
      throw new Error(this.refreshFailure.message);
    }

    const session = this.requireSession();
    if (!session.refreshToken) {
      throw new Error("No refresh token available.");
    }
    const device = await this.store.ensureDevice();
    this.refreshPromise = (async () => {
      try {
        const response = await refreshSession({
          userId: session.userId,
          refreshToken: session.refreshToken,
          deviceToken: device.deviceToken,
          platformType: device.platform,
          accessToken: session.accessToken
        });
        const newSession = extractRefreshedSession(response, session);
        this.session = newSession;
        if (this.sessionPath) {
          await saveSession(newSession, this.sessionPath);
        } else {
          await this.store.saveSession(newSession);
        }
        this.refreshFailure = null;
        await this.resetXmpp();
        return newSession;
      } catch (error) {
        const wrapped = wrapRefreshError(error);
        this.refreshFailure = { at: Date.now(), message: wrapped.message };
        throw wrapped;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  async ensureValidSession(): Promise<void> {
    const session = this.requireSession();
    if (isTokenExpiring(session.accessToken) || isTokenExpiring(session.chatAccessToken)) {
      console.log("Session expired or expiring soon, refreshing...");
      await this.refreshSession();
    }
  }

  private async withAutoRefresh<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (!isAuthError(error)) {
        throw error;
      }
      try {
        await this.refreshSession();
      } catch (refreshError) {
        throw wrapRefreshError(refreshError);
      }
      return fn();
    }
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

    if (normalizedPhone) {
      const synced = await this.syncRecipientPhonesFromContacts(normalizedPhone);
      if (synced) {
        const matched = this.findRecipientInCache({
          normalizedName,
          normalizedPhone,
          isGroup: options.isGroup,
          hasDigits: true
        });
        if (matched) {
          return { jid: matched.jid, isGroup: matched.isGroup, title: matched.title };
        }
      }
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
      `Recipient not found.${groupHint ? " Try exact group name or JID." : " Use a JID or exact chat title, map a phone alias, or import contacts."}`
    );
  }

  async connectXmpp(): Promise<void> {
    await this.withAutoRefresh(async () => {
      await this.ensureValidSession();
      await this.connectXmppInternal();
    });
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
    return this.withAutoRefresh(async () => {
      await this.connectXmpp();
      return this.xmpp!.sendText({ ...request, senderName });
    });
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
    return this.withAutoRefresh(async () => {
      await this.connectXmpp();
      return this.xmpp!.sendMedia({ ...request, senderName });
    });
  }

  async uploadAndSendMedia(
    filePath: string,
    recipientInput: string,
    options: ResolveRecipientOptions & { caption?: string; senderName?: string; type?: string } = {}
  ): Promise<string> {
    await this.ensureValidSession();
    const session = this.requireSession();
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const recipient = await this.resolveRecipient(recipientInput, options);
    const normalizedType = normalizeMediaType(options.type);
    const inferredType = inferMediaType(filePath);
    const infoType =
      normalizedType &&
      (normalizedType === "document" || normalizedType === "file") &&
      inferredType !== "file"
        ? inferredType
        : normalizedType ?? inferredType;
    const originalStat = fs.statSync(filePath);
    const lastModified = Math.trunc(originalStat.mtimeMs);
    const postedTime = Date.now();

    let mimeType = resolveMimeType(filePath);
    const prepared = await maybeTranscodeAudio(filePath, infoType, mimeType);
    const uploadPath = prepared.filePath;
    mimeType = resolveMimeType(uploadPath);
    const fileName = prepared.nameOverride ?? path.basename(uploadPath);
    const stat = fs.statSync(uploadPath);

    try {
      // 1. Get Upload URL
      const { objectId, url: uploadUrl } = await this.withAutoRefresh(() =>
        getUploadUrl(this.requireSession().accessToken)
      );

      // 2. Upload to Azure
      await uploadToAzure(uploadUrl, uploadPath);

      // 3. Resolve download URL (read SAS)
      let downloadUrl = uploadUrl.split("?")[0];
      try {
        const urls = await this.withAutoRefresh(() =>
          getDownloadUrls(this.requireSession().accessToken, [objectId])
        );
        const match = urls.find((item) => item.objectId === objectId);
        if (match?.url) {
          downloadUrl = match.url;
        }
      } catch (e) {
        // Ignore download URL error and proceed with base blob URL
      }

      // 4. Get Thumbnail
      let thumbnailUrl: string | undefined;
      try {
        if (isImageType(infoType) || isVideoType(infoType) || infoType === "pdf") {
          const thumb = await this.withAutoRefresh(() =>
            getThumbnail(this.requireSession().accessToken, objectId, infoType)
          );
          thumbnailUrl = thumb.url;
        } else if (isAudioType(infoType)) {
          await this.withAutoRefresh(() =>
            getThumbnail(this.requireSession().accessToken, objectId, "audio")
          );
        }
      } catch (e) {
        // Ignore thumbnail error and proceed
      }

      let duration: string | undefined;
      if ((isAudioType(infoType) || isVideoType(infoType)) && process.env.ELYMENTS_DISABLE_DURATION !== "1") {
        const seconds = await resolveDurationSeconds(uploadPath);
        if (typeof seconds === "number") {
          duration = formatDuration(seconds);
        }
      }

      // 5. Send Message
      return this.sendMedia({
        jid: recipient.jid,
        isGroup: recipient.isGroup,
        senderName: options.senderName,
        caption: options.caption,
        media: {
          type: infoType,
          url: downloadUrl,
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
    } finally {
      if (prepared.cleanup) {
        await prepared.cleanup();
      }
    }
  }

  async fetchHistory(jid: string, max = 100): Promise<void> {
    await this.withAutoRefresh(async () => {
      await this.connectXmpp();
      await this.xmpp!.fetchHistory(jid, max);
    });
  }

  async fetchHistoryMessages(jid: string, max = 100, timeoutMs = 8000): Promise<ElymentsMessage[]> {
    return this.withAutoRefresh(async () => {
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
    });
  }

  setSenderName(senderName: string): void {
    this.senderName = senderName;
    void this.saveProfile({ senderName });
  }

  async importContacts(contacts: LocalContact[]): Promise<void> {
    await this.store.saveContacts(contacts);
    await this.syncRecipientPhonesFromContacts();
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

  private async resetXmpp(): Promise<void> {
    if (!this.xmpp) return;
    await this.xmpp.disconnect().catch(() => {});
    this.xmpp = null;
  }

  private async connectXmppInternal(): Promise<void> {
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

  protected async fetchChats(): Promise<ChatSummary[]> {
    return this.withAutoRefresh(() => listChats(this.requireSession().accessToken));
  }

  protected async loadLocalContacts(): Promise<LocalContact[] | null> {
    return this.store.loadContacts();
  }

  protected async fetchProfileContacts(): Promise<any[]> {
    return this.withAutoRefresh(() => syncContacts(this.requireSession().accessToken));
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

  private async syncRecipientPhonesFromContacts(normalizedPhone?: string): Promise<boolean> {
    const contacts = await this.loadLocalContacts();
    if (!contacts || contacts.length === 0) return false;

    const normalizedTarget = normalizedPhone ? normalizePhone(normalizedPhone) : "";
    const byName = new Map<string, string[]>();
    for (const contact of contacts) {
      const name = normalizeName(contact.name ?? (contact as any).displayName ?? "");
      if (!name) continue;
      const numbers = dedupeNumbers(extractNumbersFromContact(contact));
      if (!numbers.length) continue;
      if (normalizedTarget && !numbers.some((number) => number === normalizedTarget)) {
        continue;
      }
      const existing = byName.get(name) ?? [];
      byName.set(name, dedupeNumbers([...existing, ...numbers]));
    }
    if (byName.size === 0) return false;

    const synced = await this.fetchProfileContacts();
    if (!Array.isArray(synced) || synced.length === 0) return false;

    let updated = false;
    const now = new Date().toISOString();
    for (const entry of synced) {
      if (!entry || entry.isDeleted) continue;
      const name = normalizeName(entry.name ?? "");
      if (!name) continue;
      const numbers = byName.get(name);
      if (!numbers || numbers.length === 0) continue;
      if (normalizedTarget && !numbers.some((number) => number === normalizedTarget)) {
        continue;
      }
      const contactId = String(entry.contactId ?? entry.contact_id ?? entry.id ?? "").trim();
      if (!contactId) continue;
      const jid = contactId.includes("@") ? contactId : `${contactId}${DIRECT_JID_DOMAIN}`;
      let recipient = this.recipientIndex.byJid.get(jid);
      if (!recipient) {
        recipient = {
          jid,
          title: entry.name ?? jid,
          isGroup: false,
          numbers: [],
          updatedAt: now
        };
        this.recipientEntries.push(recipient);
      }
      const merged = dedupeNumbers([...recipient.numbers, ...numbers]);
      if (merged.length !== recipient.numbers.length) {
        recipient.numbers = merged;
        recipient.updatedAt = now;
        updated = true;
      }
    }

    if (updated) {
      await this.persistRecipientCache();
    }
    return updated;
  }

  private async syncContactsOnStart(): Promise<void> {
    if (process.env.ELYMENTS_AUTO_SYNC_CONTACTS === "0") return;
    const contacts = await this.loadLocalContacts();
    if (!contacts || contacts.length === 0) return;
    try {
      await this.syncRecipientPhonesFromContacts();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Auto contact sync failed: ${message}`);
    }
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

function normalizeOtpRequest<T extends { countryCode: string; phoneNumber: string }>(request: T): T {
  const countryCode = request.countryCode?.trim() || "";
  const normalizedCountry = countryCode
    ? countryCode.startsWith("+")
      ? countryCode
      : `+${countryCode}`
    : "";

  let phoneNumber = request.phoneNumber?.trim() || "";
  if (phoneNumber.startsWith("+")) {
    const digits = phoneNumber.slice(1);
    const countryDigits = normalizedCountry.replace("+", "");
    phoneNumber = countryDigits && digits.startsWith(countryDigits)
      ? digits.slice(countryDigits.length)
      : digits;
  } else {
    phoneNumber = phoneNumber.replace(/\D/g, "");
  }

  return {
    ...request,
    countryCode: normalizedCountry,
    phoneNumber
  };
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

const DIRECT_JID_DOMAIN = "@localhost";

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

function extractNumbersFromContact(contact: LocalContact): string[] {
  const values: string[] = [];
  const add = (value?: string) => {
    if (!value) return;
    const normalized = normalizePhone(value);
    if (normalized) values.push(normalized);
  };

  add(contact.phone);
  add(contact.phoneNumber);
  add((contact as any).mobile);
  add((contact as any).mobileNumber);
  const numbers = Array.isArray(contact.numbers) ? contact.numbers : [];
  for (const number of numbers) {
    add(number);
  }

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

function extractRefreshedSession(response: any, existing: ElymentsSession): ElymentsSession {
  const data = response?.result ?? response?.data ?? response;
  const userId = data?.userId ?? data?.user_id ?? existing.userId;
  const accessToken = data?.accessToken ?? data?.access_token ?? data?.token;
  const chatAccessToken = data?.chatAccessToken ?? data?.chat_access_token ?? data?.chatToken;
  const refreshToken = data?.refreshToken ?? data?.refresh_token ?? existing.refreshToken;

  if (!userId || !accessToken || !chatAccessToken) {
    throw new Error("Refresh response missing required fields.");
  }

  return {
    userId,
    accessToken,
    chatAccessToken,
    refreshToken
  };
}

const execFileAsync = promisify(execFile);

type PreparedAudioUpload = {
  filePath: string;
  nameOverride?: string;
  cleanup?: () => Promise<void>;
};

async function maybeTranscodeAudio(
  filePath: string,
  infoType: MediaInfoType,
  mimeType: string
): Promise<PreparedAudioUpload> {
  if (!isAudioType(infoType)) return { filePath };
  if (process.env.ELYMENTS_DISABLE_AUDIO_TRANSCODE === "1") return { filePath };
  if (mimeType === "audio/mpeg") return { filePath };

  const ffmpeg = process.env.ELYMENTS_FFMPEG ?? "ffmpeg";
  if (!ffmpeg) return { filePath };
  const target = path.join(os.tmpdir(), `elyments-audio-${crypto.randomUUID()}.mp3`);
  const base = path.basename(filePath, path.extname(filePath));
  try {
    await execFileAsync(ffmpeg, [
      "-y",
      "-i",
      filePath,
      "-vn",
      "-codec:a",
      "libmp3lame",
      "-q:a",
      "2",
      target
    ]);
  } catch {
    return { filePath };
  }
  return {
    filePath: target,
    nameOverride: `${base}.mp3`,
    cleanup: async () => {
      await fs.promises.unlink(target).catch(() => {});
    }
  };
}

async function resolveDurationSeconds(filePath: string): Promise<number | undefined> {
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
    return value;
  } catch {
    return undefined;
  }
}

function formatDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function isTokenExpiring(token?: string, leewaySeconds = 60): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
    const exp = payload.exp;
    if (!exp) return false;
    return Date.now() / 1000 > exp - leewaySeconds;
  } catch {
    return false;
  }
}

function wrapRefreshError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/Multiple login attempts/i.test(message) || /auto logout/i.test(message)) {
    return new Error("Session invalidated by another login. Re-login required.");
  }
  return error instanceof Error ? error : new Error(message);
}

function isAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /\b401\b/.test(message) ||
    /\b403\b/.test(message) ||
    /Unauthorized/i.test(message) ||
    /not-authorized/i.test(message) ||
    /token\s*(expired|invalid)/i.test(message)
  );
}
