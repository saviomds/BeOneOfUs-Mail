import { apiRequest } from "./api-client.js";
import { getProfileStickerSymbol, PROFILE_STICKERS } from "./profile-stickers.js";

const elements = {
  status: document.querySelector("[data-status]"),
  users: document.querySelector("[data-users]"),
  usersEmpty: document.querySelector("[data-users-empty]"),
  notifications: document.querySelector("[data-notifications]"),
  pendingCount: document.querySelector("[data-pending-count]"),
  statusFilter: document.querySelector("[data-status-filter]"),
  search: document.querySelector("[data-user-search]"),
  resultCount: document.querySelector("[data-result-count]"),
  auditLog: document.querySelector("[data-audit-log]"),
  lastUpdated: document.querySelector("[data-last-updated]"),
  refresh: document.querySelector("[data-refresh]"),
  dialog: document.querySelector("[data-confirm-dialog]"),
  confirmForm: document.querySelector("[data-confirm-form]"),
  confirmTitle: document.querySelector("[data-confirm-title]"),
  confirmCopy: document.querySelector("[data-confirm-copy]"),
  reasonWrap: document.querySelector("[data-reason-wrap]"),
  reason: document.querySelector("[data-confirm-reason]"),
  confirmError: document.querySelector("[data-confirm-error]"),
  confirmSubmit: document.querySelector("[data-confirm-submit]"),
  employeeDialog: document.querySelector("[data-employee-dialog]"),
  employeeAvatar: document.querySelector("[data-employee-avatar]"),
  employeeInitial: document.querySelector("[data-employee-initial]"),
  employeePhoto: document.querySelector("[data-employee-photo]"),
  employeeSticker: document.querySelector("[data-employee-sticker]"),
  employeeName: document.querySelector("[data-employee-name]"),
  employeeEmail: document.querySelector("[data-employee-email]"),
  employeeStatus: document.querySelector("[data-employee-status]"),
  employeePosition: document.querySelector("[data-employee-position]"),
  employeePhone: document.querySelector("[data-employee-phone]"),
  employeeLocation: document.querySelector("[data-employee-location]"),
  employeeBio: document.querySelector("[data-employee-bio]"),
  employeeError: document.querySelector("[data-employee-error]"),
  employeeDetails: document.querySelector(".admin-employee-details"),
  employeeViewActions: document.querySelector("[data-employee-view-actions]"),
  employeeEditButton: document.querySelector("[data-edit-employee]"),
  employeeSaveStatus: document.querySelector("[data-employee-save-status]"),
  employeeForm: document.querySelector("[data-employee-form]"),
  employeeFormError: document.querySelector("[data-employee-form-error]"),
  employeeSave: document.querySelector("[data-save-employee]"),
  smtpForm: document.querySelector("[data-smtp-form]"),
  smtpState: document.querySelector("[data-smtp-state]"),
  smtpStatus: document.querySelector("[data-smtp-status]"),
  smtpSave: document.querySelector("[data-smtp-save]"),
  smtpTest: document.querySelector("[data-smtp-test]"),
  databaseForm: document.querySelector("[data-database-form]"),
  databaseState: document.querySelector("[data-database-state]"),
  databaseStatus: document.querySelector("[data-database-status]"),
  databaseSave: document.querySelector("[data-database-save]"),
  databaseTest: document.querySelector("[data-database-test]"),
  mailForm: document.querySelector("[data-admin-mail-form]"),
  mailRecipient: document.querySelector("[data-mail-recipient]"),
  mailStatus: document.querySelector("[data-mail-status]"),
  mailSend: document.querySelector("[data-mail-send]"),
  mailRefresh: document.querySelector("[data-mail-refresh]"),
  mailFolders: document.querySelectorAll("[data-mail-folder]"),
  mailOwner: document.querySelector("[data-mailbox-owner]"),
  mailCount: document.querySelector("[data-mail-count]"),
  mailList: document.querySelector("[data-admin-mail-list]"),
  mailDetail: document.querySelector("[data-admin-mail-detail]"),
  mailDeleteDialog: document.querySelector("[data-mail-delete-dialog]"),
  mailDeleteCopy: document.querySelector("[data-mail-delete-copy]"),
  mailDeleteError: document.querySelector("[data-mail-delete-error]"),
  mailDeleteConfirm: document.querySelector("[data-mail-delete-confirm]"),
  mailFormTitle: document.querySelector("[data-mail-form-title]"),
  mailRecipientWrap: document.querySelector("[data-mail-recipient-wrap]"),
  mailFiles: document.querySelector("[data-mail-files]"),
  mailComposeAttachments: document.querySelector("[data-mail-compose-attachments]"),
  mailCancelEdit: document.querySelector("[data-mail-cancel-edit]"),
};

let accounts = [];
let pendingNotificationIds = new Set();
let hasLoaded = false;
let loadInProgress = false;
let selectedAction = null;
let pendingChanges = new Map();
let employeeProfileRequest = 0;
let activeEmployeeProfile = null;
let adminMailbox = null;
let currentAdminId = null;
let adminMailboxOwnerId = null;
let adminMailFolder = "inbox";
let selectedAdminMessageId = null;
let pendingAdminDelete = null;
let adminComposeAttachments = [];
let editingAdminMessageId = null;

