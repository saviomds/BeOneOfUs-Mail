import { Router } from "express";
import {
  markMessageRead,
  readMailbox,
  readMailboxAttachment,
  sendMessage,
  updateSentMessage,
  writeMailbox,
} from "../controllers/mail.controller.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireSameOrigin } from "../middleware/require-same-origin.js";

const router = Router();

router.get("/mailbox", authenticate, readMailbox);
router.put("/mailbox", authenticate, writeMailbox);
router.post("/mailbox/send", authenticate, requireSameOrigin, sendMessage);
router.patch("/mailbox/messages/:messageId/read", authenticate, requireSameOrigin, markMessageRead);
router.patch("/mailbox/messages/:messageId", authenticate, requireSameOrigin, updateSentMessage);
router.get("/mailbox/messages/:messageId/attachments/:attachmentId", authenticate, readMailboxAttachment);

export default router;