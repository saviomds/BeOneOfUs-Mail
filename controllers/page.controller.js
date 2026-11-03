import { fileURLToPath } from "node:url";

const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));

function renderPage(filename) {
  return (_req, res) => {
    res.sendFile(filename, { root: publicDirectory });
  };
}

export const renderHomePage = renderPage("index.html");
export const renderInboxPage = renderPage("inbox.html");
export const renderLoginPage = renderPage("login.html");
export const renderRegisterPage = renderPage("register.html");
export const renderForgotPasswordPage = renderPage("forget-password.html");
export const renderResetPasswordPage = renderPage("reset-password.html");
export const renderProfilePage = renderPage("profile.html");
export const renderHelpPage = renderPage("help.html");
