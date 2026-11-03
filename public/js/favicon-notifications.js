const iconPath = "/Logo/logo.png";
const iconLink = document.querySelector('link[rel~="icon"]');
const defaultTitle = document.title;

function faviconDataUrl(count) {
  const label = count > 99 ? "99+" : String(count);
  const width = label.length > 2 ? 80 : 64;
  const badgeX = width - 25;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 64"><rect width="64" height="64" rx="14" fill="#315fe8"/><path d="M13 21h37v25H13z" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><path d="m14 23 17.5 14L49 23" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${badgeX}" cy="14" r="13" fill="#d94358" stroke="#fff" stroke-width="2"/><text x="${badgeX}" y="18" fill="#fff" font-family="Arial,sans-serif" font-size="${label.length > 2 ? 8 : 10}" font-weight="700" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function updateFaviconNotifications(count) {
  if (!iconLink) return;
  const unreadCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (unreadCount === 0) {
    iconLink.href = iconPath;
    iconLink.type = "image/png";
    document.title = defaultTitle;
    return;
  }
  iconLink.href = faviconDataUrl(unreadCount);
  iconLink.type = "image/svg+xml";
  document.title = `(${unreadCount > 99 ? "99+" : unreadCount}) ${defaultTitle}`;
}
