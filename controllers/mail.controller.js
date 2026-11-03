import { AccountError } from "../services/errors.js";
import {
  getMailbox,
  getMailboxAttachment,
  getManagedMailbox,
  getManagedMailboxAttachment,
  markMailboxMessageRead,
  saveMailbox,
  sendMailboxMessage,
  updateOwnSentMailboxMessage,
  updateManagedMailboxMessage,
  deleteManagedMailboxMessage,
} from "../services/mailbox-json.service.js";

export async function readMailbox(request, response) {
  try {
    response.json({ mailbox: await getMailbox(request.user.id) });
  } catch (error) {
    sendMailboxError(response, error, "Mailbox could not be loaded.");
  }
}

export async function writeMailbox(request, response) {
  try {
    const result = await saveMailbox(request.user.id, request.body?.mailbox);
    response.json(result);
  } catch (error) {
    sendMailboxError(response, error, "Mailbox could not be saved.");
  }
}

export async function sendMessage(request, response) {
  try {
    response.status(201).json(
      await sendMailboxMessage(request.user.id, request.body?.message),
    );
  } catch (error) {
    sendMailboxError(response, error, "Message could not be sent.");
  }
}

export async function markMessageRead(request, response) {
  try {
    response.json(await markMailboxMessageRead(request.user.id, request.params.messageId));
  } catch (error) {
    sendMailboxError(response, error, "Message could not be updated.");
  }
}

export async function updateSentMessage(request, response) {
  try {
    response.json(await updateOwnSentMailboxMessage(
      request.user,
      request.params.messageId,
      request.body?.message,
    ));
  } catch (error) {
    sendMailboxError(response, error, "Message could not be updated.");
  }
}

export async function readMailboxAttachment(request, response) {
  try {
    const file = await getMailboxAttachment(
      request.user.id,
      request.params.messageId,
      request.params.attachmentId,
    );
    sendAttachment(response, file);
  } catch (error) {
    sendMailboxError(response, error, "Attachment could not be loaded.");
  }
}

export async function readManagedMailbox(request, response) {
  try {
    response.json({ mailbox: await getManagedMailbox(request.params.userId) });
  } catch (error) {
    sendMailboxError(response, error, "Employee mailbox could not be loaded.");
  }
}

export async function readManagedMailboxAttachment(request, response) {
  try {
    const file = await getManagedMailboxAttachment(
      request.params.userId,
      request.params.messageId,
      request.params.attachmentId,
    );
    sendAttachment(response, file);
  } catch (error) {
    sendMailboxError(response, error, "Attachment could not be loaded.");
  }
}

export async function markManagedMessageRead(request, response) {
  try {
    response.json(await markMailboxMessageRead(request.params.userId, request.params.messageId));
  } catch (error) {
    sendMailboxError(response, error, "Message could not be updated.");
  }
}

export async function updateManagedMessage(request, response) {
  try {
    response.json(await updateManagedMailboxMessage(
      request.user,
      request.params.userId,
      request.params.messageId,
      request.body?.message,
    ));
  } catch (error) {
    sendMailboxError(response, error, "Message could not be updated.");
  }
}

export async function deleteManagedMessage(request, response) {
  try {
    response.json(await deleteManagedMailboxMessage(
      request.user,
      request.params.userId,
      request.params.messageId,
    ));
  } catch (error) {
    sendMailboxError(response, error, "Message could not be deleted.");
  }
}

function sendAttachment(response, file) {
  const filename = file.name.replace(/[^\x20-\x7E"\\;]/g, "_");
  const encodedFilename = encodeURIComponent(file.name).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  response.setHeader("Content-Type", file.type);
  response.setHeader(
    "Content-Disposition",
    `inline; filename="${filename}"; filename*=UTF-8''${encodedFilename}`,
  );
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Length", file.content.length);
  response.send(file.content);
}

function sendMailboxError(response, error, fallbackMessage) {
  if (error instanceof AccountError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  console.error(fallbackMessage, error);
  response.status(500).json({ error: fallbackMessage });
}
