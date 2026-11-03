import { createId } from "./mailbox-data.js";
import { apiRequest, redirectToLoginIfUnauthorized } from "./api-client.js";
import {
  readAttachment,
  removeAttachment,
  saveAttachment,
} from "./attachment-store.js";
import {
  createMessageRow,
  renderEmptyDetail,
  renderEmptyList,
  renderLabelLink,
  renderMessageDetail,
} from "./inbox-components.js";
import { getProfileStickerSymbol } from "./profile-stickers.js";
import { updateFaviconNotifications } from "./favicon-notifications.js";

const elements = {
  list: document.querySelector("[data-message-list]"),
  detail: document.querySelector("[data-message-detail]"),
  search: document.querySelector("#mail-search"),
  selectAll: document.querySelector(".select-all input"),
  title: document.querySelector("[data-folder-title]"),
  messageCount: document.querySelector("[data-message-count]"),
  inboxCount: document.querySelector('[data-count="inbox"]'),
  draftsCount: document.querySelector('[data-count="drafts"]'),
  customLabels: document.querySelector(".custom-labels"),
  composeDialog: document.querySelector("[data-compose-dialog]"),
  composeForm: document.querySelector("[data-compose-form]"),
  composeTitle: document.querySelector("[data-compose-title]"),
  composeSend: document.querySelector("[data-compose-send]"),
  discardDraft: document.querySelector("[data-action='discard-draft']"),
  draftStatus: document.querySelector("[data-draft-status]"),
  composeAttachments: document.querySelector("[data-compose-attachments]"),
  fileInput: document.querySelector("[data-file-input]"),
  photoInput: document.querySelector("[data-photo-input]"),
  snippetSelect: document.querySelector("[data-snippet-select]"),
  linkDialog: document.querySelector("[data-link-dialog]"),
  linkForm: document.querySelector("[data-link-form]"),
  helpDialog: document.querySelector("[data-help-dialog]"),
  labelDialog: document.querySelector("[data-label-dialog]"),
  labelForm: document.querySelector("[data-label-form]"),
  labelSelect: document.querySelector("[data-label-select]"),
  newLabelInput: document.querySelector("#new-label-name"),
  deleteDialog: document.querySelector("[data-delete-dialog]"),
  deleteDescription: document.querySelector("[data-delete-description]"),
  toast: document.querySelector("[data-toast]"),
  profileLink: document.querySelector("[data-profile-link]"),
  profileName: document.querySelector("[data-profile-name]"),
  profileAvatar: document.querySelector("[data-profile-avatar]"),
  profileAvatarInitial: document.querySelector("[data-profile-initial]"),
  profilePhoto: document.querySelector("[data-profile-photo]"),
  profileSticker: document.querySelector("[data-profile-sticker]"),
  profilePosition: document.querySelector("[data-profile-position]"),
  adminLink: document.querySelector("[data-admin-link]"),
};

const folderTitles = {
  inbox: "Your inbox",
  starred: "Starred",
  snoozed: "Snoozed",
  sent: "Sent",
  drafts: "Drafts",
  archive: "Archive",
  spam: "Spam",
  trash: "Trash",
};

const snippets = {
  hello: "Hi there,\n\nI hope your week is going well.",
  thanks: "Thank you so much — I really appreciate it!",
  "follow-up": "Hi there,\n\nJust checking in to see if you had a chance to take a look. No rush — let me know if I can help.",
  "sign-off": () => `Warmly,\n${currentUser.name}`,
};

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_COMPOSE_SIZE = 15 * 1024 * 1024;

let mailbox;
let currentUser;
let mailboxSaveQueue = Promise.resolve();
let mailboxRevision = 0;
let currentFolder = "inbox";
let currentCategory = "primary";
let selectedMessageId = null;
let selectedIds = new Set();
let composeDraftId = null;
let editingSentMessageId = null;
let editingSentMessageAttachments = [];
let pendingLabelIds = [];
let pendingDeleteIds = [];
let composeAttachments = [];
let messageAttachmentObjectUrls = [];
let composeAttachmentObjectUrls = [];
let composeAttachmentRenderId = 0;
let savedLinkSelection = { start: 0, end: 0 };
let toastTimer;
let draftTimer;

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 3200);
}

function persist(successMessage) {
  const snapshot = structuredClone(mailbox);
  const revision = ++mailboxRevision;
  mailboxSaveQueue = mailboxSaveQueue.catch(() => {}).then(async () => {
    try {
      await apiRequest("/api/mailbox", { method: "PUT", body: { mailbox: snapshot } });
      if (revision === mailboxRevision) {
        if (elements.composeDialog.open && elements.draftStatus.textContent === "Saving…") {
          elements.draftStatus.textContent = "Draft saved";
        }
        if (successMessage) showToast(successMessage);
      }
    } catch (error) {
      if (redirectToLoginIfUnauthorized(error)) return;
      console.error("Could not save the mailbox to the server.", error);
      if (revision === mailboxRevision) {
        if (elements.composeDialog.open) elements.draftStatus.textContent = "Could not save draft";
        showToast(error.message || "Your mailbox changes could not be saved.");
      }
    }
  });
  return true;
}

function updateMailbox(change, successMessage) {
  const previous = structuredClone(mailbox);
  change();
  if (!persist(successMessage)) {
    mailbox = previous;
    render();
    return false;
  }
  render();
  return true;
}

function currentMessage() {
  return mailbox.messages.find((message) => message.id === selectedMessageId);
}

