export function requireSameOrigin(request, response, next) {
  const origin = request.get("origin");
  const host = request.get("host");
  if (!origin || !host) {
    response.status(403).json({ error: "This admin action requires a same-origin request." });
    return;
  }

  try {
    const parsedOrigin = new URL(origin);
    if (
      !["http:", "https:"].includes(parsedOrigin.protocol) ||
      parsedOrigin.host.toLowerCase() !== host.toLowerCase()
    ) {
      response.status(403).json({ error: "This admin action requires a same-origin request." });
      return;
    }
  } catch {
    response.status(403).json({ error: "This admin action requires a same-origin request." });
    return;
  }

  next();
}
