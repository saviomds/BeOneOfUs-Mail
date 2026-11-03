import { Router } from "express";
import {
  adminOverview,
  changeAccountStatus,
  editManagedAccountProfile,
  managedAccountProfile,
  sendSmtpTest,
  smtpSettings,
  supabaseSettings,
  testSupabaseConnectionRoute,
  updateSupabaseSettings,
  updateSmtpSettings,
} from "../controllers/admin.controller.js";
import {
  deleteManagedMessage,
  markManagedMessageRead,
  readManagedMailbox,
  readManagedMailboxAttachment,
  updateManagedMessage,
} from "../controllers/mail.controller.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-admin.js";
import { requireSameOrigin } from "../middleware/require-same-origin.js";

const router = Router();

router.use(authenticate, requireAdmin);
router.get("/overview", adminOverview);
router.get("/settings/smtp", smtpSettings);
router.put("/settings/smtp", requireSameOrigin, updateSmtpSettings);
router.post("/settings/smtp/test", requireSameOrigin, sendSmtpTest);
router.get("/settings/database/supabase", supabaseSettings);
router.put("/settings/database/supabase", requireSameOrigin, updateSupabaseSettings);
router.post("/settings/database/supabase/test", requireSameOrigin, testSupabaseConnectionRoute);
router.get("/users/:userId/mailbox", readManagedMailbox);
router.get("/users/:userId/mailbox/messages/:messageId/attachments/:attachmentId", readManagedMailboxAttachment);
router.patch("/users/:userId/mailbox/messages/:messageId/read", requireSameOrigin, markManagedMessageRead);
router.patch("/users/:userId/mailbox/messages/:messageId", requireSameOrigin, updateManagedMessage);
router.delete("/users/:userId/mailbox/messages/:messageId", requireSameOrigin, deleteManagedMessage);
router.get("/users/:userId/profile", managedAccountProfile);
router.patch("/users/:userId/profile", requireSameOrigin, editManagedAccountProfile);
router.patch("/users/:userId/status", requireSameOrigin, changeAccountStatus);

export default router;