function getVisibleMessages() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  const drafts = mailbox.drafts.map((draft) => ({
      id: draft.id,
      sender: "Draft",
      senderEmail: "",
      subject: draft.subject || "(no subject)",
      preview: draft.body || "No message content",
      body: [],
      color: "lilac",
      labels: [],
      unread: true,
      starred: false,
      folder: "drafts",
      createdAt: draft.updatedAt,
      reactions: [],
      isDraft: true,
    }));

  let messages;
  if (query) {
    messages = mailbox.messages.filter((message) => !["trash", "spam"].includes(message.folder));
    messages.push(...drafts);
  } else if (currentFolder === "drafts") {
    return drafts.sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));
  } else if (currentFolder.startsWith("label:")) {
    messages = mailbox.messages.filter(
      (message) => message.folder !== "trash" && message.labels.includes(currentFolder.slice(6)),
    );
  } else if (currentFolder === "starred") {
    messages = mailbox.messages.filter((message) => message.starred && message.folder !== "trash");
  } else {
    messages = mailbox.messages.filter((message) => message.folder === currentFolder);
  }

  if (!query && currentFolder === "inbox") {
    messages = messages.filter((message) => message.category === currentCategory);
  }

  if (query) {
    messages = messages.filter((message) =>
      [message.sender, message.senderEmail, message.subject, message.preview, ...message.body]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query),
    );
  }

  return messages.sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));
}

function updateCounts() {
  const unreadInbox = mailbox.messages.filter(
    (message) => message.folder === "inbox" && message.unread,
  ).length;
  elements.inboxCount.textContent = String(unreadInbox);
  elements.inboxCount.hidden = unreadInbox === 0;
  updateFaviconNotifications(unreadInbox);
  elements.draftsCount.textContent = String(mailbox.drafts.length);
  elements.draftsCount.hidden = mailbox.drafts.length === 0;

  const socialUnread = mailbox.messages.filter(
    (message) => message.folder === "inbox" && message.category === "social" && message.unread,
  ).length;
  const socialCount = document.querySelector('[data-category-count="social"]');
  socialCount.textContent = String(socialUnread);
  socialCount.hidden = socialUnread === 0;
}

function renderLabels() {
  const selectedLabel = currentFolder.startsWith("label:") ? currentFolder.slice(6) : null;
  elements.customLabels.replaceChildren(
    ...mailbox.labels.map((label) => renderLabelLink(label, label.name === selectedLabel)),
  );
}

function revokeAttachmentUrls() {
  for (const url of messageAttachmentObjectUrls) URL.revokeObjectURL(url);
  messageAttachmentObjectUrls = [];
}

function revokeComposeAttachmentUrls() {
  for (const url of composeAttachmentObjectUrls) URL.revokeObjectURL(url);
  composeAttachmentObjectUrls = [];
}

async function hydrateMessageAttachments(container, message) {
  for (const attachment of message.attachments ?? []) {
    try {
      if (attachment.available) {
        if (!container.isConnected || currentMessage()?.id !== message.id) return;
        const url = `/api/mailbox/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachment.id)}`;
        const item = document.createElement("div");
        item.className = "message-attachment";
        if (attachment.previewable) {
          const image = document.createElement("img");
          image.src = url;
          image.alt = attachment.name;
          item.append(image);
        }
        const link = document.createElement("a");
        link.href = url;
        link.download = attachment.name;
        link.textContent = `${attachment.name} · ${formatFileSize(attachment.size)}`;
        item.append(link);
        container.append(item);
        continue;
      }
      const blob = await readAttachment(attachment.id);
      if (!container.isConnected || currentMessage()?.id !== message.id) return;
      const url = URL.createObjectURL(blob);
      messageAttachmentObjectUrls.push(url);
      const item = document.createElement("div");
      item.className = "message-attachment";
      if (attachment.type.startsWith("image/")) {
        const image = document.createElement("img");
        image.src = url;
        image.alt = attachment.name;
        item.append(image);
      }
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.name;
      link.textContent = `${attachment.name} · ${formatFileSize(attachment.size)}`;
      item.append(link);
      container.append(item);
    } catch (error) {
      console.error(`Could not load attachment "${attachment.name}".`, error);
      if (container.isConnected) {
        const unavailable = document.createElement("span");
        unavailable.className = "attachment-unavailable";
        unavailable.textContent = `${attachment.name} is unavailable in this browser.`;
        container.append(unavailable);
      }
    }
  }
}

function formatFileSize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function renderComposeAttachments() {
  const renderId = ++composeAttachmentRenderId;
  elements.composeAttachments.replaceChildren();
  revokeComposeAttachmentUrls();
  for (const attachment of composeAttachments) {
    const item = document.createElement("div");
    item.className = `compose-attachment${attachment.type.startsWith("image/") ? " is-photo" : ""}`;
    if (attachment.type.startsWith("image/") && !attachment.serverStored) {
      try {
        const blob = await readAttachment(attachment.id);
        if (renderId !== composeAttachmentRenderId) return;
        const url = URL.createObjectURL(blob);
        composeAttachmentObjectUrls.push(url);
        const preview = document.createElement("img");
        preview.src = url;
        preview.alt = "";
        item.append(preview);
      } catch (error) {
        console.error(`Could not preview attachment "${attachment.name}".`, error);
        if (renderId === composeAttachmentRenderId) {
          showToast(error.message || `Could not preview ${attachment.name}.`);
        }
      }
    }
    if (renderId !== composeAttachmentRenderId) return;
    const details = document.createElement("span");
    details.className = "compose-attachment-details";
    details.append(
      Object.assign(document.createElement("strong"), { textContent: attachment.name }),
      Object.assign(document.createElement("small"), { textContent: formatFileSize(attachment.size) }),
    );
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.action = "remove-attachment";
    remove.dataset.attachmentId = attachment.id;
    remove.setAttribute("aria-label", `Remove ${attachment.name}`);
    remove.textContent = "×";
    item.append(details, remove);
    elements.composeAttachments.append(item);
  }
}

