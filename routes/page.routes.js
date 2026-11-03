import { Router } from "express";
import { fileURLToPath } from "node:url";
import { authenticatePage } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-admin.js";
import {
  renderForgotPasswordPage,
  renderHelpPage,
  renderHomePage,
  renderInboxPage,
  renderLoginPage,
  renderProfilePage,
  renderRegisterPage,
  renderResetPasswordPage,
} from "../controllers/page.controller.js";

const router = Router();

router.get(["/", "/index.html"], renderHomePage);
router.get(["/inbox", "/inbox.html"], renderInboxPage);
router.get(["/login", "/login.html"], renderLoginPage);
router.get(["/register", "/register.html"], renderRegisterPage);
router.get(["/profile", "/profile.html"], renderProfilePage);
router.get("/admin", authenticatePage, requireAdmin, (_request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.sendFile("admin.html", { root: fileURLToPath(new URL("../views/", import.meta.url)) });
});
router.get(["/help", "/help.html"], renderHelpPage);
router.get(
  ["/forget-password", "/forget-password.html"],
  renderForgotPasswordPage,
);
router.get(["/reset-password", "/reset-password.html"], renderResetPasswordPage);

export default router;
