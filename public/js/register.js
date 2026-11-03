import { apiRequest } from "./api-client.js";

const form = document.querySelector("[data-register-form]");
const status = document.querySelector("[data-profile-status]");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  const formData = new FormData(form);
  const submitButton = form.querySelector('[type="submit"]');
  submitButton.disabled = true;
  status.textContent = "Sending your access request…";
  try {
    const result = await apiRequest("/api/auth/register", {
      method: "POST",
      body: {
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password"),
      },
    });
    form.reset();
    status.textContent = result.message;
    submitButton.disabled = true;
  } catch (error) {
    console.error("Could not save the new mail profile.", error);
    status.textContent = error.message || "Your account could not be created.";
    submitButton.disabled = false;
  }
});