function render() {
  const visibleMessages = getVisibleMessages();
  const activeMessage = visibleMessages.find((message) => message.id === selectedMessageId);
  const isInbox = currentFolder === "inbox";
  elements.title.textContent = elements.search.value.trim()
    ? "Search results"
    : currentFolder.startsWith("label:")
      ? currentFolder.slice(6)
      : folderTitles[currentFolder] ?? "Your inbox";
  elements.messageCount.textContent = `${visibleMessages.length} ${visibleMessages.length === 1 ? "message" : "messages"}`;
  document.querySelector(".mail-tabs").hidden = !isInbox || Boolean(elements.search.value.trim());
  document.querySelectorAll("[data-category]").forEach((tab) => {
    const current = tab.dataset.category === currentCategory;
    tab.classList.toggle("current", current);
    tab.setAttribute("aria-selected", String(current));
  });
  document.querySelectorAll("[data-folder]").forEach((link) => {
    const selected = link.dataset.folder === currentFolder;
    link.classList.toggle("selected", selected);
    if (selected) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  const isDraftFolder = currentFolder === "drafts";
  elements.selectAll.disabled = isDraftFolder || visibleMessages.length === 0;
  for (const action of ["mark-unread", "archive-selected", "snooze-selected", "label-selected", "trash-selected"]) {
    const button = document.querySelector(`[data-action="${action}"]`);
    button.disabled = isDraftFolder;
  }
  document.querySelector('[data-action="mark-visible-read"]').disabled = isDraftFolder || visibleMessages.length === 0;

  if (visibleMessages.length === 0) {
    const description = elements.search.value.trim()
      ? "Try a different search or clear the search box."
      : currentFolder === "drafts"
        ? "Drafts you save will appear here."
        : "There are no messages here right now.";
    renderEmptyList(elements.list, "Nothing to see here", description);
  } else {
    elements.list.replaceChildren(
      ...visibleMessages.map((message) =>
        createMessageRow(message, {
          active: message.id === selectedMessageId,
          selected: selectedIds.has(message.id),
          profilePhoto: message.senderEmail === currentUser.email ? currentUser.profilePhoto : "",
          avatarSticker: message.senderEmail === currentUser.email ? currentUser.avatarSticker : "",
        }),
      ),
    );
  }

  const visibleIds = new Set(visibleMessages.map((message) => message.id));
  elements.selectAll.checked = visibleMessages.length > 0 &&
    visibleMessages.every((message) => selectedIds.has(message.id));
  elements.selectAll.indeterminate = !elements.selectAll.checked &&
    visibleMessages.some((message) => selectedIds.has(message.id));

  if (activeMessage && !activeMessage.isDraft) {
    revokeAttachmentUrls();
    const attachmentList = renderMessageDetail(elements.detail, activeMessage, {
      profilePhoto: activeMessage.senderEmail === currentUser.email ? currentUser.profilePhoto : "",
      avatarSticker: activeMessage.senderEmail === currentUser.email ? currentUser.avatarSticker : "",
      canEditSentMessage: activeMessage.folder === "sent" &&
        activeMessage.senderEmail?.toLocaleLowerCase() === currentUser.email.toLocaleLowerCase(),
    });
    if (attachmentList) hydrateMessageAttachments(attachmentList, activeMessage);
  } else if (activeMessage?.isDraft) {
    revokeAttachmentUrls();
    renderEmptyDetail(elements.detail);
    elements.detail.querySelector(".detail-empty").textContent = "Open this draft to continue writing.";
  } else {
    revokeAttachmentUrls();
    renderEmptyDetail(elements.detail);
    if (!visibleIds.has(selectedMessageId)) selectedMessageId = null;
  }

  updateCounts();
  renderLabels();
}

function openMessage(id) {
  const draft = mailbox.drafts.find((item) => item.id === id);
  if (draft) {
    openDraft(draft.id);
    return;
  }
  const message = mailbox.messages.find((item) => item.id === id);
  if (!message) return;

  selectedMessageId = id;
  selectedIds.delete(id);
  if (message.unread) {
    message.unread = false;
    if (!persist()) message.unread = true;
  }
  render();
  if (window.matchMedia("(max-width: 800px)").matches) {
    elements.detail.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  window.history.replaceState(null, "", `#message-${encodeURIComponent(id)}`);
}

function selectFolder(folder) {
  currentFolder = folder;
  selectedIds.clear();
  selectedMessageId = null;
  elements.search.value = "";
  const first = getVisibleMessages()[0];
  if (first) {
    if (first.isDraft) {
      selectedMessageId = first.id;
      render();
    }
    else openMessage(first.id);
  } else {
    render();
  }
  window.history.replaceState(null, "", `#${encodeURIComponent(folder)}`);
}

function setCategory(category) {
  currentCategory = category;
  selectedMessageId = null;
  selectedIds.clear();
  const first = getVisibleMessages()[0];
  if (first) openMessage(first.id);
  else render();
}

function getSelectedIds() {
  return [...selectedIds].filter((id) =>
    getVisibleMessages().some((message) => message.id === id && !message.isDraft),
  );
}

function moveMessages(ids, folder, success) {
  if (ids.length === 0) {
    showToast("Select at least one message first.");
    return;
  }
  const movesToTrash = folder === "trash";
  const movedCurrent = ids.includes(selectedMessageId);
  if (updateMailbox(() => {
    for (const message of mailbox.messages) {
      if (ids.includes(message.id)) message.folder = folder;
    }
    selectedIds.clear();
    if (movedCurrent) selectedMessageId = null;
  }, success)) {
    if (movedCurrent) {
      const next = getVisibleMessages()[0];
      if (next) openMessage(next.id);
    }
  }
  if (movesToTrash) window.history.replaceState(null, "", `#${currentFolder}`);
}

function requestPermanentDelete(ids) {
  if (ids.length === 0) {
    showToast("Select at least one message first.");
    return;
  }
  pendingDeleteIds = [...ids];
  elements.deleteDescription.textContent =
    `Permanently delete ${ids.length} ${ids.length === 1 ? "message" : "messages"}? This cannot be undone.`;
  elements.deleteDialog.showModal();
}

function permanentlyDelete() {
  const ids = pendingDeleteIds;
  const attachmentIds = mailbox.messages
    .filter((message) => ids.includes(message.id))
    .flatMap((message) => (message.attachments ?? []).map((attachment) => attachment.id));
  const deleted = updateMailbox(() => {
    mailbox.messages = mailbox.messages.filter((message) => !ids.includes(message.id));
    selectedIds.clear();
    selectedMessageId = null;
  }, "Messages permanently deleted.");
  if (deleted) {
    for (const id of attachmentIds) {
      removeAttachment(id).catch((error) => {
        console.error("Could not remove a deleted message attachment.", error);
        showToast(error.message || "Could not remove a message attachment.");
      });
    }
  }
  pendingDeleteIds = [];
  elements.deleteDialog.close();
}

function toggleStar(id) {
  const message = mailbox.messages.find((item) => item.id === id);
  if (!message) return;
  updateMailbox(() => { message.starred = !message.starred; });
}

function updateDraftFromForm() {
  if (editingSentMessageId) return true;
  const formData = new FormData(elements.composeForm);
  const values = {
    to: String(formData.get("to") ?? "").trim(),
    subject: String(formData.get("subject") ?? "").trim(),
    body: String(formData.get("body") ?? ""),
    attachments: structuredClone(composeAttachments),
  };
  const hasContent = Boolean(values.to || values.subject || values.body.trim() || values.attachments.length);
  if (!hasContent) {
    if (composeDraftId) {
      const previousDrafts = structuredClone(mailbox.drafts);
      mailbox.drafts = mailbox.drafts.filter((draft) => draft.id !== composeDraftId);
      if (!persist()) {
        mailbox.drafts = previousDrafts;
        return false;
      }
      composeDraftId = null;
      updateCounts();
    }
    elements.draftStatus.textContent = "";
    return true;
  }

  const timestamp = new Date().toISOString();
  if (!composeDraftId) composeDraftId = createId("draft");
  const previousDrafts = structuredClone(mailbox.drafts);
  const existing = mailbox.drafts.find((draft) => draft.id === composeDraftId);
  const draft = { id: composeDraftId, ...values, updatedAt: timestamp };
  if (existing) Object.assign(existing, draft);
  else mailbox.drafts.push(draft);

  if (persist()) {
    elements.draftStatus.textContent = "Saving…";
    updateCounts();
    return true;
  }
  mailbox.drafts = previousDrafts;
  return false;
}

function openCompose({
  to = "",
  subject = "",
  body = "",
  attachments = [],
  draftId = null,
  sentMessageId = null,
} = {}) {
  composeDraftId = draftId;
  editingSentMessageId = sentMessageId;
  editingSentMessageAttachments = sentMessageId ? structuredClone(attachments) : [];
  composeAttachments = structuredClone(attachments);
  elements.composeForm.reset();
  elements.composeForm.elements.to.value = to;
  elements.composeForm.elements.to.readOnly = Boolean(sentMessageId);
  elements.composeForm.elements.subject.value = subject;
  elements.composeForm.elements.body.value = body;
  elements.composeTitle.textContent = sentMessageId ? "Edit sent message" : "New message";
  elements.composeSend.innerHTML = sentMessageId
    ? 'Save changes <span aria-hidden="true">→</span>'
    : 'Send message <span aria-hidden="true">→</span>';
  elements.discardDraft.hidden = Boolean(sentMessageId);
  elements.draftStatus.textContent = draftId ? "Draft saved" : "";
  void renderComposeAttachments();
  if (!elements.composeDialog.open) elements.composeDialog.showModal();
  elements.composeForm.elements.to.focus();
}

function openDraft(id) {
  const draft = mailbox.drafts.find((item) => item.id === id);
  if (!draft) return;
  openCompose({ ...draft, draftId: draft.id });
}

function editSentMessage(message) {
  if (
    message.folder !== "sent" ||
    message.senderEmail?.toLocaleLowerCase() !== currentUser.email.toLocaleLowerCase()
  ) return;
  openCompose({
    to: message.recipientEmail,
    subject: message.subject,
    body: message.body.join("\n\n"),
    attachments: (message.attachments ?? []).map((attachment) => ({
      ...attachment,
      serverStored: true,
    })),
    sentMessageId: message.id,
  });
}

function saveAndCloseCompose() {
  window.clearTimeout(draftTimer);
  if (editingSentMessageId) {
    elements.composeDialog.close();
    return;
  }
  if (updateDraftFromForm()) elements.composeDialog.close();
}

async function sendComposedMessage(event) {
  event.preventDefault();
  if (!elements.composeForm.reportValidity()) return;
  const formData = new FormData(elements.composeForm);
  window.clearTimeout(draftTimer);
  if (!editingSentMessageId && !updateDraftFromForm()) return;
  const sendButton = elements.composeSend;
  const isEditing = Boolean(editingSentMessageId);
  const messageId = editingSentMessageId;
  sendButton.disabled = true;
  elements.draftStatus.textContent = isEditing ? "Saving changes…" : "Sending…";
  try {
    await mailboxSaveQueue;
    const attachments = await Promise.all(composeAttachments.map(async (attachment) => {
      if (attachment.serverStored) return attachment;
      const blob = await readAttachment(attachment.id);
      return {
        ...attachment,
        content: await blobToBase64(blob),
      };
    }));
    const message = {
          recipientEmail: String(formData.get("to")).trim(),
          subject: String(formData.get("subject")).trim(),
          body: String(formData.get("body")),
          attachments,
        };
    const result = isEditing
      ? await apiRequest(`/api/mailbox/messages/${encodeURIComponent(messageId)}`, {
        method: "PATCH",
        body: { message },
      })
      : await apiRequest("/api/mailbox/send", {
        method: "POST",
        body: { message: { ...message, draftId: composeDraftId } },
      });
    if (isEditing) {
      const localMessage = mailbox.messages.find((item) => item.id === messageId);
      if (localMessage) {
        const retainedIds = new Set((result.message.attachments ?? []).map(({ id }) => id));
        for (const attachment of localMessage.attachments ?? []) {
          if (retainedIds.has(attachment.id)) continue;
          removeAttachment(attachment.id).catch((error) => {
            console.error(`Could not clean up attachment "${attachment.name}".`, error);
            showToast(error.message || `Could not clean up ${attachment.name}.`);
          });
        }
        Object.assign(localMessage, result.message);
      }
    } else {
      mailbox.messages.push(result.message);
      if (composeDraftId) mailbox.drafts = mailbox.drafts.filter((draft) => draft.id !== composeDraftId);
    }
    currentFolder = "sent";
    currentCategory = "primary";
    selectedMessageId = result.message.id;
    selectedIds.clear();
    composeDraftId = null;
    composeAttachments = [];
    render();
    showToast(isEditing
      ? "Sent message updated for all recipients."
      : `Message delivered to ${result.message.recipientEmail}.`);
    void renderComposeAttachments();
    elements.composeForm.reset();
    elements.composeDialog.close();
    window.history.replaceState(null, "", "#sent");
  } catch (error) {
    if (redirectToLoginIfUnauthorized(error)) return;
    console.error(isEditing ? "Could not update the sent message." : "Could not send the message.", error);
    elements.draftStatus.textContent = error.message ||
      (isEditing ? "Message could not be updated." : "Message could not be sent.");
  } finally {
    sendButton.disabled = false;
  }
}

function blobToBase64(blob) {
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
    reader.readAsDataURL(blob);
  });
}

async function addSelectedFiles(fileList) {
  const files = [...fileList];
  if (files.length === 0) return;
  const currentSize = composeAttachments.reduce((total, attachment) => total + attachment.size, 0);
  const accepted = [];
  let totalSize = currentSize;

  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      showToast(`${file.name} is too large. The per-file limit is 5 MB.`);
      continue;
    }
    if (totalSize + file.size > MAX_COMPOSE_SIZE) {
      showToast("Attachments are limited to 15 MB per message.");
      continue;
    }
    accepted.push(file);
    totalSize += file.size;
  }
  if (accepted.length === 0) return;

  const saved = [];
  try {
    for (const file of accepted) {
      const id = createId("attachment");
      await saveAttachment(id, file);
      saved.push({ id, name: file.name, type: file.type || "application/octet-stream", size: file.size });
    }
  } catch (error) {
    console.error("Could not save the selected attachments.", error);
    for (const attachment of saved) {
      try {
        await removeAttachment(attachment.id);
      } catch (cleanupError) {
        console.error(`Could not clean up attachment "${attachment.name}".`, cleanupError);
      }
    }
    showToast(error.message || "Could not save the selected attachments.");
    return;
  }

  composeAttachments.push(...saved);
  await renderComposeAttachments();
  if (!updateDraftFromForm()) {
    composeAttachments = composeAttachments.filter(
      (attachment) => !saved.some((item) => item.id === attachment.id),
    );
    await renderComposeAttachments();
    for (const attachment of saved) {
      try {
        await removeAttachment(attachment.id);
      } catch (error) {
        console.error(`Could not clean up attachment "${attachment.name}".`, error);
      }
    }
  }
}