function node(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function formatFileSize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function handleAdminError(error, { redirectForbidden = false } = {}) {
  if (error.status === 401) {
    window.location.assign("/login");
    return true;
  }
  if (
    error.status === 403 &&
    (redirectForbidden ||
      error.message === "Admin access is required." ||
      error.message === "Admin access is no longer available.")
  ) {
    window.location.assign("/inbox");
    return true;
  }
  return false;
}

function setStats(stats) {
  for (const [key, value] of Object.entries(stats)) {
    const target = document.querySelector(`[data-stat="${key}"]`);
    if (target) target.textContent = Number(value).toLocaleString();
  }
  elements.pendingCount.textContent = `${stats.pending} pending`;
}

function actionButton(label, status, userId, variant = "") {
  const button = node("button", `admin-action-button ${variant}`, label);
  button.type = "button";
  button.dataset.userId = userId;
  button.dataset.status = status;
  return button;
}

function renderNotifications(notifications) {
  const nextIds = new Set(notifications.map((item) => item.id));
  const freshRequest = notifications.find((item) => !pendingNotificationIds.has(item.id));
  elements.notifications.replaceChildren();
  if (notifications.length === 0) {
    elements.notifications.append(node("p", "admin-no-notifications", "You're all caught up. No requests need review."));
  } else {
    for (const item of notifications) {
      const notice = node("article", "admin-notification");
      const marker = node("span", "admin-notification-marker", "!");
      const copy = node("div", "admin-notification-copy");
      copy.append(node("strong", "", item.title), node("p", "", item.message));
      const date = node("time", "", dateLabel(item.createdAt));
      const actions = node("div", "admin-notification-actions");
      actions.append(
        actionButton("Approve", "approved", item.userId, "approve"),
        actionButton("Reject", "rejected", item.userId, "quiet"),
      );
      notice.append(marker, copy, date, actions);
      elements.notifications.append(notice);
    }
  }
  pendingNotificationIds = nextIds;
  if (freshRequest && hasLoaded) {
    elements.status.textContent = "A new employee access request needs review.";
  }
  hasLoaded = true;
}

function makeIdentityCell(user) {
  const cell = node("td", "admin-identity");
  const sticker = getProfileStickerSymbol(user.avatarSticker);
  const avatar = node("span", `admin-user-avatar${user.profilePhoto ? " has-avatar-photo" : ""}`);
  const image = user.profilePhoto ? node("img") : null;
  if (image) {
    image.src = user.profilePhoto;
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    avatar.append(image);
  } else {
    avatar.textContent = sticker || user.name.trim().charAt(0).toLocaleUpperCase() || "?";
  }
  if (sticker && image) avatar.append(node("span", "avatar-sticker", sticker));
  if (sticker && !image) avatar.classList.add("has-avatar-sticker");
  avatar.setAttribute("aria-hidden", "true");
  const copy = node("span", "admin-identity-copy");
  copy.append(node("strong", "", user.name));
  const email = node("span", "admin-identity-email", user.email);
  email.title = user.email;
  copy.append(email);
  if (user.position) copy.append(node("span", "admin-identity-position", user.position));
  const identity = node("span", "admin-identity-content");
  identity.append(avatar, copy);
  cell.append(identity);
  return cell;
}

function makeAccountActions(user) {
  const cell = node("td", "admin-actions");
  const profileButton = node("button", "admin-action-button admin-profile-button", "View profile");
  profileButton.type = "button";
  profileButton.dataset.profileUserId = user.id;
  cell.append(profileButton);
  if (user.role === "admin") {
    cell.append(node("span", "admin-immutable-note", "Protected admin"));
  } else if (pendingChanges.has(user.id)) {
    cell.append(node("span", "admin-immutable-note", "Updating access…"));
  } else if (user.status === "pending") {
    cell.append(
      actionButton("Approve", "approved", user.id, "approve"),
      actionButton("Reject", "rejected", user.id, "quiet"),
    );
  } else if (user.status === "approved") {
    cell.append(actionButton("Suspend", "suspended", user.id, "danger"));
  } else {
    cell.append(actionButton("Approve", "approved", user.id, "approve"));
  }
  return cell;
}

function renderUsers() {
  const filter = elements.statusFilter.value;
  const query = elements.search.value.trim().toLocaleLowerCase();
  const visible = accounts.filter((user) => {
    const matchesStatus = filter === "all" ||
      (filter === "admin" ? user.role === "admin" : user.status === filter);
    const matchesSearch = `${user.name} ${user.email}`.toLocaleLowerCase().includes(query);
    return matchesStatus && matchesSearch;
  });
  elements.users.replaceChildren();
  for (const user of visible) {
    const row = node("tr");
    const identity = makeIdentityCell(user);
    identity.dataset.label = "Employee";
    const requested = node("td", "admin-date-cell", dateLabel(user.createdAt));
    requested.dataset.label = "Requested";
    const status = node("td");
    status.dataset.label = "Access";
    status.append(node(
      "span",
      `admin-status-pill ${user.role === "admin" ? "admin" : user.status}`,
      user.role === "admin" ? "Admin" : user.status,
    ));
    const traffic = node("td", "admin-mailbox-counts");
    traffic.dataset.label = "Mailbox activity";
    const count = node("strong", "", `${user.messageCount.toLocaleString()} messages`);
    const details = node("span", "", `${user.sentCount.toLocaleString()} sent · ${user.draftCount.toLocaleString()} drafts`);
    traffic.append(count, details);
    const actions = makeAccountActions(user);
    actions.dataset.label = "Manage";
    row.append(
      identity,
      requested,
      status,
      traffic,
      actions,
    );
    elements.users.append(row);
  }
  elements.usersEmpty.hidden = visible.length > 0;
  elements.resultCount.textContent = `Showing ${visible.length.toLocaleString()} of ${accounts.length.toLocaleString()} accounts`;
}

async function openEmployeeProfile(userId) {
  const requestId = ++employeeProfileRequest;
  activeEmployeeProfile = null;
  elements.employeeDetails.hidden = false;
  elements.employeeViewActions.hidden = true;
  elements.employeeForm.hidden = true;
  elements.employeeForm.reset();
  elements.employeeSaveStatus.textContent = "";
  elements.employeeFormError.textContent = "";
  elements.employeeName.textContent = "Loading profile…";
  elements.employeeEmail.textContent = "";
  elements.employeeStatus.textContent = "";
  elements.employeeError.textContent = "";
  elements.employeeInitial.textContent = "?";
  elements.employeeInitial.hidden = false;
  elements.employeeSticker.textContent = "";
  elements.employeeSticker.hidden = true;
  elements.employeeAvatar.classList.remove("has-avatar-photo", "has-avatar-sticker");
  elements.employeePhoto.hidden = true;
  elements.employeePhoto.removeAttribute("src");
  elements.employeePosition.textContent = "—";
  elements.employeePhone.textContent = "—";
  elements.employeeLocation.textContent = "—";
  elements.employeeBio.textContent = "—";
  elements.employeeDialog.showModal();
  try {
    const { user } = await apiRequest(`/api/admin/users/${encodeURIComponent(userId)}/profile`);
    if (requestId !== employeeProfileRequest) return;
    activeEmployeeProfile = user;
    elements.employeeName.textContent = user.name;
    elements.employeeEmail.textContent = user.email;
    elements.employeeStatus.textContent = `${user.role === "admin" ? "Admin" : user.status} · Joined ${dateLabel(user.createdAt)}`;
    elements.employeePosition.textContent = user.position || "Not added yet";
    elements.employeePhone.textContent = user.phone || "Not added yet";
    elements.employeeLocation.textContent = user.location || "Not added yet";
    elements.employeeBio.textContent = user.bio || "Not added yet";
    elements.employeeInitial.textContent = user.name.trim().charAt(0).toLocaleUpperCase() || "?";
    const avatarSticker = getProfileStickerSymbol(user.avatarSticker);
    elements.employeeSticker.textContent = avatarSticker;
    elements.employeeSticker.hidden = !avatarSticker;
    elements.employeeInitial.hidden = Boolean(avatarSticker || user.profilePhoto);
    elements.employeeAvatar.classList.toggle("has-avatar-photo", Boolean(user.profilePhoto));
    elements.employeeAvatar.classList.toggle("has-avatar-sticker", Boolean(avatarSticker));
    elements.employeePhoto.hidden = !user.profilePhoto;
    if (user.profilePhoto) elements.employeePhoto.src = user.profilePhoto;
    elements.employeeViewActions.hidden = false;
  } catch (error) {
    if (requestId !== employeeProfileRequest) return;
    if (!handleAdminError(error, { redirectForbidden: true })) {
      console.error("Could not load employee profile.", error);
      elements.employeeError.textContent = error.message || "The employee profile could not be loaded.";
    }
  }
}

function startEmployeeProfileEdit() {
  if (!activeEmployeeProfile) return;
  const form = elements.employeeForm;
  form.elements.name.value = activeEmployeeProfile.name;
  form.elements.position.value = activeEmployeeProfile.position || "";
  form.elements.phone.value = activeEmployeeProfile.phone || "";
  form.elements.location.value = activeEmployeeProfile.location || "";
  form.elements.bio.value = activeEmployeeProfile.bio || "";
  form.elements.avatarSticker.value = activeEmployeeProfile.avatarSticker || "";
  renderAdminStickerPicker(activeEmployeeProfile.avatarSticker || "");
  form.elements.password.value = "";
  elements.employeeFormError.textContent = "";
  elements.employeeSaveStatus.textContent = "";
  elements.employeeDetails.hidden = true;
  elements.employeeViewActions.hidden = true;
  form.hidden = false;
  form.elements.name.focus();
}

function renderAdminStickerPicker(selectedSticker) {
  const picker = document.querySelector("[data-admin-sticker-picker]");
  const options = [{ id: "", label: "No sticker", symbol: "×" }, ...PROFILE_STICKERS];
  picker.replaceChildren();
  for (const sticker of options) {
    const button = node("button", "profile-sticker-option", sticker.symbol);
    button.type = "button";
    button.dataset.stickerId = sticker.id;
    button.title = sticker.label;
    button.setAttribute("aria-label", sticker.label);
    button.setAttribute("aria-pressed", String(selectedSticker === sticker.id));
    button.addEventListener("click", () => {
      elements.employeeForm.elements.avatarSticker.value = sticker.id;
      renderAdminStickerPicker(sticker.id);
    });
    picker.append(button);
  }
}

function cancelEmployeeProfileEdit() {
  elements.employeeForm.reset();
  elements.employeeForm.hidden = true;
  elements.employeeFormError.textContent = "";
  elements.employeeDetails.hidden = false;
  elements.employeeViewActions.hidden = false;
}

function renderManagedEmployeeProfile(user) {
  activeEmployeeProfile = user;
  elements.employeeName.textContent = user.name;
  elements.employeeEmail.textContent = user.email;
  elements.employeeStatus.textContent = `${user.role === "admin" ? "Admin" : user.status} · Joined ${dateLabel(user.createdAt)}`;
  elements.employeePosition.textContent = user.position || "Not added yet";
  elements.employeePhone.textContent = user.phone || "Not added yet";
  elements.employeeLocation.textContent = user.location || "Not added yet";
  elements.employeeBio.textContent = user.bio || "Not added yet";
  elements.employeeInitial.textContent = user.name.trim().charAt(0).toLocaleUpperCase() || "?";
  const avatarSticker = getProfileStickerSymbol(user.avatarSticker);
  elements.employeeSticker.textContent = avatarSticker;
  elements.employeeSticker.hidden = !avatarSticker;
  elements.employeeInitial.hidden = Boolean(avatarSticker || user.profilePhoto);
  elements.employeeAvatar.classList.toggle("has-avatar-photo", Boolean(user.profilePhoto));
  elements.employeeAvatar.classList.toggle("has-avatar-sticker", Boolean(avatarSticker));
  elements.employeePhoto.hidden = !user.profilePhoto;
  if (user.profilePhoto) elements.employeePhoto.src = user.profilePhoto;

  const directoryUser = accounts.find((item) => item.id === user.id);
  if (directoryUser) {
    directoryUser.name = user.name;
    directoryUser.position = user.position;
    directoryUser.avatarSticker = user.avatarSticker;
    directoryUser.profilePhoto = user.profilePhoto;
    renderUsers();
  }
}

function renderAuditLog(entries) {
  elements.auditLog.replaceChildren();
  if (entries.length === 0) {
    elements.auditLog.append(node("li", "admin-audit-empty", "Admin actions will appear here."));
    return;
  }
  const actionLabels = {
    admin_promoted: "promoted an admin",
    profile_updated: "updated an employee profile",
    smtp_settings_updated: "updated SMTP email settings",
    database_settings_updated: "updated future Supabase database settings",
    mail_message_sent: "sent an internal mail message",
    mail_message_updated: "edited an internal mail message",
    mail_message_deleted: "deleted an internal mail message",
  };
  for (const entry of entries) {
    const item = node("li", "admin-audit-entry");
    const icon = node("span", "admin-audit-icon", entry.status === "approved" ? "✓" : "•");
    const copy = node("div", "admin-audit-copy");
    const action = actionLabels[entry.action] ?? `${entry.previousStatus} → ${entry.status}`;
    copy.append(
      node("strong", "", `${entry.actorName} ${action}`),
      node("span", "", `${entry.targetName}${entry.targetEmail ? ` · ${entry.targetEmail}` : ""}`),
    );
    if (entry.reason) copy.append(node("small", "", `Note: ${entry.reason}`));
    item.append(icon, copy, node("time", "", dateLabel(entry.createdAt)));
    elements.auditLog.append(item);
  }
}

function updateAdminMailRecipients() {
  if (!currentAdminId) {
    const loadingOption = node("option", "", "Loading approved accounts…");
    loadingOption.value = "";
    elements.mailRecipient.replaceChildren(loadingOption);
    elements.mailRecipient.disabled = true;
    return;
  }
  const selectedEmail = elements.mailRecipient.value;
  const recipients = accounts.filter((user) =>
    (user.status === "approved" || user.role === "admin") && user.id !== currentAdminId,
  );
  const placeholder = node("option", "", "Choose an approved account");
  placeholder.value = "";
  elements.mailRecipient.replaceChildren(placeholder);
  for (const user of recipients) {
    const option = node("option", "", `${user.name} <${user.email}>`);
    option.value = user.email;
    elements.mailRecipient.append(option);
  }
  elements.mailRecipient.disabled = recipients.length === 0;
  if (recipients.some((user) => user.email === selectedEmail)) {
    elements.mailRecipient.value = selectedEmail;
  }
}

function updateAdminMailboxOwners() {
  const selectedOwnerId = elements.mailOwner.value;
  const ownMailboxOption = node("option", "", "Your admin mailbox");
  ownMailboxOption.value = "";
  elements.mailOwner.replaceChildren(ownMailboxOption);
  for (const user of accounts.filter((item) =>
    item.id !== currentAdminId && (item.messageCount > 0 || item.status === "approved" || item.role === "admin"),
  )) {
    const option = node("option", "", `${user.name} · ${user.email} (${user.messageCount} messages)`);
    option.value = user.id;
    elements.mailOwner.append(option);
  }
  if (accounts.some((user) => user.id === selectedOwnerId)) {
    elements.mailOwner.value = selectedOwnerId;
  }
}

function adminAttachmentUrl(message, attachment) {
  const base = adminMailboxOwnerId === currentAdminId
    ? `/api/mailbox/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachment.id)}`
    : `/api/admin/users/${encodeURIComponent(adminMailboxOwnerId)}/mailbox/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachment.id)}`;
  return base;
}

function renderAdminMailDetail(message) {
  elements.mailDetail.replaceChildren();
  if (!message) {
    elements.mailDetail.append(node("p", "", "Select a message to read it."));
    return;
  }
  const heading = node("h3", "", message.subject || "(no subject)");
  const sender = node("p", "admin-mail-meta", `From: ${message.sender} <${message.senderEmail}>`);
  const recipient = node("p", "admin-mail-meta", `To: ${message.recipientEmail || "—"}`);
  const date = node("time", "admin-mail-meta", dateLabel(message.createdAt));
  const body = node("div", "admin-mail-body");
  for (const paragraph of Array.isArray(message.body) ? message.body : []) {
    body.append(node("p", "", paragraph));
  }
  elements.mailDetail.append(heading, sender, recipient, date, body);
  for (const attachment of message.attachments ?? []) {
    const attachmentItem = node("div", "admin-mail-attachment");
    if (!attachment.available) {
      attachmentItem.append(node("span", "", `${attachment.name} — file unavailable (older message)`));
    } else {
      const url = adminAttachmentUrl(message, attachment);
      if (attachment.previewable) {
        const image = node("img", "admin-mail-image");
        image.src = url;
        image.alt = attachment.name;
        attachmentItem.append(image);
      }
      const link = node("a", "", `${attachment.name} · ${formatFileSize(attachment.size)}`);
      link.href = url;
      link.download = attachment.name;
      attachmentItem.append(link);
    }
    elements.mailDetail.append(attachmentItem);
  }
}

function revokeAdminComposePreviewUrls() {
  for (const attachment of adminComposeAttachments) {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    delete attachment.previewUrl;
  }
}

function renderAdminComposeAttachments() {
  revokeAdminComposePreviewUrls();
  elements.mailComposeAttachments.replaceChildren();
  for (const attachment of adminComposeAttachments) {
    const item = node("div", "admin-mail-compose-attachment");
    const file = attachment.file;
    if ((file?.type || attachment.type || "").startsWith("image/")) {
      const preview = node("img", "admin-mail-compose-preview");
      attachment.previewUrl = file
        ? URL.createObjectURL(file)
        : attachment.available && attachment.message
          ? adminAttachmentUrl(attachment.message, attachment)
          : null;
      if (attachment.previewUrl) {
        preview.src = attachment.previewUrl;
        preview.alt = "";
        item.append(preview);
      }
    }
    item.append(node("span", "", `${attachment.name} · ${formatFileSize(attachment.size)}`));
    const remove = node("button", "admin-cancel-button", "Remove");
    remove.type = "button";
    remove.dataset.mailRemoveAttachment = attachment.clientId ?? attachment.id;
    item.append(remove);
    elements.mailComposeAttachments.append(item);
  }
}

function resetAdminMailEditor() {
  editingAdminMessageId = null;
  revokeAdminComposePreviewUrls();
  adminComposeAttachments = [];
  elements.mailForm.reset();
  elements.mailFormTitle.textContent = "New message";
  elements.mailRecipientWrap.hidden = false;
  elements.mailRecipient.required = true;
  elements.mailSend.textContent = "Send internal message";
  elements.mailCancelEdit.hidden = true;
  elements.mailFiles.disabled = false;
  renderAdminComposeAttachments();
}

function beginEditAdminMessage(message) {
  editingAdminMessageId = message.id;
  adminComposeAttachments = (message.attachments ?? []).map((attachment) => ({
    ...attachment,
    message,
  }));
  elements.mailFormTitle.textContent = "Edit message";
  elements.mailRecipientWrap.hidden = true;
  elements.mailRecipient.required = false;
  elements.mailForm.elements.subject.value = message.subject;
  elements.mailForm.elements.body.value = (message.body ?? []).join("\n\n");
  elements.mailSend.textContent = "Save changes";
  elements.mailCancelEdit.hidden = false;
  renderAdminComposeAttachments();
  elements.mailForm.elements.subject.focus();
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Could not read the selected attachment."));
        return;
      }
      const separator = reader.result.indexOf(",");
      if (separator < 0) {
        reject(new Error("Could not encode the selected attachment."));
        return;
      }
      resolve(reader.result.slice(separator + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the selected attachment."));
    reader.readAsDataURL(file);
  });
}

