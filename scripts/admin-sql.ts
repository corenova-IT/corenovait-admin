/**
 * First admin without SSH (npm run admin:sql). Runs on YOUR PC and never
 * connects to any database:
 *
 *   1. Asks for the admin's email, name and password (typed hidden, twice).
 *   2. Hashes the password with argon2id, the same way the portal does.
 *   3. Writes .private/first-admin-<date>.sql, containing the HASH only.
 *
 * The password itself is never written to disk, printed or logged.
 * Import the file once in Hostinger's phpMyAdmin, then delete it.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { hashPassword } from "../lib/auth/hash";
import { passwordProblems } from "../lib/password";
import { buildFirstAdminSql } from "./lib/first-admin-sql";

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // echo nothing while the password is typed
      const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
      out._writeToOutput = (s: string) => {
        if (s.startsWith(question)) out.output.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  if (!process.stdin.isTTY) {
    console.error("Run this in a terminal so the password can be typed hidden (not piped from a file or echo).");
    process.exit(1);
  }
  console.log("Create the first admin as an SQL file for phpMyAdmin. Nothing connects to a database.\n");

  const email = (await ask("Admin email: ")).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    console.error("That doesn't look like an email address.");
    process.exit(1);
  }
  const fullName = ((await ask("Full name: ")).trim() || email.split("@")[0]).slice(0, 120);

  let password = await ask("Password (hidden): ", true);
  const problems = passwordProblems(password, email);
  if (problems.length) {
    password = "";
    console.error("That password isn't strong enough:\n - " + problems.join("\n - "));
    process.exit(1);
  }
  const confirm = await ask("Type it again (hidden): ", true);
  if (confirm !== password) {
    password = "";
    console.error("The two passwords didn't match. Nothing was written.");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  password = "";

  const sql = buildFirstAdminSql({ id: randomUUID(), email, fullName, passwordHash, now: new Date() });
  const dir = path.resolve(process.cwd(), ".private");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `first-admin-${new Date().toISOString().slice(0, 10)}.sql`);
  writeFileSync(file, sql, { encoding: "utf8", mode: 0o600 });

  console.log(`\nWritten: ${file}`);
  console.log("It contains the password hash only. Next:");
  console.log("  1. Hostinger hPanel → Databases → phpMyAdmin → open the portal's database.");
  console.log("  2. Import → choose that file → Go. The result row should say \"First admin created\".");
  console.log("  3. Delete the file, then sign in and set up two-factor.");
}

main().catch(() => {
  console.error("Something went wrong. Nothing was written.");
  process.exit(1);
});
