# BeOneOfUs Mail

## Run locally

Use the Express server so the page routes and API are available:

```powershell
npm start
```

Open `http://localhost:3000`. Accounts are restricted to `@beoneofus.com` and require administrator approval before sign-in or mailbox access. A company-domain address alone is not proof of employment; an administrator must verify each request.

### Set up the first administrator

1. Register the intended administrator with their `@beoneofus.com` address.
2. Stop the Express server so the JSON file is not written by two processes at once.
3. From the project directory, promote that account using its exact address:

   ```powershell
   npm run admin:promote -- admin@beoneofus.com
   ```

4. Restart the Express server and sign in with the promoted account. It can open `/admin` and approve employee requests.

Promotion is an operator-only command and is not available through the web API. Existing database accounts without an approval status are treated as pending until an administrator explicitly approves or promotes them.

## JSON database

The app creates `data/mail-database.json` on its first API request. It stores account records, roles and approval statuses, password hashes, hashed session identifiers, notifications, a bounded admin audit log, and per-user mailboxes. Passwords are hashed with Node.js `scrypt`; session cookies are HTTP-only and expire after seven days. Password recovery uses one-time, SHA-256-hashed tokens that expire after 30 minutes. Password reset requests are limited to three per email address and ten per client IP in a 15-minute window; token submissions are also limited per IP. These rate limits are process-local and are intended only for the documented single-process setup. Reset email delivery requires SMTP configuration; recovery requests fail explicitly when delivery is not configured. Configure `APP_BASE_URL` to the canonical HTTPS origin before deployment. Reset links carry only the token in the URL fragment, not the account email, and the page removes the fragment from the address bar after reading it. The database directory is excluded from Git.

Set `JSON_DATABASE_PATH` to use a different file. Keep the database private and make backups before editing or replacing it. This lightweight JSON store is intended for local development and a single Node.js process; it is not a substitute for a transactional database for multi-process or production traffic.

Composed messages and drafts only accept approved `@beoneofus.com` recipients, and Sent records must use the current account's approved address. Sending delivers a copy to the recipient's Inbox and saves a copy in the sender's Sent folder. Approved account addresses are locked to the verified account and cannot be changed from the profile page. Message and draft metadata and uploaded attachment contents are stored in the private JSON database. Attachments support any file type, up to 5 MB per file, 30 files and 15 MB per message, with a 100 MB attachment limit per mailbox. Images in common safe formats are previewed; other files are downloaded. Older messages whose files existed only in a browser's IndexedDB remain visible but their file contents cannot be recovered from another browser. Internal messages are not delivered to external mail systems.

Members can edit their own sent messages; edits update both the Sent and Inbox copies. Members can manage drafts and move messages to Trash or permanently delete them from Trash. The admin page is served only to authenticated administrators and is sent with `Cache-Control: no-store`. Administrators can select employee mailboxes, read messages and attachments, send internal mail with attachments, edit messages and attachments, mark messages as read, and delete messages. Admin edits update both the Sent and Inbox copies; admin deletions remove all copies. Admin mail changes are recorded in the audit log without storing message content there. This is privileged access to employee mail and should be granted only to trusted administrators. The admin overview API reports approval requests and aggregate mailbox counts. Approve, reject, suspend, edit, and delete actions require same-origin requests; account changes also require the administrator's current password, and rejecting or suspending requires a reason. Five failed password confirmations are rate-limited for 15 minutes. Account roles cannot be assigned from the dashboard. Standard security headers and a same-origin content security policy are enabled.

The JSON database's in-process write queue and local file persistence are for a trusted local, single-process setup only. Do not expose this service directly to the public internet or use it for production employee data; production use needs a durable transactional database, real company identity verification, robust distributed rate limiting, secure deployment configuration, and operational backups.

### Password recovery email

Copy `.env.example` to `.env`. The admin portal's **Email delivery (SMTP)** panel lets an administrator configure SMTP host, port, TLS, sender, and authentication; it can send a test email to the signed-in administrator and links to Google Workspace, Microsoft 365, Amazon SES, and Nodemailer setup guides. Changes require the administrator's current password.