async function adminAttachmentPayloads() {
  return Promise.all(adminComposeAttachments.map(async (attachment) => {
    if (!attachment.file) {
      return {
        id: attachment.id,
        name: attachment.name,
        type: attachment.type,
        size: attachment.size,
      };
    }
    return {
      name: attachment.file.name,
      type: attachment.file.type || "application/octet-stream",
      size: attachment.file.size,
      content: await readFileAsBase64(attachment.file),
    };
  }));
}

function adminMailboxPath(ownerId = adminMailboxOwnerId) {
  return ownerId === currentAdminId
    ? "/api/mailbox"
    : `/api/admin/users/${encodeURIComponent(ownerId)}/mailbox`;
}

async function loadAdminMailbox() {
  elements.mailRefresh.disabled = true;
  try {
    const { user } = await apiRequest("/api/auth/me");
    currentAdminId = user.id;
    updateAdminMailRecipients();
    updateAdminMailboxOwners();
    const selectedOwnerId = elements.mailOwner.value || currentAdminId;
    adminMailboxOwnerId = selectedOwnerId;
    const { mailbox } = await apiRequest(adminMailboxPath(selectedOwnerId));
    adminMailbox = mailbox;
    renderAdminMailbox();
  } catch (error) {
    if (!handleAdminError(error, { redirectForbidden: true })) {
      console.error("Could not load the admin mailbox.", error);
      elements.mailStatus.textContent = error.message || "The admin mailbox could not be loaded.";
      elements.mailCount.textContent = "Unavailable";
    }
  } finally {
    elements.mailRefresh.disabled = false;
  }
}

