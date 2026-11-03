export const PROFILE_STICKERS = Object.freeze([
  { id: "sparkle", label: "Sparkle", symbol: "✨" },
  { id: "orbit", label: "Orbit", symbol: "🪐" },
  { id: "rocket", label: "Rocket", symbol: "🚀" },
  { id: "leaf", label: "Leaf", symbol: "🌿" },
  { id: "sunshine", label: "Sunshine", symbol: "☀️" },
  { id: "purple-heart", label: "Purple heart", symbol: "💜" },
  { id: "lightbulb", label: "Bright idea", symbol: "💡" },
  { id: "star", label: "Star", symbol: "🌟" },
  { id: "flower", label: "Flower", symbol: "🌸" },
  { id: "coffee", label: "Coffee", symbol: "☕" },
  { id: "wave", label: "Wave", symbol: "🌊" },
  { id: "celebrate", label: "Celebrate", symbol: "🎉" },
]);

export function getProfileStickerSymbol(stickerId) {
  return PROFILE_STICKERS.find((sticker) => sticker.id === stickerId)?.symbol ?? "";
}
