import "dotenv/config";
import { ElymentsClient } from "../src/client.js";
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
  const filePath = process.argv[2] || "dummy_doc.pdf";
  
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  // Simple type inference for the log/options
  const type = ext === ".pdf" ? "pdf" : (ext === ".mp3" ? "audio" : (ext === ".mp4" ? "video" : "file"));

  console.log(`Sending ${fileName} (${type}) to ${recipientInput}...`);

  try {
    // uploadAndSendMedia handles:
    // 1. Recipient resolution
    // 2. File upload to Azure
    // 3. Thumbnail generation (if image/video)
    // 4. Duration calculation (if audio/video) via ffprobe
    // 5. Sending the XMPP message with correct metadata
    const messageId = await client.uploadAndSendMedia(filePath, recipientInput, {
      type: type,
      caption: `Sent via example script: ${fileName}`
    });

    console.log(`Media message sent successfully. ID: ${messageId}`);
  } catch (error: any) {
    console.error("Error sending media:", error.message);
    process.exit(1);
  }

  setTimeout(() => process.exit(0), 2000);
}

main().catch(console.error);