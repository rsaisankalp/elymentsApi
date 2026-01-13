import { ChatSummary } from "../types.js";

const CHAT_BASE = "https://chatapi.elyments.com/api";

function extractLastMessage(rawBody?: string): string | undefined {
  if (!rawBody) return undefined;
  try {
    const parsed = JSON.parse(rawBody) as { info?: { message?: string } };
    return parsed?.info?.message;
  } catch {
    return rawBody;
  }
}

export async function listChats(accessToken: string): Promise<ChatSummary[]> {
  const res = await fetch(`${CHAT_BASE}/inboxDetails/v2?limit=1000`, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  const data = (await res.json()) as any;
  const items = Array.isArray(data)
    ? data
    : data?.inboxDetails ?? data?.result ?? data?.data ?? data?.response ?? [];
  if (!Array.isArray(items)) return [];

  return items.map((item: any) => {
    const jid = item?.remote_bare_jid ?? item?.remoteBareJid ?? item?.jid ?? "";
    const isGroup = typeof jid === "string" && jid.endsWith("@muclight.localhost");
    const title =
      item?.display_name ??
      item?.displayName ??
      item?.contact_name ??
      item?.name ??
      item?.group_name ??
      item?.group_name ??
      item?.remote_bare_jid_name ??
      item?.remoteBareJidName ??
      item?.remote_name ??
      item?.content?.message?.from_name ??
      item?.content?.message?.name ??
      item?.content?.message?.senderName ??
      jid;
    const lastMessage = extractLastMessage(item?.content?.message?.body);

    return {
      id: item?.id ?? jid,
      jid,
      isGroup,
      title,
      lastMessage,
      raw: item
    } satisfies ChatSummary;
  });
}
