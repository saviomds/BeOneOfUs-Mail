import { expect, test } from "@playwright/test";

const adminEmail = "e2e-admin@beoneofus.com";
const adminPassword = "e2e-admin-test-password";
const memberEmail = `e2e-member-${Date.now()}@beoneofus.com`;
const memberPassword = "e2e-member-test-password";

test("registration and password recovery inputs show expected validation errors", async ({ page }) => {
  const pageErrors = [];
  const consoleWarnings = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "warning") consoleWarnings.push(message.text());
  });

  await page.goto("/register");
  const registerName = page.getByLabel("Your name");
  const registerEmail = page.getByLabel("Email address");
  const registerPassword = page.getByLabel("Password");
  await registerName.fill("A");
  await registerEmail.fill("outside@example.com");
  await registerPassword.fill("short");
  expect(await registerEmail.evaluate((input) => input.validity.patternMismatch)).toBe(true);
  expect(await registerPassword.evaluate((input) => input.validity.tooShort)).toBe(true);
  await page.getByRole("button", { name: /Create account/ }).click();
  await expect(page.locator("[data-profile-status]")).toBeEmpty();

  await registerEmail.fill(`invalid-name-${Date.now()}@beoneofus.com`);
  await registerPassword.fill("valid-test-password");
  await page.getByRole("button", { name: /Create account/ }).click();
  await expect(page.locator("[data-profile-status]")).toContainText(
    "Enter a name between 2 and 80 characters",
  );

  await page.goto("/forget-password");
  const resetEmail = page.getByLabel("Email address");
  await resetEmail.fill("outside@example.com");
  expect(await resetEmail.evaluate((input) => input.validity.patternMismatch)).toBe(true);
  await page.getByRole("button", { name: /Send reset link/ }).click();
  await expect(page.locator("[data-reset-request-status]")).toBeEmpty();

  await resetEmail.fill("unknown-e2e@beoneofus.com");
  await page.getByRole("button", { name: /Send reset link/ }).click();
  await expect(page.locator("[data-reset-request-status]")).toContainText(
    "Password recovery email delivery is not configured",
  );

  await page.goto("/reset-password#token=invalid");
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.locator("#new-password").fill("valid-test-password");
  await page.getByRole("button", { name: /Reset password/ }).click();
  await expect(page.locator("[data-reset-password-status]")).toContainText(
    "reset link is invalid or has expired",
  );
  expect(pageErrors).toEqual([]);
  expect(consoleWarnings).toEqual([]);
});

async function signIn(page, email, password) {
  if (!new URL(page.url()).pathname.endsWith("/login")) await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /Sign in/ }).click();
}

