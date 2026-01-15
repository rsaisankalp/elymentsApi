import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { ElymentsClient } from "./client.js";
import { inferMediaType } from "./media.js";

export type ElymentsOutboundOptions = {
  verbose?: boolean;
  mediaUrl?: string;
  type?: string;
  senderName?: string;
  isGroup?: boolean;
};

let sharedClient: ElymentsClient | null = null;
let sharedClientReady: Promise<ElymentsClient> | null = null;

async function getSharedClient(): Promise<ElymentsClient> {
  if (sharedClient) return sharedClient;
  if (!sharedClientReady) {
    const sessionPath = process.env.ELYMENTS_SESSION_PATH;
    const storeDir = process.env.ELYMENTS_STORE_DIR;
    const senderName = process.env.ELYMENTS_SENDER_NAME;
    const origin = process.env.ELYMENTS_ORIGIN;
    const client = new ElymentsClient({ sessionPath, storeDir, senderName, origin });
    sharedClientReady = client.loadSession().then(() => {
      sharedClient = client;
      return client;
    });
  }
  return sharedClientReady;
}

function extensionFromContentType(contentType?: string): string {
  const normalized = String(contentType ?? "").toLowerCase();
  if (normalized.includes("image/jpeg")) return ".jpg";
  if (normalized.includes("image/png")) return ".png";
  if (normalized.includes("image/gif")) return ".gif";
  if (normalized.includes("video/mp4")) return ".mp4";
  if (normalized.includes("audio/ogg")) return ".ogg";
  if (normalized.includes("audio/mpeg")) return ".mp3";
  if (normalized.includes("application/pdf")) return ".pdf";
  return ".bin";
}

async function downloadToTemp(url: string): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const extension = extensionFromContentType(res.headers.get("content-type") ?? undefined);
  const filePath = path.join(os.tmpdir(), `elyments-media-${crypto.randomUUID()}${extension}`);
  await fs.writeFile(filePath, buffer);
  return {
    filePath,
    cleanup: async () => {
      await fs.unlink(filePath).catch(() => {});
    }
  };
}

export async function sendMessageElyments(
  to: string,
  body: string,
  options: ElymentsOutboundOptions = {}
): Promise<{ messageId: string; toJid: string }> {
  const client = await getSharedClient();
  if (options.senderName) {
    client.setSenderName(options.senderName);
  }
  const recipient = await client.resolveRecipient(to, { isGroup: options.isGroup });
  if (!options.mediaUrl) {
    const messageId = await client.sendText({
      jid: recipient.jid,
      text: body,
      isGroup: recipient.isGroup
    });
    return { messageId, toJid: recipient.jid };
  }

  const prepared = await downloadToTemp(options.mediaUrl);
  try {
    const inferred = inferMediaType(prepared.filePath);
    const messageId = await client.uploadAndSendMedia(prepared.filePath, to, {
      isGroup: recipient.isGroup,
      caption: body,
      type: options.type ?? inferred
    });
    return { messageId, toJid: recipient.jid };
  } finally {
    await prepared.cleanup();
  }
}

export async function sendReactionElyments(): Promise<void> {
  throw new Error("Reactions are not supported by Elyments.");
}

export async function sendPollElyments(): Promise<void> {
  throw new Error("Polls are not supported by Elyments.");
}