async function removeComposeAttachment(id) {
  const removed = composeAttachments.find((attachment) => attachment.id === id);
  if (!removed) return;
  composeAttachments = composeAttachments.filter((attachment) => attachment.id !== id);
  if (removed.serverStored) {
    await renderComposeAttachments();
    return;
  }
  if (!updateDraftFromForm()) {
    composeAttachments.push(removed);
    await renderComposeAttachments();
    return;
  }
  await renderComposeAttachments();
  try {
    await removeAttachment(id);
  } catch (error) {
    console.error(`Could not remove attachment "${removed.name}".`, error);
    showToast(error.message || `Could not remove ${removed.name}.`);
  }
}

function insertAtCursor(text) {
  const textarea = elements.composeForm.elements.body;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  textarea.setRangeText(text, start, end, "end");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus();
}

function openLinkDialog() {
  const textarea = elements.composeForm.elements.body;
  savedLinkSelection = {
    start: textarea.selectionStart ?? textarea.value.length,
    end: textarea.selectionEnd ?? textarea.value.length,
  };
  elements.linkForm.reset();
  const selectedText = textarea.value.slice(savedLinkSelection.start, savedLinkSelection.end);
  elements.linkForm.elements.text.value = selectedText;
  elements.linkDialog.showModal();
  elements.linkForm.elements.text.focus();
}

