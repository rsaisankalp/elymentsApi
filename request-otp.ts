import { ElymentsClient } from "./src/client.js";

async function main() {
  const client = new ElymentsClient();
  try {
    console.log("Requesting OTP for +91 9686188814...");
    await client.requestOtp({ countryCode: "+91", phoneNumber: "9686188814" });
    console.log("OTP requested successfully.");
  } catch (e: any) {
    console.error("Error requesting OTP:", e.message);
  }
}

main();
