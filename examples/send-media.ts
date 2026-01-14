import "dotenv/config";
import { ElymentsClient } from "../src/client.js";
import { getUploadUrl, uploadToAzure, getThumbnail } from "../src/api/media.js";
import path from "path";
import fs from "fs";

async function main() {
  const client = new ElymentsClient();
  const session = await client.loadSession();
  
  if (!session) {
    console.error("No session found. Please login first using the CLI or .env variables.");
    process.exit(1);
  }

  const recipientInput = process.env.ELYMENTS_TO || "Swamiji Office Vds Aol";
  console.log(`Resolving recipient: ${recipientInput}...`);
  
  let recipient;
  try {
    recipient = await client.resolveRecipient(recipientInput);
    console.log(`Resolved to: ${recipient.title} (${recipient.jid})`);
  } catch (error: any) {
    console.error(`Error resolving recipient: ${error.message}`);
    process.exit(1);
  }

  const filePath = process.argv[2] || "dummy_doc.pdf";
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const type = ext === ".pdf" ? "pdf" : (ext === ".mp3" ? "audio" : (ext === ".mp4" ? "video" : "file"));

  console.log(`Uploading ${fileName} (${type})...`);

  // 1. Get Upload URL
  const { objectId, url: uploadUrl } = await getUploadUrl(session.chatAccessToken);
  console.log(`Got objectId: ${objectId}`);

  // 2. Upload to Azure
  await uploadToAzure(uploadUrl, filePath);
  console.log("Uploaded to Azure.");

  // 3. Get Thumbnail
  let thumbnailUrl: string | undefined;
  try {
    const thumb = await getThumbnail(session.chatAccessToken, objectId, type as any);
    thumbnailUrl = thumb.url;
    console.log("Got thumbnail URL.");
  } catch (e) {
    console.warn("Could not get thumbnail, proceeding without it.");
  }

  // 4. Send Media Message
  console.log("Sending message...");
  await client.sendMedia({
    jid: recipient.jid,
    isGroup: recipient.isGroup,
    media: {
      type: type as any,
      url: uploadUrl.split("?")[0],
      id: objectId,
      name: fileName,
      size: fs.statSync(filePath).size,
      thumbnailUrl
    }
  });

  console.log("Media message sent successfully.");
  setTimeout(() => process.exit(0), 2000);
}

main().catch(console.error);
