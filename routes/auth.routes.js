import { Router } from "express";
import {
  currentUser,
  login,
  logout,
  register,
  requestPasswordReset,
  resetPassword,
} from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/authenticate.js";
import {
  rateLimitPasswordReset,
  rateLimitPasswordResetConfirmation,
} from "../middleware/password-reset-rate-limit.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);
router.post("/password-reset/request", rateLimitPasswordReset, requestPasswordReset);
router.post("/password-reset/confirm", rateLimitPasswordResetConfirmation, resetPassword);
router.get("/me", authenticate, currentUser);

export default router;