test("registration, approval, sign-in, mailbox, attachment, and profile/admin flows", async ({ page }) => {
  const pageErrors = [];
  const consoleWarnings = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "warning") consoleWarnings.push(message.text());
  });

  await page.goto("/register");
  await page.getByLabel("Your name").fill("E2E Member");
  await page.getByLabel("Email address").fill(memberEmail);
  await page.getByLabel("Password").fill(memberPassword);
  await page.getByRole("button", { name: /Create account/ }).click();
  await expect(page.locator("[data-profile-status]")).toContainText("sent to an administrator");

  await signIn(page, memberEmail, memberPassword);
  await expect(page.locator("[data-login-status]")).toContainText("awaiting admin approval");

  await signIn(page, adminEmail, adminPassword);
  await expect(page).toHaveURL(/\/admin$/);
  const memberRow = page.locator(".admin-users-table tbody tr").filter({ hasText: memberEmail });
  await memberRow.getByRole("button", { name: "Approve" }).click();
  const confirmationPassword = page.locator("[data-confirm-form] input[name=password]");
  await confirmationPassword.fill("incorrect-admin-password");
  await page.locator("[data-confirm-submit]").click();
  await expect(page.locator("[data-confirm-error]")).toContainText(
    "Admin password confirmation failed",
  );
  await confirmationPassword.fill(adminPassword);
  await page.locator("[data-confirm-submit]").click();
  await expect(memberRow).toContainText("approved");
  await page.locator("[data-signout]").click();
  await page.waitForURL(/\/login$/);

  await signIn(page, memberEmail, memberPassword);
  await expect(page).toHaveURL(/\/inbox$/);
  const inboxRows = page.locator("[data-message-list] .message-row");
  await expect(inboxRows.first()).toBeVisible();
  const initialUnreadCount = Number((await page.title()).match(/^\((\d+)\)/)?.[1]);
  expect(initialUnreadCount).toBeGreaterThan(0);
  const mailIcon = page.locator('link[rel~="icon"]');
  await expect(mailIcon).toHaveAttribute("type", "image/svg+xml");
  await expect(mailIcon).toHaveAttribute("href", /^data:image\/svg\+xml,/);
  await page.locator('[data-category="social"]').click();
  await expect.poll(() => page.title()).toBe(
    `(${initialUnreadCount - 1}) Inbox - BeOneOfUs Mail`,
  );
  await page.locator('[data-category="updates"]').click();
  await expect(page).toHaveTitle("Inbox - BeOneOfUs Mail");
  await expect(mailIcon).toHaveAttribute("type", "image/png");
  await page.locator('[data-category="primary"]').click();

  const firstMessage = inboxRows.first();
  const firstSubject = await firstMessage.locator("strong").innerText();
  const starButton = firstMessage.locator('[data-action="toggle-star"]');
  if (await starButton.getAttribute("aria-label") === "Star message") {
    await starButton.click();
  }
  await page.locator('[data-folder="starred"]').click();
  const starredMessage = page.locator("[data-message-list] .message-row").filter({
    hasText: firstSubject,
  });
  await expect(starredMessage).toHaveCount(1);
  await starredMessage.getByRole("button", { name: new RegExp(`Open ${firstSubject}`) }).click();
  await page.locator('.detail-toolbar [data-action="archive-current"]').click();
  await expect(page.locator("[data-toast]")).toContainText("archived");

  await page.locator('[data-action="compose"]').click();
  const composeTo = page.locator('[data-compose-form] input[name="to"]');
  const composeSubject = page.locator('[data-compose-form] input[name="subject"]');
  const composeBody = page.locator('[data-compose-form] textarea[name="body"]');
  await composeTo.fill("outside@example.com");
  await composeSubject.fill("E2E attachment test");
  await composeBody.fill("An attached note for browser testing.");
  expect(await composeTo.evaluate((input) => input.validity.patternMismatch)).toBe(true);
  await page.locator("[data-compose-form] .compose-send").click();
  await expect(page.locator("[data-compose-dialog]")).toBeVisible();
  await composeTo.fill(adminEmail);
  await page.locator("[data-file-input]").setInputFiles({
    name: "too-large.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(page.locator("[data-toast]")).toContainText("per-file limit is 5 MB");
  await expect(page.locator("[data-compose-attachments]")).not.toContainText("too-large.txt");
  await page.locator("[data-file-input]").setInputFiles({
    name: "e2e-note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Attachment contents stay in browser storage."),
  });
  await expect(page.locator("[data-compose-attachments]")).toContainText("e2e-note.txt");
  await page.locator("[data-file-input]").setInputFiles({
    name: "e2e-photo.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64",
    ),
  });
  await expect(page.locator("[data-compose-attachments]")).toContainText("e2e-photo.png");
  await page.locator("[data-compose-form] .compose-send").click();
  const sentMessage = page.locator("[data-message-list] .message-row").filter({
    hasText: "E2E attachment test",
  });
  await expect(sentMessage).toHaveCount(1);
  await sentMessage.getByRole("button", { name: /Open E2E attachment test/ }).click();
  await expect(page.locator("[data-message-detail]")).toContainText("e2e-note.txt");
  const messageMenuToggle = page.locator(
    '[data-message-detail] [data-action="toggle-message-menu"]',
  );
  await messageMenuToggle.click();
  await expect(messageMenuToggle).toHaveAttribute("aria-expanded", "true");
  const messageActions = page.locator("[data-message-action-menu]");
  for (const action of ["Edit sent message", "Reply", "Forward", "Move to trash"]) {
    await expect(messageActions).toContainText(action);
  }
  await messageActions.getByRole("menuitem", { name: "Edit sent message" }).click();
  await expect(page.locator("[data-compose-title]")).toHaveText("Edit sent message");
  await page.locator('[data-compose-form] textarea[name="body"]').fill(
    "Edited by the member. An attached note for browser testing.",
  );
  await page.locator("[data-compose-send]").click();
  await expect(page.locator("[data-toast]")).toContainText("updated for all recipients");
  await expect(page.locator("[data-message-detail]")).toContainText("Edited by the member.");
  await expect(page.locator("[data-message-detail]")).toContainText("e2e-photo.png");

  await page.locator("[data-profile-link]").click();
  await expect(page).toHaveURL(/\/profile$/);
  await page.getByRole("button", { name: "Edit profile" }).click();
  await page.locator('[data-profile-form] input[name="name"]').fill("Updated E2E Member");
  await page.locator('[data-profile-form] input[name="position"]').fill("QA Engineer");
  await page.locator('[data-profile-form] input[name="location"]').fill("Seattle");
  await page.locator('[data-profile-form] input[name="phone"]').fill("not a phone");
  await page.locator('[data-profile-form] button[type="submit"]').click();
  await expect(page.locator("[data-profile-status]")).toContainText("Enter a valid phone number");
  await page.locator('[data-profile-form] input[name="phone"]').fill("+1 555 010 1234");
  await page.locator('[data-profile-sticker-picker] [data-sticker-id="sparkle"]').click();
  await page.locator('[data-profile-form] button[type="submit"]').click();
  await expect(page.locator("[data-profile-name]")).toHaveText("Updated E2E Member");
  await expect(page.locator("[data-profile-detail-position]")).toHaveText("QA Engineer");

  await page.goto("/inbox");
  await page.locator('[data-action="logout"]').click();
  await page.waitForURL(/\/login$/);
  await signIn(page, adminEmail, adminPassword);
  await expect(page).toHaveURL(/\/admin$/);
  const adminMailForm = page.locator("[data-admin-mail-form]");
  await page.locator("[data-mail-recipient]").selectOption(memberEmail);
  await adminMailForm.locator('[name="subject"]').fill("Admin dashboard mail test");
  await adminMailForm.locator('[name="body"]').fill("A message sent from the admin dashboard.");
  await page.locator("[data-mail-files]").setInputFiles({
    name: "admin-photo.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64",
    ),
  });
  expect(pageErrors).toEqual([]);
  await expect(page.locator("[data-mail-status]")).toContainText("1 attachment");
  await expect(page.locator("[data-mail-compose-attachments]")).toContainText("admin-photo.png");
  await page.locator("[data-mail-send]").click();
  await expect(page.locator("[data-mail-status]")).toContainText(
    `Message delivered to ${memberEmail}`,
  );
  await expect(page.locator("[data-admin-mail-list]")).toContainText("Admin dashboard mail test");
  await expect(page.locator("[data-admin-mail-detail]")).toContainText("admin-photo.png");
  await expect(page.locator("[data-admin-mail-detail] img")).toHaveCount(1);
  await page.locator('[data-mail-folder="inbox"]').click();
  const memberMailboxOption = page.locator("[data-mailbox-owner] option").filter({ hasText: memberEmail });
  await page.locator("[data-mailbox-owner]").selectOption(await memberMailboxOption.getAttribute("value"));
  await page.locator('[data-mail-folder="sent"]').click();
  const receivedByAdmin = page.locator("[data-admin-mail-list] [data-mail-message-id]").filter({
    hasText: "E2E attachment test",
  });
  await expect(receivedByAdmin).toHaveCount(1);
  await receivedByAdmin.click();
  await expect(page.locator("[data-admin-mail-detail]")).toContainText(
    "Edited by the member.",
  );
  await expect(page.locator("[data-admin-mail-detail]")).toContainText(
    "An attached note for browser testing.",
  );
  await expect(page.locator("[data-admin-mail-detail] a")).toContainText([
    "e2e-note.txt",
    "e2e-photo.png",
  ]);
  await expect(page.locator("[data-admin-mail-detail] img")).toHaveCount(1);
  const memberMessageRow = page.locator(".admin-mail-row").filter({
    hasText: "E2E attachment test",
  });
  await memberMessageRow.locator("summary").click();
  await memberMessageRow.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator("[data-mail-form-title]")).toHaveText("Edit message");
  await adminMailForm.locator('[name="body"]').fill("Updated from the admin dashboard.");
  await page.locator("[data-mail-files]").setInputFiles({
    name: "admin-added.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Admin edit attachment."),
  });
  await page.locator("[data-mail-send]").click();
  await expect(page.locator("[data-mail-status]")).toContainText("Message updated");
  await expect(page.locator("[data-admin-mail-detail]")).toContainText(
    "Updated from the admin dashboard.",
  );
  await expect(page.locator("[data-admin-mail-detail]")).toContainText("admin-added.txt");
  await memberMessageRow.locator("summary").click();
  await memberMessageRow.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("[data-mail-delete-dialog]")).toBeVisible();
  await expect(page.locator("[data-mail-delete-copy]")).toContainText(
    'Permanently delete "E2E attachment test" from all mailboxes?',
  );
  await page.locator("[data-mail-delete-cancel]").click();
  await expect(page.locator("[data-mail-delete-dialog]")).not.toBeVisible();
  await memberMessageRow.locator("summary").click();
  await memberMessageRow.getByRole("button", { name: "Delete" }).click();
  await page.locator("[data-mail-delete-confirm]").click();
  await expect(page.locator("[data-admin-mail-list]")).not.toContainText("E2E attachment test");
  await page.locator("[data-user-search]").fill(memberEmail);
  await expect(memberRow).toContainText("Updated E2E Member");
  await memberRow.getByRole("button", { name: "View profile" }).click();
  await expect(page.locator("[data-employee-dialog]")).toContainText("QA Engineer");
  await page.locator("[data-edit-employee]").click();
  await page.locator('[data-employee-form] input[name="name"]').fill("A");
  await page.locator('[data-employee-form] input[name="password"]').fill(adminPassword);
  await page.locator("[data-save-employee]").click();
  await expect(page.locator("[data-employee-form-error]")).toContainText(
    "Enter a name between 2 and 80 characters",
  );
  await page.locator('[data-employee-form] input[name="name"]').fill("Updated E2E Member");
  await page.locator('[data-employee-form] input[name="position"]').fill("Senior QA Engineer");
  await page.locator("[data-save-employee]").click();
  await expect(page.locator("[data-employee-position]")).toHaveText("Senior QA Engineer");
  await page.locator("[data-close-employee]").click();

  const smtpForm = page.locator("[data-smtp-form]");
  await smtpForm.locator('[name="host"]').fill("smtp.example.test");
  await smtpForm.locator('[name="port"]').fill("587");
  await smtpForm.locator('[name="from"]').fill("mail@beoneofus.com");
  await smtpForm.locator('[name="username"]').fill("smtp-user");
  await smtpForm.locator('[name="password"]').fill("test-smtp-secret");
  await smtpForm.locator('[name="passwordConfirmation"]').fill(adminPassword);
  await smtpForm.locator('[name="host"]').fill("bad host");
  await page.locator("[data-smtp-test]").click();
  await expect(page.locator("[data-smtp-status]")).toContainText("Enter a valid SMTP hostname");
  await smtpForm.locator('[name="host"]').fill("smtp.example.test");
  await smtpForm.locator('[name="passwordConfirmation"]').fill("incorrect-admin-password");
  await page.locator("[data-smtp-test]").click();
  await expect(page.locator("[data-smtp-status]")).toContainText(
    "Admin password confirmation failed",
  );
  await smtpForm.locator('[name="passwordConfirmation"]').fill(adminPassword);
  await page.locator("[data-smtp-test]").click();
  await expect(page.locator("[data-smtp-status]")).toContainText(
    `A test email was sent to ${adminEmail}`,
  );
  await page.locator("[data-smtp-save]").click();
  await expect(page.locator("[data-smtp-status]")).toHaveText("SMTP settings saved.");
  await expect(page.locator("[data-smtp-state]")).toContainText("Configured via admin");
  await expect(smtpForm.locator('[name="password"]')).toHaveValue("");
  expect(await page.locator("[data-smtp-form]").innerText()).not.toContain("test-smtp-secret");

  const databaseForm = page.locator("[data-database-form]");
  await expect(page.locator("[data-active-database]")).toHaveText("JSON");
  await databaseForm.locator('[name="projectUrl"]').fill("http://127.0.0.1");
  await databaseForm.locator('[name="apiKey"]').fill("test-supabase-secret");
  await databaseForm.locator('[name="passwordConfirmation"]').fill(adminPassword);
  await page.locator("[data-database-test]").click();
  await expect(page.locator("[data-database-status]")).toContainText(
    "Use an HTTPS Supabase project URL",
  );
  await databaseForm.locator('[name="projectUrl"]').fill("https://e2e-project.supabase.co");
  await databaseForm.locator('[name="passwordConfirmation"]').fill("incorrect-admin-password");
  await page.locator("[data-database-test]").click();
  await expect(page.locator("[data-database-status]")).toContainText(
    "Admin password confirmation failed",
  );
  await databaseForm.locator('[name="passwordConfirmation"]').fill(adminPassword);
  await page.locator("[data-database-test]").click();
  await expect(page.locator("[data-database-status]")).toContainText(
    "Supabase connection test succeeded. JSON remains the active database.",
  );
  await page.locator("[data-database-save]").click();
  await expect(page.locator("[data-database-status]")).toContainText(
    "Supabase settings saved for a future database upgrade. JSON remains active.",
  );
  await expect(page.locator("[data-database-state]")).toContainText("Future connection configured");
  await expect(page.locator("[data-active-database]")).toHaveText("JSON");
  await expect(databaseForm.locator('[name="apiKey"]')).toHaveValue("");
  expect(await databaseForm.innerText()).not.toContain("test-supabase-secret");

  expect(pageErrors).toEqual([]);
  expect(consoleWarnings).toEqual([]);
});
