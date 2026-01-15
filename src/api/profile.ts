const PROFILE_BASE = "https://profileapi.elyments.com/api/users";

export async function syncContacts(
  accessToken: string,
  options: { updatedTs?: number; limit?: number } = {}
): Promise<any[]> {
  const updatedTs = options.updatedTs ?? 1;
  const limit = Math.max(options.limit ?? 1000, 1000);
  const res = await fetch(`${PROFILE_BASE}/syncContacts/V2?updatedTs=${updatedTs}&limit=${limit}`, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  const data = (await res.json()) as any;
  if (Array.isArray(data)) return data;
  return data?.result ?? data?.data ?? data?.response ?? [];
}
