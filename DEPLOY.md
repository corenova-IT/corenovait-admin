# Going live on Hostinger

A step-by-step guide to putting the CoreNovaIT portal online on Hostinger's **Node.js web app**
hosting. The app deploys from GitHub and updates itself on every push. No command-line
experience is needed, except running two commands on your own PC (steps 1 and 9).

Hostinger's screens change from time to time. If a label below doesn't match exactly, look for
the closest one; Hostinger's own guide is at
[docs.hostinger.com/node.js](https://docs.hostinger.com/node.js/overview).

**Never paste passwords, keys or secrets into chat, email, GitHub or this repo.** Keep them in
your password manager and type or paste them only into hPanel.

Contents:

1. [Before you start](#before-you-start)
2. [Make the secrets](#1-make-the-secrets-on-your-pc)
3. [Create the database](#2-create-the-database)
4. [Create the folders for uploads and backups](#3-create-the-folders-for-uploads-and-backups)
5. [Create the app from GitHub](#4-create-the-app-from-github)
6. [Environment variables](#5-environment-variables)
7. [First deploy](#6-first-deploy)
8. [Domain and SSL](#7-domain-and-ssl)
9. [Email with Resend](#8-email-with-resend)
10. [Create the first admin](#9-create-the-first-admin)
11. [The cron job](#10-the-cron-job-reminders-and-emails)
12. [No sample data in production](#11-no-sample-data-in-production)
13. [Updates, migrations and the automatic backup](#12-updates-migrations-and-the-automatic-backup)
14. [Backups and how to restore](#13-backups-and-how-to-restore)
15. [If something goes wrong](#14-if-something-goes-wrong)
16. [Go-live checklist](#15-go-live-checklist)

---

## Before you start

You need:

- **A Hostinger plan with Node.js web apps:** Business Web Hosting, or Cloud Startup or higher.
- **Admin access to the GitHub repository** `corenova-IT/corenovait-admin`.
- **The domain** the portal will use, e.g. `admin.corenovait.com.au`, with its DNS managed at
  Hostinger (or wherever you can add DNS records).
- **A Resend account** ([resend.com](https://resend.com)) for sending invite, reset and
  notification emails.
- **A password manager** (1Password, Bitwarden or similar) to keep the secrets you'll make.
- **On your PC:** this repo cloned, with Node.js 20 or newer and `npm install` run once.
  Only needed for steps 1 and 9.

## 1. Make the secrets (on your PC)

Open a terminal in the repo folder and run this **twice**:

```bash
npm run gen:key
```

Each run prints a new random value (44 characters). Save them in your password manager as:

- **`APP_ENCRYPTION_KEY`** (the first value). It encrypts everyone's two-factor secrets. If it's
  lost, everyone has to set up two-factor again. Never change it once the site is live.
- **`CRON_SECRET`** (the second value). It protects the scheduler that sends reminders.

You'll make the database password in step 2. Hostinger generates it.

## 2. Create the database

1. hPanel → **Websites** → your site → **Databases → MySQL Databases**.
2. Create a new database and user:
   - **Database name**, e.g. `corenovait` (Hostinger adds a prefix: `u123456789_corenovait`).
   - **Username**, e.g. `portal` (it becomes `u123456789_portal`).
   - **Password:** use the generator, at least 24 characters. Save it in your password manager.
3. **Leave Remote MySQL off.** The app reaches the database as `localhost` on the same server.
   Nothing else, including your PC, should ever connect to it.
4. Write your `DATABASE_URL` (you'll paste it in step 5), in this form:

   ```
   mysql://u123456789_portal:PASSWORD@localhost:3306/u123456789_corenovait
   ```

   If the password contains anything other than letters and numbers, those characters must be
   URL-encoded: `@` → `%40`, `#` → `%23`, `/` → `%2F`, `:` → `%3A`, `?` → `%3F`, `&` → `%26`,
   `%` → `%25`, `+` → `%2B`, space → `%20`. The simplest way to avoid this is to regenerate
   until the password is letters and numbers only (keep it long).

## 3. Create the folders for uploads and backups

Receipts, invoices and chat attachments, and the automatic database backups, must live
**outside** the app's folder. Every deploy replaces the app's folder, so anything kept there
would be lost.

1. hPanel → **Files → File Manager**. You start in your home folder, `/home/u123456789/`. The
   number is your account's; it's shown at the top of the File Manager.
2. Create two folders there (not inside `domains/` or `public_html/`):
   - `corenovait-uploads`
   - `corenovait-backups`
3. Note their full paths, e.g. `/home/u123456789/corenovait-uploads` and
   `/home/u123456789/corenovait-backups`.

## 4. Create the app from GitHub

1. hPanel → **Websites → Add Website → Node.js web app**.
2. Under **Import your Git repository**, click **Connect with GitHub**. In the popup, install the
   Hostinger GitHub App and give it access to **only** `corenova-IT/corenovait-admin`.
3. Choose the repository, then fill in the settings:

   | Setting | Value |
   | --- | --- |
   | Framework / application type | **Other** (not "Next.js": see the note below) |
   | Branch | `main` |
   | Node.js version | **22** |
   | Build command | `npm run build` |
   | Entry file | `server.mjs` |
   | Package manager | npm |

   > **Why "Other" and not "Next.js"?** Hostinger's Next.js preset starts the app its own way,
   > which would skip the portal's start-up step: it backs up the database, applies any database
   > updates, and only then starts the site. `server.mjs` does those steps in that order.

4. **Before clicking Deploy**, add the environment variables from step 5 (there's an
   **Environment variables** section on the same screen). If you deploy first, it will fail
   until they're set. That's harmless; just add them and save.

Auto-deploy is on from now on: every push to `main` rebuilds and restarts the app.

## 5. Environment variables

In the app's dashboard: **Environment variables → Add environment variable**, one by one. Saving
redeploys the app. Values are stored encrypted and shown masked.

**Required:**

| Name | Value | How to get it |
| --- | --- | --- |
| `NODE_ENV` | `production` | Type it. |
| `DATABASE_URL` | `mysql://u123456789_portal:PASSWORD@localhost:3306/u123456789_corenovait` | Step 2. |
| `APP_ENCRYPTION_KEY` | 44 characters | Step 1, first `npm run gen:key`. |
| `SITE_URL` | `https://admin.corenovait.com.au` | Your portal's address, with `https://` and no trailing `/`. Used in email links. |
| `CRON_SECRET` | 44 characters | Step 1, second `npm run gen:key`. |
| `UPLOAD_DIR` | `/home/u123456789/corenovait-uploads` | Step 3. |
| `BACKUP_DIR` | `/home/u123456789/corenovait-backups` | Step 3. |
| `RESEND_API_KEY` | starts with `re_` | Step 8. You can add it later, but invites and resets won't send until you do. |
| `MAIL_FROM` | `CoreNovaIT Portal <portal@corenovait.com.au>` | Step 8: an address on the domain you verify in Resend. |

**Optional** (leave them out to use the defaults):

| Name | Default | What it does |
| --- | --- | --- |
| `TRUST_PROXY_HOPS` | `1` | How many proxies sit in front of the app, so rate limits see each visitor's real address. Leave it at 1 unless step 15 says otherwise. |
| `SESSION_IDLE_MINUTES` | `30` | Sign out after this long without activity. |
| `SESSION_MAX_HOURS` | `12` | Sign out after this long regardless. |
| `UPLOAD_MAX_MB` | `10` | Largest file people can upload. |
| `DATABASE_POOL_SIZE` | `5` | Database connections. Shared hosting allows only a few; don't raise it. |

**Never set these in production:** `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME`,
`TEST_DATABASE_URL`, `DEV_DB_DIR`. Variables starting with `NEXT_PUBLIC_` would be sent to every
browser; the portal has none and needs none.

## 6. First deploy

1. Click **Deploy** (or save the environment variables, which redeploys).
2. Watch the build log. A build takes a few minutes and ends with the route table and no errors.
3. Open **Runtime logs**. On the first start you should see:

   ```
   Applied 10 migrations. Database is up to date.
   CoreNovaIT portal listening on port ...
   ```

   This first time there's nothing to back up (the database is empty), so no backup is made.
4. Open the temporary address Hostinger gives the app. You should see the sign-in page.

## 7. Domain and SSL

1. In the app's dashboard, connect your domain (e.g. `admin.corenovait.com.au`). For a subdomain,
   Hostinger adds the DNS record itself if your DNS is at Hostinger. Otherwise add the record it
   shows you at your DNS provider.
2. Turn on **SSL** (free) and wait until it shows as active (it can take up to an hour after DNS
   changes).
3. Open `https://admin.corenovait.com.au`: the padlock should show and the sign-in page load.
4. Make sure `SITE_URL` is exactly this address.

The portal sends HSTS, which tells browsers to use https only. That's why SSL must work before
people start using the site.

## 8. Email with Resend

1. Resend → **Domains → Add domain** → `corenovait.com.au` (if the public website already uses
   Resend, this domain may be verified already; skip to point 4).
2. Resend shows DNS records: an **MX** and a **TXT (SPF)** record for a `send` subdomain, and a
   **TXT (DKIM)** record like `resend._domainkey`. Add each one in hPanel → **Domains → DNS / Nameservers →
   DNS records**, copying the type, name and value exactly.
3. Back in Resend, click **Verify**. It can take from a few minutes to a few hours. Wait for
   **Verified**.
4. Optional but recommended: a **DMARC** record. Add TXT `_dmarc` with
   `v=DMARC1; p=none; rua=mailto:you@corenovait.com.au` (a mailbox you read).
5. Resend → **API Keys → Create API key**. Name it `portal`, permission **Sending access**,
   domain `corenovait.com.au`. Copy the key **once** into your password manager and into hPanel as
   `RESEND_API_KEY`.
6. Set `MAIL_FROM` to a sender on that domain, e.g. `CoreNovaIT Portal <portal@corenovait.com.au>`.
7. Save the environment variables (the app redeploys).

You'll test email in step 9 (the second admin's invite).

## 9. Create the first admin

The first admin is created by importing a small SQL file into the database, so no password ever
travels through hPanel, chat or email.

1. **On your PC**, in the repo folder:

   ```bash
   npm run admin:sql
   ```

   It asks for the admin's email (a real address: sample addresses like `@example.com` are
   refused), name and password, typed hidden and twice. The password needs 12+ characters and at
   least 3 of: lowercase, uppercase, number, symbol. It writes `.private/first-admin-<date>.sql`.
   That file holds the password's **hash only**. The script never connects to any database.
2. hPanel → **Databases → phpMyAdmin** → open the portal's database → **Import** → choose that
   file → **Go**.
3. The result should say **First admin created**. If it says **NOT CREATED**, an admin already
   exists and nothing changed.
4. **Delete the file** from your PC.
5. Sign in at your portal address. You'll set up two-factor straight away: scan the QR code with
   an authenticator app and **save the 10 recovery codes** in your password manager.
6. **Team and permissions → Invite person**: invite a second admin with the Admin role. This
   also tests email: the invite should arrive within a minute (check spam). Keep at least two
   admins, so one can always restore the other's access.

## 10. The cron job (reminders and emails)

Hostinger doesn't keep background jobs running, so a cron job calls the portal's scheduler every
5 minutes. The scheduler creates task, meeting and payment reminders, sends notification emails,
and cleans up chat attachments nobody uses any more.

1. hPanel → **Advanced → Cron Jobs → Create a new cron job**.
2. Type **Custom**. Command, on one line, with your domain and your `CRON_SECRET`:

   ```
   curl -fsS -m 60 -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" https://admin.corenovait.com.au/api/cron/notifications > /dev/null
   ```

3. Schedule: every 5 minutes (`*/5 * * * *`).
4. Save. To check it works, look at the cron job's output in hPanel if it's shown, or run the
   command once over SSH without `> /dev/null`. You should see `{"ok":true,...}`.
   - `401` means the secret in the command doesn't match `CRON_SECRET`.
   - `503` means `CRON_SECRET` isn't set on the app (or is shorter than 32 characters).
   - `429` means it ran more than 6 times in a minute. Check the schedule.

If you ever change `CRON_SECRET`, change it in both places.

## 11. No sample data in production

The demo data used during development (sample clients, ledgers, campaigns, chat, and sample
accounts like `@example.com`) **can't** be created in production:

- `npm run seed:dev` refuses when `NODE_ENV` is `production`, when the database isn't on this
  computer, or when `SITE_URL` isn't a local address.
- Inviting someone with a sample address (`example.com`, `.test`, `.invalid`, `localhost`) is
  refused in production, and so are `npm run seed:admin` and `npm run admin:sql` with such an address.
- The production database starts empty apart from roles, revenue streams and countries.

To confirm, sign in as an admin and open **Overview**, **Transactions** and **Marketing**: no page
should show the amber **SAMPLE DATA** label. In phpMyAdmin, this should return no rows:

```sql
SELECT email FROM users WHERE email LIKE '%@example.%' OR email LIKE '%.test' OR email LIKE '%.invalid';
```

## 12. Updates, migrations and the automatic backup

Every push to `main` redeploys. When an update changes the database (it adds a file to the
`drizzle/` folder), the app does this on start, in this order:

1. **Backs up the whole database** to `BACKUP_DIR` as `pre-migration-<date and time>.sql.gz`
   (the last 20 are kept).
2. Applies the database changes.
3. Starts the site.

If the backup can't be written (folder missing, disk full), **nothing is changed and the site
doesn't start**. The runtime log says why. Fix the cause, then redeploy (Deployments → Redeploy).

For bigger updates, also make your own copy first: hPanel → **phpMyAdmin → Export → Quick → SQL →
Go**, and keep the file. It costs a minute and gives you a second way back.

To undo a bad update:

1. Restore the `pre-migration-...` backup taken just before it (section 13).
2. On GitHub, revert the commit (the commit page → **Revert**, or ask the developer). Pushing the
   revert redeploys the previous version.

## 13. Backups and how to restore

**What's backed up:**

| What | How | How often |
| --- | --- | --- |
| Database | Hostinger's automatic backups (hPanel → **Files → Backups**) | Daily (how many are kept depends on your plan) |
| Database | The portal's own backup before every database change | Each update that changes the database |
| Database | Your copy: phpMyAdmin → **Export** | Monthly, and before big updates |
| Uploaded files | Hostinger's automatic backups include your home folder | Daily |
| Uploaded files | Your copy: File Manager → right-click `corenovait-uploads` → **Compress** → download the archive | Monthly |
| Keys | `APP_ENCRYPTION_KEY`, `CRON_SECRET`, the database password, the Resend key | In your password manager, once |

Download your copies and store them somewhere encrypted that isn't the hosting account and
isn't GitHub. A database backup without `APP_ENCRYPTION_KEY` can't check two-factor codes.

**To restore the database:**

1. Put the site in a quiet state: tell the team, and don't make changes while restoring.
2. hPanel → **phpMyAdmin** → select the portal's database → **Import** → choose the backup
   (`.sql` or `.sql.gz`, both work) → **Go**. A portal backup drops and recreates every table,
   so the database ends up exactly as it was at backup time.
   - From Hostinger's backups instead: hPanel → **Files → Backups → Database backups** → pick the
     date → **Restore**.
3. Restart the app (dashboard → the **Running** badge → **Restart**) and sign in to check.

Backups that are too large for phpMyAdmin's import limit can be restored over SSH (from the
backup folder):

```bash
gunzip < pre-migration-2026-11-01T10-00-00Z.sql.gz | mysql -u u123456789_portal -p u123456789_corenovait
```

It asks for the database password, typed hidden. Don't put it on the command line.

**To restore uploaded files:** File Manager → upload the archive into your home folder → right-click
→ **Extract**, so the files land back in `corenovait-uploads`. Or restore the home folder from
hPanel → **Files → Backups**.

Try a restore once before you depend on it: restore a backup into a second, empty database
(create one in step 2's screen) and look at it in phpMyAdmin.

## 14. If something goes wrong

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| Build fails | A problem in the pushed code | Read the build log under **Deployments**. The previous version keeps running. |
| **The app doesn't start after a deploy** | A missing environment variable, the database step failed, or the backup couldn't be written | Read **Runtime logs**. "is not set" names the missing variable. "The backup before migrating failed" means `BACKUP_DIR` is wrong or the disk is full. "Migration failed" means restore the pre-migration backup (section 13) and revert the commit. |
| "Set UPLOAD_DIR…" in the log | `UPLOAD_DIR` missing or not an absolute path | Set it as in step 5. |
| Invites and resets don't arrive | Resend key missing, or the domain isn't verified | Check `RESEND_API_KEY` and `MAIL_FROM`, Resend's **Logs** page and your spam folder. |
| No reminders | The cron job isn't running | Run the cron command by hand (step 10) and read the answer. |
| Signing in just shows the sign-in page again | The site is opened over `http://` (the session cookie only works over https) | Turn on SSL and use `https://` everywhere, including `SITE_URL` (step 7). |
| Lost two-factor device | | Sign in with a recovery code, or ask another admin to reset your two-factor (README, "Lost authenticator"). |

## 15. Go-live checklist

Tick each one before you tell the team the portal is open.

**Hosting and secrets**

- [ ] Node.js app: type **Other**, Node 22, build `npm run build`, entry file `server.mjs`, branch `main`.
- [ ] All required environment variables set (step 5); no `SEED_*`, `TEST_*` or `NEXT_PUBLIC_*` ones.
- [ ] `APP_ENCRYPTION_KEY`, `CRON_SECRET`, the database password and the Resend key are saved in the password manager.
- [ ] Remote MySQL is **off**.
- [ ] `UPLOAD_DIR` and `BACKUP_DIR` are outside `domains/` and `public_html/`.

**Site**

- [ ] `https://` works with a valid certificate, and `SITE_URL` matches it exactly.
- [ ] The runtime log shows "Database is up to date" and "listening".

**People and email**

- [ ] First admin signed in, two-factor set up, recovery codes saved.
- [ ] Second admin invited, the email arrived, and they finished setting up two-factor.
- [ ] Resend shows the domain as **Verified**; SPF and DKIM records are in DNS.

**Background jobs**

- [ ] Cron job runs every 5 minutes and returns `{"ok":true,...}`.

**Checks**

- [ ] No **SAMPLE DATA** label anywhere; the sample-account query in step 11 returns nothing.
- [ ] Upload a test receipt, open it, delete the test entry. Check `corenovait-uploads` has a file.
- [ ] **Audit log** shows your sign-in with **your real IP address**. If every sign-in shows the
      same internal address (like `10.x.x.x` or `127.0.0.1`), set `TRUST_PROXY_HOPS` to `2` and check again.
- [ ] Sign in as a Staff test user: they see Home, Calendar, Tasks and Chat only, and
      `/transactions` sends them to "No access". Deactivate the test user afterwards.

**Backups**

- [ ] You've made one phpMyAdmin export and know where it is, and Hostinger's daily backups are on.
- [ ] You've tried a restore into a spare database once.

**Accounts**

- [ ] Only the GitHub accounts that need it can push to `main` (GitHub → Settings → Branches →
      protect `main`).
