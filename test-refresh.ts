import { ElymentsClient } from "./src/client.js";

async function main() {
  const client = new ElymentsClient();
  try {
    await client.loadSession();
    console.log("Session loaded. Attempting refresh...");
    const newSession = await client.refreshSession();
    console.log("Refresh successful!");
    console.log("New Access Token starts with:", newSession.accessToken.substring(0, 10));
    console.log("New Chat Access Token starts with:", newSession.chatAccessToken.substring(0, 10));
  } catch (e: any) {
    console.error("Refresh failed:", e.message);
    if (e.response) {
       console.error("Response:", await e.response.text());
    }
    process.exit(1);
  }
}

main();