function renderAdminMailbox() {
  if (!adminMailbox) return;
  const messages = adminMailbox.messages
    .filter((message) => adminMailFolder === "all" || message.folder === adminMailFolder)
    .sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));
  elements.mailCount.textContent = `${messages.length} ${messages.length === 1 ? "message" : "messages"}`;
  elements.mailFolders.forEach((button) => {
    const active = button.dataset.mailFolder === adminMailFolder;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  elements.mailList.replaceChildren();
  if (messages.length === 0) {
    elements.mailList.append(node("p", "admin-mail-empty", `No messages in ${adminMailFolder}.`));
  } else {
    for (const message of messages) {
      const row = node("div", "admin-mail-row");
      const item = node("button", `admin-mail-item${message.unread ? " is-unread" : ""}`);
      item.type = "button";
      item.dataset.mailMessageId = message.id;
      const otherParty = message.folder === "sent"
        ? `To ${message.recipientEmail}`
        : message.sender;
      item.append(
        node("strong", "", otherParty),
        node("span", "", message.subject || "(no subject)"),
        node("small", "", message.preview || ""),
      );
      const menu = node("details", "admin-mail-menu");
      const toggle = node("summary", "", "⋯");
      toggle.setAttribute("aria-label", `More options for ${message.subject || "message"}`);
      const edit = node("button", "", "Edit");
      edit.type = "button";
      edit.dataset.mailEdit = message.id;
      const remove = node("button", "is-danger", "Delete");
      remove.type = "button";
      remove.dataset.mailDelete = message.id;
      menu.append(toggle, edit, remove);
      row.append(item, menu);
      elements.mailList.append(row);
    }
  }
  const selected = messages.find((message) => message.id === selectedAdminMessageId);
  if (!selected) selectedAdminMessageId = null;
  renderAdminMailDetail(selected);
}

elements.mailFolders.forEach((button) => {
  button.addEventListener("click", () => {
    adminMailFolder = button.dataset.mailFolder;
    selectedAdminMessageId = null;
    resetAdminMailEditor();
    renderAdminMailbox();
  });
});

elements.mailOwner.addEventListener("change", () => {
  adminMailboxOwnerId = elements.mailOwner.value || currentAdminId;
  selectedAdminMessageId = null;
  resetAdminMailEditor();
  void loadAdminMailbox();
});

async function deleteAdminManagedMessage(messageId, ownerId) {
  try {
    await apiRequest(
      `/api/admin/users/${encodeURIComponent(ownerId)}/mailbox/messages/${encodeURIComponent(messageId)}`,
      { method: "DELETE", body: {} },
    );
    selectedAdminMessageId = null;
    resetAdminMailEditor();
    elements.mailStatus.textContent = "Message deleted from all mailbox copies.";
    await loadAdminMailbox();
    await loadDashboard();
    return true;
  } catch (error) {
    if (!handleAdminError(error)) {
      console.error("Could not delete the admin-managed message.", error);
      const message = error.message || "Message could not be deleted.";
      elements.mailStatus.textContent = message;
      elements.mailDeleteError.textContent = message;
    }
    return false;
  }
}

elements.mailDeleteDialog.addEventListener("close", () => {
  pendingAdminDelete = null;
});

document.querySelector("[data-mail-delete-cancel]").addEventListener("click", () => {
  elements.mailDeleteDialog.close();
});

elements.mailDeleteDialog.querySelector("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pendingAdminDelete) return;
  elements.mailDeleteConfirm.disabled = true;
  try {
    if (await deleteAdminManagedMessage(
      pendingAdminDelete.messageId,
      pendingAdminDelete.ownerId,
    )) {
      elements.mailDeleteDialog.close();
    }
  } finally {
    elements.mailDeleteConfirm.disabled = false;
  }
});

