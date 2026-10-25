/**
 * Last-resort two-factor reset, for when an admin has lost their phone AND
 * their recovery codes AND no other admin can reset it from the Team page.
 * Run it on the server (Hostinger SSH), never from your own PC:
 *
 *   npm run reset-2fa -- person@corenovait.com.au --yes
 *
 * Their authenticator and recovery codes stop working, every session ends,
 * and they set up a new authenticator at their next sign-in. It's recorded
 * in the audit log.
 */
import { loadEnvFile } from "./load-env.mjs";

loadEnvFile();

async function main() {
  const args = process.argv.slice(2);
  const email = args.find((a) => a.includes("@"));
  if (!email || !args.includes("--yes")) {
    console.error("Usage: npm run reset-2fa -- person@example.com --yes");
    process.exit(1);
  }
  const { operatorResetTwoFactor } = await import("../lib/dal/auth");
  const { closeDb } = await import("../lib/db");
  try {
    await operatorResetTwoFactor(email);
    console.log(`Two-factor reset for ${email}. They'll set it up again at their next sign-in.`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : "Reset failed.");
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

main();
