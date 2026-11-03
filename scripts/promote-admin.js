import { promoteAccountToAdmin } from "../services/admin.service.js";

const email = process.argv[2];
if (!email) {
  console.error("Usage: npm run admin:promote -- employee@beoneofus.com");
  process.exitCode = 1;
} else {
  try {
    const admin = await promoteAccountToAdmin(email);
    console.log(`Admin access enabled for ${admin.email}.`);
  } catch (error) {
    console.error(error.message || "Could not promote the account.");
    process.exitCode = 1;
  }
}