elements.mailList.addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-mail-edit]");
  const deleteButton = event.target.closest("[data-mail-delete]");
  if (editButton || deleteButton) {
    const messageId = editButton?.dataset.mailEdit || deleteButton.dataset.mailDelete;
    const message = adminMailbox?.messages.find((item) => item.id === messageId);
    if (!message) return;
    event.preventDefault();
    event.stopPropagation();
    if (editButton) beginEditAdminMessage(message);
    else {
      pendingAdminDelete = {
        messageId: message.id,
        ownerId: adminMailboxOwnerId,
      };
      elements.mailDeleteError.textContent = "";
      elements.mailDeleteCopy.textContent =
        `Permanently delete "${message.subject || "(no subject)"}" from all mailboxes? This cannot be undone.`;
      elements.mailDeleteDialog.showModal();
      elements.mailDeleteConfirm.focus();
    }
    const menu = (editButton ?? deleteButton).closest("details");
    if (menu) menu.open = false;
    return;
  }

  const button = event.target.closest("[data-mail-message-id]");
  if (!button || !adminMailbox) return;
  const message = adminMailbox.messages.find((item) => item.id === button.dataset.mailMessageId);
  if (!message) return;
  selectedAdminMessageId = message.id;
  renderAdminMailbox();
  if (!message.unread || message.folder !== "inbox") return;
  const path = adminMailboxOwnerId === currentAdminId
    ? `/api/mailbox/messages/${encodeURIComponent(message.id)}/read`
    : `/api/admin/users/${encodeURIComponent(adminMailboxOwnerId)}/mailbox/messages/${encodeURIComponent(message.id)}/read`;
  try {
    await apiRequest(path, {
      method: "PATCH",
      body: {},
    });
    message.unread = false;
    renderAdminMailbox();
  } catch (error) {
    if (!handleAdminError(error)) {
      console.error("Could not mark the admin message as read.", error);
      elements.mailStatus.textContent = error.message || "The message could not be marked as read.";
    }
  }
});

