import { ElymentsClient } from "./src/client.js";

async function main() {
  const otp = process.argv[2];
  if (!otp) {
    console.error("Please provide OTP as argument");
    process.exit(1);
  }
  const client = new ElymentsClient();
  try {
    console.log(`Verifying OTP ${otp} for +91 9686188814...`);
    await client.verifyOtp({ countryCode: "+91", phoneNumber: "9686188814", otp });
    console.log("Login successful. Session saved.");
  } catch (e: any) {
    console.error("Error verifying OTP:", e.message);
    process.exit(1);
  }
}

main();
