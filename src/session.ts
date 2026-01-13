import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { ElymentsSession } from "./types.js";

const DEFAULT_PATH = "./session.json";

export function resolveSessionPath(sessionPath?: string): string {
  const raw = sessionPath?.trim() || DEFAULT_PATH;
  if (raw.startsWith("~/")) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
}

export async function loadSession(sessionPath?: string): Promise<ElymentsSession | null> {
  const filePath = resolveSessionPath(sessionPath);
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as ElymentsSession;
  } catch {
    return null;
  }
}

export async function saveSession(
  session: ElymentsSession,
  sessionPath?: string
): Promise<void> {
  const filePath = resolveSessionPath(sessionPath);
  const payload = JSON.stringify(session, null, 2);
  await fs.writeFile(filePath, payload, "utf8");
}