elements.mailFiles.addEventListener("change", () => {
  const selectedFiles = [...elements.mailFiles.files];
  elements.mailFiles.value = "";
  elements.mailStatus.textContent = selectedFiles.length
    ? `Adding ${selectedFiles.length} attachment${selectedFiles.length === 1 ? "" : "s"}…`
    : "";
  let currentSize = adminComposeAttachments.reduce((total, attachment) =>
    total + attachment.size, 0);
  const fileErrors = [];
  for (const file of selectedFiles) {
    if (file.size > 5 * 1024 * 1024) {
      fileErrors.push(`${file.name} exceeds the 5 MB per-file limit.`);
      continue;
    }
    if (currentSize + file.size > 15 * 1024 * 1024) {
      fileErrors.push("Attachments are limited to 15 MB per message.");
      continue;
    }
    if (adminComposeAttachments.length >= 30) {
      fileErrors.push("A message can have up to 30 attachments.");
      break;
    }
    adminComposeAttachments.push({
      clientId: globalThis.crypto?.randomUUID?.() ??
        `attachment-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      file,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
    });
    currentSize += file.size;
  }
  renderAdminComposeAttachments();
  const selectedCount = adminComposeAttachments.length;
  const selectionStatus = `${selectedCount} attachment${selectedCount === 1 ? "" : "s"} ready.`;
  elements.mailStatus.textContent = [...fileErrors, selectionStatus].join(" ");
});

elements.mailComposeAttachments.addEventListener("click", (event) => {
  const button = event.target.closest("[data-mail-remove-attachment]");
  if (!button) return;
  adminComposeAttachments = adminComposeAttachments.filter((attachment) =>
    (attachment.clientId ?? attachment.id) !== button.dataset.mailRemoveAttachment,
  );
  renderAdminComposeAttachments();
});

elements.mailCancelEdit.addEventListener("click", resetAdminMailEditor);
elements.mailRefresh.addEventListener("click", () => void loadAdminMailbox());

elements.mailForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!elements.mailForm.reportValidity()) return;
  const formData = new FormData(elements.mailForm);
  elements.mailSend.disabled = true;
  elements.mailStatus.textContent = editingAdminMessageId
    ? "Saving message changes…"
    : "Sending internal message…";
  try {
    const attachments = await adminAttachmentPayloads();
    if (editingAdminMessageId) {
      await apiRequest(
        `/api/admin/users/${encodeURIComponent(adminMailboxOwnerId)}/mailbox/messages/${encodeURIComponent(editingAdminMessageId)}`,
        {
          method: "PATCH",
          body: {
            message: {
              subject: formData.get("subject"),
              body: formData.get("body"),
              attachments,
            },
          },
        },
      );
      selectedAdminMessageId = editingAdminMessageId;
      resetAdminMailEditor();
      elements.mailStatus.textContent = "Message updated across its mailbox copies.";
      await loadAdminMailbox();
      await loadDashboard();
    } else {
      const { message } = await apiRequest("/api/mailbox/send", {
        method: "POST",
        body: {
          message: {
          recipientEmail: formData.get("recipientEmail"),
          subject: formData.get("subject"),
          body: formData.get("body"),
            attachments,
          },
        },
      });
      resetAdminMailEditor();
      elements.mailStatus.textContent = `Message delivered to ${message.recipientEmail}.`;
      adminMailboxOwnerId = currentAdminId;
      elements.mailOwner.value = "";
      adminMailFolder = "sent";
      selectedAdminMessageId = message.id;
      await loadAdminMailbox();
      await loadDashboard();
    }
  } catch (error) {
    if (!handleAdminError(error)) {
      console.error("Could not send admin mail.", error);
      elements.mailStatus.textContent = error.message || "The message could not be sent.";
    }
  } finally {
    elements.mailSend.disabled = false;
  }
});

function smtpFormValues() {
  const formData = new FormData(elements.smtpForm);
  return {
    host: formData.get("host"),
    port: formData.get("port"),
    secure: formData.get("secure") === "on",
    from: formData.get("from"),
    username: formData.get("username"),
    password: formData.get("password"),
    passwordConfirmation: formData.get("passwordConfirmation"),
  };
}

async function loadSmtpSettings() {
  try {
    const { settings } = await apiRequest("/api/admin/settings/smtp");
    elements.smtpForm.elements.host.value = settings.host;
    elements.smtpForm.elements.port.value = settings.port;
    elements.smtpForm.elements.secure.checked = settings.secure;
    elements.smtpForm.elements.from.value = settings.from;
    elements.smtpForm.elements.username.value = settings.username;
    elements.smtpForm.elements.password.placeholder = settings.passwordConfigured
      ? "Saved; leave blank to keep current password"
      : "Enter password if SMTP authentication is enabled";
    elements.smtpState.textContent = settings.configured
      ? `Configured via ${settings.source}`
      : "Not configured";
    elements.smtpState.classList.toggle("is-configured", settings.configured);
    if (!settings.encryptionKeyConfigured) {
      elements.smtpStatus.textContent =
        "Set APP_SETTINGS_ENCRYPTION_KEY on the server before saving settings here.";
    }
  } catch (error) {
    if (!handleAdminError(error, { redirectForbidden: true })) {
      console.error("Could not load SMTP settings.", error);
      elements.smtpStatus.textContent = error.message || "SMTP settings could not be loaded.";
    }
  }
}

function setSmtpBusy(isBusy) {
  elements.smtpSave.disabled = isBusy;
  elements.smtpTest.disabled = isBusy;
}

elements.smtpForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!elements.smtpForm.reportValidity()) return;

  setSmtpBusy(true);
  elements.smtpStatus.textContent = "Saving SMTP settings…";
  try {
    const { settings, message } = await apiRequest("/api/admin/settings/smtp", {
      method: "PUT",
      body: smtpFormValues(),
    });
    elements.smtpStatus.textContent = message;
    elements.smtpState.textContent = `Configured via ${settings.source}`;
    elements.smtpState.classList.add("is-configured");
    elements.smtpForm.elements.password.value = "";
    elements.smtpForm.elements.passwordConfirmation.value = "";
    elements.smtpForm.elements.password.placeholder = settings.passwordConfigured
      ? "Saved; leave blank to keep current password"
      : "Enter password if SMTP authentication is enabled";
  } catch (error) {
    if (!handleAdminError(error)) {
      console.error("Could not save SMTP settings.", error);
      elements.smtpStatus.textContent = error.message || "SMTP settings could not be saved.";
    }
  } finally {
    setSmtpBusy(false);
  }
});

elements.smtpTest.addEventListener("click", async () => {
  if (!elements.smtpForm.reportValidity()) return;

  setSmtpBusy(true);
  elements.smtpStatus.textContent = "Sending a test email to your admin address…";
  try {
    const result = await apiRequest("/api/admin/settings/smtp/test", {
      method: "POST",
      body: smtpFormValues(),
    });
    elements.smtpStatus.textContent = result.message;
  } catch (error) {
    if (!handleAdminError(error)) {
      console.error("SMTP test email failed.", error);
      elements.smtpStatus.textContent = error.message || "The SMTP test email could not be sent.";
    }
  } finally {
    setSmtpBusy(false);
  }
});

function databaseFormValues() {
  const formData = new FormData(elements.databaseForm);
  return {
    projectUrl: formData.get("projectUrl"),
    apiKey: formData.get("apiKey"),
    passwordConfirmation: formData.get("passwordConfirmation"),
  };
}

async function loadSupabaseSettings() {
  try {
    const { settings } = await apiRequest("/api/admin/settings/database/supabase");
    elements.databaseForm.elements.projectUrl.value = settings.projectUrl;
    elements.databaseForm.elements.apiKey.placeholder = settings.apiKeyConfigured
      ? "Saved; leave blank to keep current API key"
      : "Enter project API key; leave blank to keep saved key";
    elements.databaseState.textContent = settings.configured
      ? "Future connection configured"
      : "Not configured";
    elements.databaseState.classList.toggle("is-configured", settings.configured);
    elements.databaseState.classList.add("is-prepared");
    document.querySelector("[data-active-database]").textContent =
      settings.activeDatabase.toUpperCase();
  } catch (error) {
    if (!handleAdminError(error, { redirectForbidden: true })) {
      console.error("Could not load Supabase settings.", error);
      elements.databaseStatus.textContent = error.message || "Database settings could not be loaded.";
    }
  }
}

function setDatabaseBusy(isBusy) {
  elements.databaseSave.disabled = isBusy;
  elements.databaseTest.disabled = isBusy;
}

elements.databaseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!elements.databaseForm.reportValidity()) return;

  setDatabaseBusy(true);
  elements.databaseStatus.textContent = "Saving future Supabase connection…";
  try {
    const { settings, message } = await apiRequest("/api/admin/settings/database/supabase", {
      method: "PUT",
      body: databaseFormValues(),
    });
    elements.databaseStatus.textContent = message;
    elements.databaseState.textContent = "Future connection configured";
    elements.databaseState.classList.add("is-configured", "is-prepared");
    document.querySelector("[data-active-database]").textContent =
      settings.activeDatabase.toUpperCase();
    elements.databaseForm.elements.apiKey.value = "";
    elements.databaseForm.elements.apiKey.placeholder = "Saved; leave blank to keep current API key";
    elements.databaseForm.elements.passwordConfirmation.value = "";
  } catch (error) {
    if (!handleAdminError(error)) {
      console.error("Could not save Supabase settings.", error);
      elements.databaseStatus.textContent = error.message || "Database settings could not be saved.";
    }
  } finally {
    setDatabaseBusy(false);
  }
});

elements.databaseTest.addEventListener("click", async () => {
  if (!elements.databaseForm.reportValidity()) return;

  setDatabaseBusy(true);
  elements.databaseStatus.textContent = "Testing Supabase project connectivity…";
  try {
    const result = await apiRequest("/api/admin/settings/database/supabase/test", {
      method: "POST",
      body: databaseFormValues(),
    });
    elements.databaseStatus.textContent = result.message;
  } catch (error) {
    if (!handleAdminError(error)) {
      console.error("Supabase connection test failed.", error);
      elements.databaseStatus.textContent = error.message || "The Supabase connection test failed.";
    }
  } finally {
    setDatabaseBusy(false);
  }
});

async function loadDashboard({ announce = false } = {}) {
  if (loadInProgress) return;
  loadInProgress = true;
  elements.refresh.disabled = true;
  try {
    const overview = await apiRequest("/api/admin/overview");
    setStats(overview.stats);
    accounts = overview.users;
    updateAdminMailRecipients();
    updateAdminMailboxOwners();
    renderNotifications(overview.notifications);
    renderUsers();
    renderAuditLog(overview.auditLog ?? []);
    elements.lastUpdated.textContent = `Updated ${new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date())}`;
    if (announce) elements.status.textContent = "Dashboard refreshed.";
  } catch (error) {
    if (!handleAdminError(error, { redirectForbidden: true })) {
      console.error("Could not load admin overview.", error);
      elements.status.textContent = error.message || "The admin dashboard could not be loaded.";
    }
  } finally {
    loadInProgress = false;
    elements.refresh.disabled = false;
  }
}

function openConfirmation(userId, status) {
  const user = accounts.find((item) => item.id === userId);
  if (!user || pendingChanges.has(userId)) return;
  selectedAction = { userId, status, name: user.name, email: user.email };
  const labels = {
    approved: ["Approve employee access?", "Confirm this employee's BeOneOfUs employment before granting access."],
    rejected: ["Reject this access request?", "The employee will not be able to sign in. Add a reason for the audit record."],
    suspended: ["Suspend this account?", "This immediately revokes the employee's active sessions. Add a reason for the audit record."],
  };
  const [title, description] = labels[status];
  elements.confirmTitle.textContent = title;
  elements.confirmCopy.textContent = `${description} Account: ${user.name} (${user.email}).`;
  elements.reasonWrap.hidden = !["rejected", "suspended"].includes(status);
  elements.reason.required = !elements.reasonWrap.hidden;
  elements.reason.value = "";
  elements.confirmForm.elements.password.value = "";
  elements.confirmError.textContent = "";
  elements.confirmSubmit.textContent = status === "approved" ? "Approve access" :
    status === "suspended" ? "Suspend account" : "Reject request";
  elements.confirmSubmit.className = `admin-confirm-button ${status === "approved" ? "approve" : "danger"}`;
  elements.dialog.showModal();
  elements.confirmForm.elements.password.focus();
}

elements.refresh.addEventListener("click", () => {
  elements.status.textContent = "Refreshing dashboard…";
  void loadDashboard({ announce: true });
});

elements.statusFilter.addEventListener("change", renderUsers);
elements.search.addEventListener("input", renderUsers);

for (const list of [elements.users, elements.notifications]) {
  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-user-id][data-status]");
    if (button) openConfirmation(button.dataset.userId, button.dataset.status);
  });
}

elements.users.addEventListener("click", (event) => {
  const button = event.target.closest("[data-profile-user-id]");
  if (button) void openEmployeeProfile(button.dataset.profileUserId);
});

document.querySelector("[data-close-employee]").addEventListener("click", () => {
  employeeProfileRequest += 1;
  elements.employeeDialog.close();
});

elements.employeeEditButton.addEventListener("click", startEmployeeProfileEdit);
document.querySelector("[data-cancel-employee-edit]").addEventListener("click", cancelEmployeeProfileEdit);

elements.employeeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeEmployeeProfile || !elements.employeeForm.reportValidity()) return;
  const formData = new FormData(elements.employeeForm);
  elements.employeeSave.disabled = true;
  elements.employeeFormError.textContent = "";
  try {
    const { user } = await apiRequest(
      `/api/admin/users/${encodeURIComponent(activeEmployeeProfile.id)}/profile`,
      {
        method: "PATCH",
        body: {
          name: formData.get("name"),
          email: activeEmployeeProfile.email,
          position: formData.get("position"),
          avatarSticker: formData.get("avatarSticker"),
          phone: formData.get("phone"),
          location: formData.get("location"),
          bio: formData.get("bio"),
          password: formData.get("password"),
        },
      },
    );
    renderManagedEmployeeProfile(user);
    elements.employeeForm.reset();
    elements.employeeForm.hidden = true;
    elements.employeeDetails.hidden = false;
    elements.employeeViewActions.hidden = false;
    elements.employeeSaveStatus.textContent = "Profile updated.";
    await loadDashboard();
  } catch (error) {
    if (!handleAdminError(error)) {
      console.error("Could not update employee profile.", error);
      elements.employeeFormError.textContent = error.message || "The employee profile could not be updated.";
    }
  } finally {
    elements.employeeSave.disabled = false;
  }
});

elements.employeeDialog.addEventListener("close", () => {
  employeeProfileRequest += 1;
  activeEmployeeProfile = null;
  elements.employeeForm.reset();
});

document.querySelector("[data-cancel-confirm]").addEventListener("click", () => {
  elements.dialog.close();
});

elements.confirmForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedAction || !elements.confirmForm.reportValidity()) return;
  const { userId, status } = selectedAction;
  const formData = new FormData(elements.confirmForm);
  const password = formData.get("password");
  const reason = formData.get("reason");
  elements.confirmSubmit.disabled = true;
  elements.confirmError.textContent = "";
  try {
    await apiRequest(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
      method: "PATCH",
      body: { status, password, reason },
    });
    pendingChanges.set(userId, true);
    elements.dialog.close();
    elements.status.textContent = "Account access updated and recorded.";
    await loadDashboard();
  } catch (error) {
    if (handleAdminError(error)) return;
    console.error("Could not update account access.", error);
    elements.confirmError.textContent = error.message || "Account access could not be updated.";
  } finally {
    elements.confirmSubmit.disabled = false;
    pendingChanges.delete(userId);
    renderUsers();
  }
});

document.querySelector("[data-signout]").addEventListener("click", async () => {
  try {
    await apiRequest("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  } catch (error) {
    console.error("Could not sign out.", error);
    elements.status.textContent = error.message || "Could not sign out. Please try again.";
  }
});

void loadDashboard();
void loadAdminMailbox();
void loadSmtpSettings();
void loadSupabaseSettings();
window.setInterval(() => void loadDashboard(), 30_000);
