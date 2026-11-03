export function requireAdmin(request, response, next) {
  if (request.user?.role === "admin") {
    next();
    return;
  }
  if (request.path === "/admin") {
    response.redirect("/inbox");
    return;
  }
  response.status(403).json({ error: "Admin access is required." });
}
