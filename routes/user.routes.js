import { Router } from "express";
import { userNotifications } from "../controllers/admin.controller.js";
import { updateProfile } from "../controllers/user.controller.js";
import { authenticate } from "../middleware/authenticate.js";

const router = Router();

router.get("/me", authenticate, (request, response) => {
  response.json({ user: request.user });
});
router.put("/me", authenticate, updateProfile);
router.get("/me/notifications", authenticate, userNotifications);

export default router;