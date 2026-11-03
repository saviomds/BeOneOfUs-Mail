import { apiRequest } from "./api-client.js";

const requestForm = document.querySelector("[data-reset-request-form]");
const requestStatus = document.querySelector("[data-reset-request-status]");
if (requestForm) {
  const submitButton = requestForm.querySelector('[type="submit"]');
  requestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!requestForm.reportValidity()) return;

    submitButton.disabled = true;
    requestStatus.textContent = "Sending your reset link…";
    try {
      const formData = new FormData(requestForm);
      const result = await apiRequest("/api/auth/password-reset/request", {
        method: "POST",
        body: { email: formData.get("email") },
      });
      requestStatus.textContent = result.message;
    } catch (error) {
      console.error("Could not request a password reset.", error);
      requestStatus.textContent = error.message || "The reset link could not be sent.";
      submitButton.disabled = false;
    }
  });
}

const resetForm = document.querySelector("[data-reset-password-form]");
if (resetForm) {
  const status = document.querySelector("[data-reset-password-status]");
  const submitButton = resetForm.querySelector('[type="submit"]');
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
  if (!token) {
    status.textContent = "This reset link is invalid or has expired. Request a new link to continue.";
    submitButton.disabled = true;
  }

  resetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!resetForm.reportValidity() || !token) return;

    submitButton.disabled = true;
    status.textContent = "Resetting your password…";
    try {
      const formData = new FormData(resetForm);
      const result = await apiRequest("/api/auth/password-reset/confirm", {
        method: "POST",
        body: { token, password: formData.get("password") },
      });
      status.textContent = result.message;
      resetForm.reset();
    } catch (error) {
      console.error("Could not reset the password.", error);
      status.textContent = error.message || "Your password could not be reset.";
      submitButton.disabled = false;
    }
  });
}