function insertLink(event) {
  event.preventDefault();
  if (!elements.linkForm.reportValidity()) return;
  const formData = new FormData(elements.linkForm);
  const text = String(formData.get("text")).trim();
  const rawUrl = String(formData.get("url")).trim();
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    showToast("Enter a valid web address.");
    return;
  }
  if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
    showToast("Links must use http, https, or mailto.");
    return;
  }
  const formattedLink = text ? `${text} (${url.href})` : url.href;
  const textarea = elements.composeForm.elements.body;
  textarea.focus();
  textarea.setRangeText(formattedLink, savedLinkSelection.start, savedLinkSelection.end, "end");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  elements.linkDialog.close();
}

function handleCurrentMessageAction(action) {
  const message = currentMessage();
  if (!message) return;

  if (action === "edit-sent") {
    editSentMessage(message);
  } else if (action === "snooze-current") {
    moveMessages([message.id], "snoozed", "Message moved to Snoozed.");
  } else if (action === "archive-current") {
    const destination = ["archive", "trash", "snoozed", "spam"].includes(currentFolder)
      ? "inbox"
      : "archive";
    moveMessages([message.id], destination, destination === "inbox" ? "Message restored to inbox." : "Message archived.");
  } else if (action === "trash-current") {
    if (currentFolder === "trash") requestPermanentDelete([message.id]);
    else moveMessages([message.id], "trash", "Message moved to trash.");
  } else if (action === "spam-current") {
    moveMessages([message.id], "spam", "Message reported as spam.");
  } else if (action === "mark-current-unread") {
    updateMailbox(() => { message.unread = true; }, "Message marked unread.");
  } else if (action === "reply") {
    openCompose({
      to: message.folder === "sent" ? message.recipientEmail : message.senderEmail,
      subject: message.subject.startsWith("Re:") ? message.subject : `Re: ${message.subject}`,
      body: `\n\nOn ${new Date(message.createdAt).toLocaleString()}, ${message.sender} wrote:\n${message.body.join("\n\n")}`,
    });
  } else if (action === "forward") {
    openCompose({
      subject: message.subject.startsWith("Fwd:") ? message.subject : `Fwd: ${message.subject}`,
      body: `\n\n---------- Forwarded message ----------\nFrom: ${message.sender} <${message.senderEmail}>\nSubject: ${message.subject}\n\n${message.body.join("\n\n")}`,
    });
  } else if (action === "react") {
    updateMailbox(() => {
      const reactionIndex = message.reactions.indexOf("💜");
      if (reactionIndex === -1) message.reactions.push("💜");
      else message.reactions.splice(reactionIndex, 1);
    });
  } else if (action === "recipient-details") {
    showToast(message.recipientEmail || message.senderEmail);
  } else if (action === "toggle-detail-star") {
    toggleStar(message.id);
  } else if (action === "label-current") {
    openLabelDialog([message.id]);
  }
}

