import { updateAccountProfile } from "../services/account.service.js";
import { AccountError } from "../services/errors.js";

export async function updateProfile(request, response) {
  try {
    const user = await updateAccountProfile(request.user.id, request.body ?? {});
    response.json({ user });
  } catch (error) {
    if (error instanceof AccountError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    console.error("Profile update failed.", error);
    response.status(500).json({ error: "Your profile could not be saved." });
  }
}