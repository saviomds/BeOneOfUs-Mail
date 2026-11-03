import { apiRequest } from "./api-client.js";

const form = document.querySelector("[data-login-form]");
const status = document.querySelector("[data-login-status]");
const submitButton = form.querySelector('[type="submit"]');

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  const formData = new FormData(form);
  submitButton.disabled = true;
  status.textContent = "Signing you in…";
  try {
    const { user } = await apiRequest("/api/auth/login", {
      method: "POST",
      body: {
        email: formData.get("email"),
        password: formData.get("password"),
      },
    });
    window.location.assign(user.role === "admin" ? "/admin" : "/inbox");
  } catch (error) {
    console.error("Could not sign in.", error);
    status.textContent = error.message || "Sign in failed. Check your details and try again.";
    submitButton.disabled = false;
  }
});