function closeMessageActionMenus() {
  document.querySelectorAll("[data-message-action-menu]:not([hidden])").forEach((menu) => {
    menu.hidden = true;
    menu.previousElementSibling?.setAttribute("aria-expanded", "false");
  });
}

function toggleMessageActionMenu(button) {
  const menu = button.parentElement.querySelector("[data-message-action-menu]");
  if (!menu) return;
  const shouldOpen = menu.hidden;
  closeMessageActionMenus();
  menu.hidden = !shouldOpen;
  button.setAttribute("aria-expanded", String(shouldOpen));
  if (shouldOpen) menu.querySelector("button")?.focus();
}

function populateLabelOptions(selectedName = "") {
  elements.labelSelect.replaceChildren();
  for (const label of mailbox.labels) {
    const option = document.createElement("option");
    option.value = label.name;
    option.textContent = label.name;
    option.selected = label.name === selectedName;
    elements.labelSelect.append(option);
  }
}

function openLabelDialog(ids = []) {
  pendingLabelIds = [...ids];
  const selectedMessage = mailbox.messages.find((message) => message.id === ids[0]);
  populateLabelOptions(selectedMessage?.labels[0] ?? mailbox.labels[0]?.name);
  elements.labelDialog.querySelector('[data-action="apply-label"]').disabled = ids.length === 0;
  elements.newLabelInput.value = "";
  if (!elements.labelDialog.open) elements.labelDialog.showModal();
}

function updateMessageLabels(ids, requestedLabel) {
  if (ids.length === 0) {
    showToast("Select a message first.");
    return false;
  }
  if (mailbox.labels.length === 0) {
    showToast("Create a label first.");
    return false;
  }
  const labelName = requestedLabel?.trim();
  if (!labelName) {
    showToast("Choose a label from the list.");
    return false;
  }
  const label = mailbox.labels.find((item) => item.name.toLocaleLowerCase() === labelName.toLocaleLowerCase());
  if (!label) {
    showToast("Choose a label from the list.");
    return false;
  }

  const shouldRemove = ids.every((id) =>
    mailbox.messages.find((message) => message.id === id)?.labels.includes(label.name),
  );
  return updateMailbox(() => {
    for (const message of mailbox.messages) {
      if (!ids.includes(message.id)) continue;
      if (shouldRemove) {
        message.labels = message.labels.filter((item) => item !== label.name);
      } else if (!message.labels.includes(label.name)) {
        message.labels.push(label.name);
      }
    }
    selectedIds.clear();
  }, `Label ${shouldRemove ? "removed" : "added"}: ${label.name}.`);
}

