// Prints a new APP_ENCRYPTION_KEY. Put it in .env.local / the hosting panel; never commit it.
// Changing it later makes existing two-factor secrets unreadable (everyone re-enrols).
import { randomBytes } from "node:crypto";
console.log(randomBytes(32).toString("base64"));