Before saving settings in the portal, set `APP_SETTINGS_ENCRYPTION_KEY` to a random base64-encoded 32-byte key. Generate one with:

```powershell
node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('base64'))"
```

Keep this key in the server's environment or secret manager, never in the database or source control. SMTP passwords and future database API keys are encrypted with AES-256-GCM in the JSON database and are never returned to the browser. Back up this key securely; losing or changing it makes saved secrets undecryptable. Existing deployments using the earlier `SMTP_SETTINGS_ENCRYPTION_KEY` name remain supported as a fallback. Existing `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` environment settings remain the fallback until settings are saved in the portal. Port 587 with STARTTLS is the default; port 465 generally uses implicit TLS. SMTP authentication is optional, but username and password must be supplied together. Local development uses `http://localhost:3000` unless `APP_BASE_URL` is set; production must use the canonical HTTPS origin. Never put email addresses in reset links or log reset tokens.

The admin portal is the place for runtime service settings and provider setup links; application/dependency upgrades still require an operator-controlled deployment rather than executing package upgrades from the web UI.

The **Supabase connection** panel stores an HTTPS Supabase project URL and encrypted project API key, provides a connectivity test and setup links, and records changes in the admin audit log. Its connection test is restricted to `*.supabase.co`. This is preparation only: the running app continues to use its JSON database, and no data is migrated. Activating Supabase requires a separate application backend implementation, schema migration, and deployment.

## API

- `POST /api/auth/register` — request an account; responds `202` without creating a session
- `POST /api/auth/login` — authenticate and start a session
- `POST /api/auth/logout` — end the current session
- `POST /api/auth/password-reset/request` — request a generic-response reset email
- `POST /api/auth/password-reset/confirm` — reset a password using its one-time token
- `GET /api/auth/me` — get the current account
- `GET /api/users/me` and `PUT /api/users/me` — read or update profile details
- `GET /api/users/me/notifications` — retrieve and mark account status notifications as read
- `GET /api/mailbox` and `PUT /api/mailbox` — read or save the current user's mailbox
- `POST /api/mailbox/send` — deliver an internal message, with attachments, to an approved company account
- `GET /api/mailbox/messages/:messageId/attachments/:attachmentId` — read or download an attachment in the current mailbox
- `PATCH /api/mailbox/messages/:messageId/read` — mark a received message as read
- `PATCH /api/mailbox/messages/:messageId` — edit a sent message across the sender's and recipient's mailbox copies
- `GET /api/admin/overview` — admin-only account approvals and aggregate traffic counts
- `GET /api/admin/users/:userId/mailbox` — read an employee mailbox (admin-only)
- `GET /api/admin/users/:userId/mailbox/messages/:messageId/attachments/:attachmentId` — read an employee-mailbox attachment (admin-only)
- `PATCH /api/admin/users/:userId/mailbox/messages/:messageId/read` — mark an employee message as read (admin-only)
- `PATCH /api/admin/users/:userId/mailbox/messages/:messageId` — edit a message and its attachments across mailbox copies (admin-only)
- `DELETE /api/admin/users/:userId/mailbox/messages/:messageId` — delete a message and its attachments across mailbox copies (admin-only)
- `GET /api/admin/settings/smtp` — admin-only SMTP status (never returns secrets)
- `PUT /api/admin/settings/smtp` — save SMTP settings with admin-password confirmation
- `POST /api/admin/settings/smtp/test` — email a delivery test to the signed-in administrator
- `GET /api/admin/settings/database/supabase` — read future Supabase status without returning its key
- `PUT /api/admin/settings/database/supabase` — save encrypted future connection settings
- `POST /api/admin/settings/database/supabase/test` — test HTTPS connectivity to the saved/supplied Supabase project
- `PATCH /api/admin/users/:userId/status` — admin-only approve, reject, or suspend a member

Run backend integration tests with `npm test`. Run Chromium browser end-to-end coverage with `npm run test:e2e`; install its browser once with `npx playwright install chromium`.