function createLabel() {
  const name = elements.newLabelInput.value.trim();
  if (!name) {
    showToast("Enter a name for the new label.");
    elements.newLabelInput.focus();
    return;
  }
  if (mailbox.labels.some((label) => label.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    showToast("That label already exists.");
    elements.newLabelInput.focus();
    return;
  }
  const colors = ["lilac", "mint", "coral", "peach", "blue"];
  if (updateMailbox(() => {
    mailbox.labels.push({ name, color: colors[mailbox.labels.length % colors.length] });
  }, "Label created.")) {
    populateLabelOptions(name);
    elements.newLabelInput.value = "";
  }
}

function handleAction(action, target) {
  if (action === "compose") openCompose();
  else if (action === "close-compose") saveAndCloseCompose();
  else if (action === "discard-draft") {
    const id = composeDraftId;
    const attachmentIds = composeAttachments.map((attachment) => attachment.id);
    let discarded = !id;
    if (id) {
      discarded = updateMailbox(() => {
        mailbox.drafts = mailbox.drafts.filter((draft) => draft.id !== id);
      }, "Draft discarded.");
    }
    if (discarded) {
      for (const attachmentId of attachmentIds) {
        removeAttachment(attachmentId).catch((error) => {
          console.error("Could not remove a discarded draft attachment.", error);
          showToast(error.message || "Could not remove a draft attachment.");
        });
      }
      composeAttachments = [];
      renderComposeAttachments();
      elements.composeForm.reset();
      composeDraftId = null;
      elements.composeDialog.close();
    }
  } else if (action === "close-help") elements.helpDialog.close();
  else if (action === "close-link") elements.linkDialog.close();
  else if (action === "insert-link") openLinkDialog();
  else if (action === "choose-files") elements.fileInput.click();
  else if (action === "choose-photos") elements.photoInput.click();
  else if (action === "remove-attachment") removeComposeAttachment(target.dataset.attachmentId);
  else if (action === "help") elements.helpDialog.showModal();
  else if (action === "refresh") {
    render();
    showToast("Mailbox refreshed.");
  } else if (action === "toggle-star") {
    toggleStar(target.closest(".message-row").dataset.messageId);
  } else if (action === "open-message") {
    openMessage(target.closest(".message-row").dataset.messageId);
  } else if (action === "archive-current" || action === "trash-current" ||
    action === "snooze-current" || action === "spam-current" ||
    action === "mark-current-unread" ||
    action === "toggle-detail-star" || action === "reply" ||
    action === "forward" || action === "react" ||
    action === "recipient-details" || action === "edit-sent") {
    handleCurrentMessageAction(action);
  } else if (action === "archive-selected") {
    if (currentFolder === "trash") requestPermanentDelete(getSelectedIds());
    else moveMessages(getSelectedIds(), "archive", "Selected messages archived.");
  } else if (action === "snooze-selected") {
    moveMessages(getSelectedIds(), "snoozed", "Selected messages snoozed.");
  } else if (action === "trash-selected") {
    if (currentFolder === "trash") requestPermanentDelete(getSelectedIds());
    else moveMessages(getSelectedIds(), "trash", "Selected messages moved to trash.");
  } else if (action === "mark-unread") {
    const ids = getSelectedIds();
    if (ids.length === 0) showToast("Select at least one message first.");
    else {
      updateMailbox(() => {
        for (const message of mailbox.messages) if (ids.includes(message.id)) message.unread = true;
        selectedIds.clear();
      }, "Selected messages marked unread.");
    }
  } else if (action === "label-selected") {
    openLabelDialog(getSelectedIds());
  } else if (action === "mark-visible-read") {
    const ids = getVisibleMessages().map((message) => message.id);
    updateMailbox(() => {
      for (const message of mailbox.messages) if (ids.includes(message.id)) message.unread = false;
    }, "Visible messages marked as read.");
  } else if (action === "add-label") openLabelDialog();
  else if (action === "label-current") openLabelDialog([currentMessage()?.id].filter(Boolean));
  else if (action === "apply-label") {
    if (updateMessageLabels(pendingLabelIds, elements.labelSelect.value)) elements.labelDialog.close();
  } else if (action === "create-label") createLabel();
  else if (action === "close-labels") elements.labelDialog.close();
  else if (action === "cancel-delete") elements.deleteDialog.close();
  else if (action === "confirm-delete") permanentlyDelete();
}

function handleFolderClick(event) {
  const folderLink = event.target.closest("[data-folder]");
  if (folderLink) {
    event.preventDefault();
    selectFolder(folderLink.dataset.folder);
    return;
  }

  const labelLink = event.target.closest("[data-label]");
  if (labelLink) {
    event.preventDefault();
    currentFolder = `label:${labelLink.dataset.label}`;
    selectedMessageId = null;
    selectedIds.clear();
    const first = getVisibleMessages()[0];
    if (first) openMessage(first.id);
    else render();
  }
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const actionTarget = event.target.closest("[data-action]");
    if (actionTarget) {
      if (actionTarget.dataset.action === "toggle-message-menu") {
        event.preventDefault();
        toggleMessageActionMenu(actionTarget);
        return;
      }
      closeMessageActionMenus();
      if (actionTarget.dataset.action === "logout") {
        event.preventDefault();
        void apiRequest("/api/auth/logout", { method: "POST" })
          .then(() => window.location.assign("/login"))
          .catch((error) => {
            console.error("Could not sign out.", error);
            showToast(error.message || "Could not sign out. Please try again.");
          });
        return;
      }
      handleAction(actionTarget.dataset.action, actionTarget);
      return;
    }

    closeMessageActionMenus();
    const folderLink = event.target.closest("[data-folder], [data-label]");
    if (folderLink) handleFolderClick(event);
  });

  elements.list.addEventListener("change", (event) => {
    if (event.target.matches(".message-check input")) {
      const id = event.target.closest(".message-row").dataset.messageId;
      if (event.target.checked) selectedIds.add(id);
      else selectedIds.delete(id);
      render();
    }
  });

  elements.selectAll.addEventListener("change", () => {
    for (const message of getVisibleMessages()) {
      if (elements.selectAll.checked) selectedIds.add(message.id);
      else selectedIds.delete(message.id);
    }
    render();
  });

  document.querySelectorAll("[data-category]").forEach((tab) => {
    tab.addEventListener("click", () => setCategory(tab.dataset.category));
  });

  elements.search.addEventListener("input", () => {
    selectedMessageId = null;
    selectedIds.clear();
    const first = getVisibleMessages()[0];
    if (first && !first.isDraft) selectedMessageId = first.id;
    render();
  });

  elements.composeForm.addEventListener("input", () => {
    if (editingSentMessageId) {
      elements.draftStatus.textContent = "Unsaved changes";
      return;
    }
    elements.draftStatus.textContent = "Saving…";
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(updateDraftFromForm, 350);
  });
  elements.fileInput.addEventListener("change", () => {
    void addSelectedFiles(elements.fileInput.files);
    elements.fileInput.value = "";
  });
  elements.photoInput.addEventListener("change", () => {
    void addSelectedFiles(elements.photoInput.files);
    elements.photoInput.value = "";
  });
  elements.snippetSelect.addEventListener("change", () => {
    const snippetValue = snippets[elements.snippetSelect.value];
    const snippet = typeof snippetValue === "function" ? snippetValue() : snippetValue;
    if (snippet) {
      const currentBody = elements.composeForm.elements.body.value;
      const separator = currentBody && !currentBody.endsWith("\n\n") ? "\n\n" : "";
      insertAtCursor(`${separator}${snippet}`);
    }
    elements.snippetSelect.value = "";
  });
  elements.linkForm.addEventListener("submit", insertLink);
  elements.composeForm.addEventListener("submit", sendComposedMessage);
  elements.composeDialog.addEventListener("close", () => {
    window.clearTimeout(draftTimer);
    composeDraftId = null;
    composeAttachmentRenderId += 1;
    revokeComposeAttachmentUrls();
    if (editingSentMessageId) {
      const originalIds = new Set(
        editingSentMessageAttachments.map((attachment) => attachment.id),
      );
      for (const attachment of composeAttachments) {
        if (originalIds.has(attachment.id) || attachment.serverStored) continue;
        removeAttachment(attachment.id).catch((error) => {
          console.error(`Could not clean up attachment "${attachment.name}".`, error);
          showToast(error.message || `Could not clean up ${attachment.name}.`);
        });
      }
      composeAttachments = [];
      editingSentMessageId = null;
      editingSentMessageAttachments = [];
      elements.composeForm.elements.to.readOnly = false;
      elements.composeTitle.textContent = "New message";
      elements.composeSend.innerHTML = 'Send message <span aria-hidden="true">→</span>';
      elements.discardDraft.hidden = false;
    }
  });
  elements.composeDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    saveAndCloseCompose();
  });
  elements.labelForm.addEventListener("submit", (event) => event.preventDefault());
  elements.labelDialog.addEventListener("close", () => { pendingLabelIds = []; });
  elements.deleteDialog.addEventListener("close", () => { pendingDeleteIds = []; });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const openMenu = document.querySelector("[data-message-action-menu]:not([hidden])");
      if (openMenu) {
        closeMessageActionMenus();
        openMenu.previousElementSibling?.focus();
        return;
      }
    }
    const target = event.target;
    const isTyping = target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target.isContentEditable;
    if (event.key === "/" && !isTyping) {
      event.preventDefault();
      elements.search.focus();
    } else if (event.key.toLocaleLowerCase() === "c" && !isTyping &&
      !elements.composeDialog.open && !elements.helpDialog.open &&
      !elements.labelDialog.open && !elements.deleteDialog.open) {
      event.preventDefault();
      openCompose();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey) &&
      elements.composeDialog.open) {
      event.preventDefault();
      elements.composeForm.requestSubmit();
    }
  });
}

