const element = (tagName, className, text) => {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function formatMessageDate(value) {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }

  const dayDifference = Math.floor((now.setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / 86_400_000);
  if (dayDifference === 1) return "Yesterday";
  if (dayDifference < 7) return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function setAvatar(node, initial, photo, avatarSticker = "") {
  node.replaceChildren();
  if (photo) {
    const image = element("img");
    image.src = photo;
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    node.append(image);
  } else {
    node.textContent = avatarSticker || initial;
    if (avatarSticker) node.classList.add("has-avatar-sticker");
  }
  if (photo && avatarSticker) {
    const sticker = element("span", "avatar-sticker", avatarSticker);
    sticker.setAttribute("aria-hidden", "true");
    node.append(sticker);
  }
}

export function createMessageRow(message, { active, selected, profilePhoto = "", avatarSticker = "" }) {
  const row = element("div", `message-row${message.unread ? " unread-message" : ""}${active ? " active-message" : ""}`);
  row.dataset.messageId = message.id;
  if (active) row.setAttribute("aria-current", "true");

  const checkboxLabel = element("label", "message-check");
  const checkbox = element("input");
  checkbox.type = "checkbox";
  checkbox.checked = selected;
  checkbox.setAttribute("aria-label", `Select message from ${message.sender}`);
  checkbox.disabled = Boolean(message.isDraft);
  const checkboxMark = element("span");
  checkboxLabel.append(checkbox, checkboxMark);
  row.append(checkboxLabel);

  const star = element("button", `star${message.starred ? " is-starred" : ""}`, message.starred ? "★" : "☆");
  star.type = "button";
  star.dataset.action = "toggle-star";
  star.setAttribute("aria-label", message.starred ? "Remove star" : "Star message");
  star.disabled = Boolean(message.isDraft);
  star.hidden = Boolean(message.isDraft);
  row.append(star);

  const avatar = element("span", `message-avatar ${message.color}`, message.sender.trim().charAt(0).toUpperCase());
  if (profilePhoto || avatarSticker) {
    setAvatar(avatar, message.sender.trim().charAt(0).toUpperCase(), profilePhoto, avatarSticker);
  }
  avatar.setAttribute("aria-hidden", "true");
  row.append(avatar);

  const openButton = element("button", "message-open");
  openButton.type = "button";
  openButton.dataset.action = "open-message";
  openButton.setAttribute("aria-label", `Open ${message.subject} from ${message.sender}`);
  const copy = element("span", "message-copy");
  copy.append(
    element("span", "message-sender", message.sender),
    element("strong", "", message.subject),
    element("span", "", message.preview),
  );
  openButton.append(copy);
  row.append(openButton);

  const time = element("time", "", formatMessageDate(message.createdAt));
  time.dateTime = message.createdAt;
  row.append(time);
  return row;
}

function createActionButton(label, action, text) {
  const button = element("button", "", text);
  button.type = "button";
  button.dataset.action = action;
  button.setAttribute("aria-label", label);
  button.title = label;
  return button;
}

export function renderMessageDetail(container, message, {
  profilePhoto = "",
  avatarSticker = "",
  canEditSentMessage = false,
} = {}) {
  container.replaceChildren();

  const toolbar = element("div", "detail-toolbar");
  const back = element("a", "back-to-inbox", "←");
  back.href = "#inbox-list";
  back.setAttribute("aria-label", "Back to inbox");
  toolbar.append(
    back,
    element("span", "toolbar-spacer"),
    createActionButton("Snooze message", "snooze-current", "◷"),
    createActionButton("Archive message", "archive-current", "▤"),
    createActionButton("Report as spam", "spam-current", "!"),
    createActionButton("Move message to trash", "trash-current", "⌫"),
    createActionButton("Add or remove a label", "label-current", "#"),
    element("span", "toolbar-divider"),
    createActionButton("Mark message unread", "mark-current-unread", "◉"),
  );
  container.append(toolbar);

  const detail = element("div", "detail-content");
  const subjectRow = element("div", "detail-subject-row");
  subjectRow.append(element("h2", "", message.subject));
  if (message.labels.length > 0) {
    subjectRow.append(element("span", "message-label", message.labels.join(", ")));
  }
  detail.append(subjectRow);

  const senderDetails = element("div", "sender-details");
  const avatar = element("span", `message-avatar ${message.color}`, message.sender.trim().charAt(0).toUpperCase());
  if (profilePhoto || avatarSticker) {
    setAvatar(avatar, message.sender.trim().charAt(0).toUpperCase(), profilePhoto, avatarSticker);
  }
  avatar.setAttribute("aria-hidden", "true");
  const sender = element("div");
  sender.append(element("strong", "", message.sender));
  const recipientLine = element("span", "", "to Maya ");
  recipientLine.append(createActionButton("Show recipient details", "recipient-details", "⌄"));
  sender.append(recipientLine);
  const timestamp = element("time", "", new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(message.createdAt)));
  timestamp.dateTime = message.createdAt;
  const moreActions = element("div", "message-more-actions");
  const moreButton = createActionButton("More message actions", "toggle-message-menu", "•••");
  moreButton.classList.add("reply-more");
  moreButton.setAttribute("aria-haspopup", "menu");
  moreButton.setAttribute("aria-expanded", "false");
  const menu = element("div", "message-action-menu");
  menu.dataset.messageActionMenu = "";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  const menuActions = [
    ...(canEditSentMessage ? [["Edit sent message", "edit-sent"]] : []),
    ["Reply", "reply"],
    ["Forward", "forward"],
    [message.folder === "trash" ? "Delete permanently" : "Move to trash", "trash-current"],
    ["Archive", "archive-current"],
  ];
  for (const [label, action] of menuActions) {
    const item = element("button", action === "trash-current" ? "is-danger" : "", label);
    item.type = "button";
    item.dataset.action = action;
    item.setAttribute("role", "menuitem");
    menu.append(item);
  }
  moreActions.append(moreButton, menu);
  senderDetails.append(
    avatar,
    sender,
    timestamp,
    createActionButton(message.starred ? "Remove star" : "Star message", "toggle-detail-star", message.starred ? "★" : "☆"),
    moreActions,
  );
  detail.append(senderDetails);

  const body = element("div", "message-body");
  for (const paragraph of message.body) {
    body.append(element("p", "", paragraph));
  }
  if (message.reactions.length > 0) {
    const reactions = element("div", "message-reactions");
    for (const reaction of message.reactions) reactions.append(element("span", "", reaction));
    body.append(reactions);
  }
  detail.append(body);

  let attachments = null;
  if (message.attachments?.length) {
    attachments = element("div", "message-attachments");
    attachments.append(
      element("h3", "", `${message.attachments.length} ${message.attachments.length === 1 ? "attachment" : "attachments"}`),
    );
    const list = element("div", "message-attachment-list");
    list.dataset.attachmentList = "";
    attachments.append(list);
    detail.append(attachments);
  }

  const actions = element("div", "reply-actions");
  const reply = element("button", "reply-button");
  reply.type = "button";
  reply.dataset.action = "reply";
  reply.append(element("span", "", "↶"), document.createTextNode(" Reply"));
  const forward = element("button", "forward-button");
  forward.type = "button";
  forward.dataset.action = "forward";
  forward.append(element("span", "", "↷"), document.createTextNode(" Forward"));
  const react = element("button", "reaction-button", "☺");
  react.type = "button";
  react.dataset.action = "react";
  react.setAttribute("aria-label", "React with a purple heart");
  actions.append(reply, forward, react);
  detail.append(actions);
  container.append(detail);
  return attachments?.querySelector("[data-attachment-list]") ?? null;
}

export function renderEmptyDetail(container) {
  container.replaceChildren(element("div", "detail-empty", "Select a message to read it."));
}

export function renderEmptyList(container, title, description) {
  const empty = element("div", "message-empty");
  empty.append(element("strong", "", title), element("p", "", description));
  container.replaceChildren(empty);
}

export function renderLabelLink(label, isSelected) {
  const link = element("a", `folder-link label-link${isSelected ? " selected" : ""}`);
  link.href = `#label-${encodeURIComponent(label.name.toLowerCase())}`;
  link.dataset.label = label.name;
  const dot = element("span", `label-dot label-${label.color}`);
  dot.setAttribute("aria-hidden", "true");
  link.append(dot, document.createTextNode(label.name));
  return link;
}
