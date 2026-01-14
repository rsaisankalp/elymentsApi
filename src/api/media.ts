import fs from "fs";
import { resolveMimeType, type MediaInfoType } from "../media.js";

const CHAT_BASE = "https://chatapi.elyments.com/api";

export async function getUploadUrl(accessToken: string): Promise<{ objectId: string; url: string }> {
  const res = await fetch(`${CHAT_BASE}/azure/upload/url/1`, {
    headers: {
      "authorization": `Bearer ${accessToken}`,
      "accept": "application/json, text/plain, */*",
      "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
      "elyments-client-info": '{"applicationVersion":"143.0.0", "deviceOSVersion":"Mac OS","deviceModel":"chrome","deviceOEMName":"browser","deviceType":"Web"}',
      "sec-ch-ua": '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "Referer": "https://web.elyments.com/",
      "Origin": "https://web.elyments.com"
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get upload URL: ${res.status} ${text}`);
  }
  return res.json() as Promise<{ objectId: string; url: string }>;
}

export async function uploadToAzure(uploadUrl: string, filePath: string): Promise<void> {
  const fileBuffer = fs.readFileSync(filePath);
  const contentType = resolveMimeType(filePath);

  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "x-ms-blob-type": "BlockBlob",
      "content-type": contentType,
      "sec-ch-ua": '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "Referer": "https://web.elyments.com/",
      "Origin": "https://web.elyments.com"
    },
    body: fileBuffer
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to upload to Azure: ${res.status} ${text}`);
  }
}

export async function getThumbnail(
  accessToken: string,
  objectId: string,
  type: MediaInfoType | string
): Promise<{ url: string }> {
  const res = await fetch(`${CHAT_BASE}/media/getThumbnail`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${accessToken}`,
      "accept": "application/json, text/plain, */*",
      "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
      "elyments-client-info": '{"applicationVersion":"143.0.0", "deviceOSVersion":"Mac OS","deviceModel":"chrome","deviceOEMName":"browser","deviceType":"Web"}',
      "sec-ch-ua": '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "Referer": "https://web.elyments.com/",
      "Origin": "https://web.elyments.com"
    },
    body: JSON.stringify({ objectId, type })
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get thumbnail: ${res.status} ${text}`);
  }
  
  const data = await res.json() as any;
  return { url: data.url };
}