async function initialize() {
  try {
    const [{ user }, { mailbox: savedMailbox }] = await Promise.all([
      apiRequest("/api/auth/me"),
      apiRequest("/api/mailbox"),
    ]);
    currentUser = user;
    mailbox = savedMailbox;
    if (user.role === "admin") elements.adminLink.hidden = false;
    elements.profileName.textContent = user.name;
    elements.profileAvatarInitial.textContent = user.name.trim().charAt(0).toLocaleUpperCase() || "?";
    const stickerSymbol = getProfileStickerSymbol(user.avatarSticker);
    elements.profileSticker.textContent = stickerSymbol;
    elements.profileSticker.hidden = !stickerSymbol;
    elements.profileAvatarInitial.hidden = Boolean(stickerSymbol || user.profilePhoto);
    elements.profileAvatar.classList.toggle("has-avatar-photo", Boolean(user.profilePhoto));
    elements.profileAvatar.classList.toggle("has-avatar-sticker", Boolean(stickerSymbol));
    elements.profilePhoto.hidden = !user.profilePhoto;
    if (user.profilePhoto) elements.profilePhoto.src = user.profilePhoto;
    else elements.profilePhoto.removeAttribute("src");
    elements.profilePosition.textContent = user.position || "";
    elements.profilePosition.hidden = !user.position;
    elements.profileLink.setAttribute("aria-label", `Open profile for ${user.name}`);
  } catch (error) {
    if (redirectToLoginIfUnauthorized(error)) return;
    console.error("Could not load the server mailbox.", error);
    renderEmptyList(elements.list, "Mailbox unavailable", error.message || "Please refresh to try again.");
    renderEmptyDetail(elements.detail);
    showToast(error.message || "Your mailbox could not be loaded.");
    return;
  }

  bindEvents();
  currentCategory = "primary";
  const firstMessage = getVisibleMessages()[0];
  selectedMessageId = firstMessage?.id ?? null;
  render();
  try {
    const { notifications } = await apiRequest("/api/users/me/notifications");
    const latestUnread = notifications.find((notification) => notification.unread);
    if (latestUnread) showToast(latestUnread.message);
  } catch (error) {
    console.error("Could not load account notifications.", error);
  }
}

void initialize();
