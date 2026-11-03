import { loadProfile, saveProfile } from "./account-profile.js";
import { redirectToLoginIfUnauthorized } from "./api-client.js";
import { getProfileStickerSymbol, PROFILE_STICKERS } from "./profile-stickers.js";

const form = document.querySelector("[data-profile-form]");
const dialog = document.querySelector("[data-profile-dialog]");
const status = document.querySelector("[data-profile-status]");
const avatar = document.querySelector("[data-profile-avatar]");
const avatarInitial = document.querySelector("[data-profile-initial]");
const avatarPhoto = document.querySelector("[data-profile-photo]");
const avatarSticker = document.querySelector("[data-profile-sticker]");
const editPhotoInitial = document.querySelector("[data-edit-photo-initial]");
const editPhoto = document.querySelector("[data-edit-photo]");
const editPhotoSticker = document.querySelector("[data-edit-photo-sticker]");
const photoInput = document.querySelector("[data-photo-input]");
const removePhoto = document.querySelector("[data-remove-photo]");
const stickerPicker = document.querySelector("[data-profile-sticker-picker]");
const displayName = document.querySelector("[data-profile-name]");
const displayEmail = document.querySelector("[data-profile-email]");
const displayBio = document.querySelector("[data-profile-bio]");
const detailName = document.querySelector("[data-profile-detail-name]");
const detailEmail = document.querySelector("[data-profile-detail-email]");
const detailBio = document.querySelector("[data-profile-detail-bio]");
const detailPosition = document.querySelector("[data-profile-detail-position]");
const detailPhone = document.querySelector("[data-profile-detail-phone]");
const detailLocation = document.querySelector("[data-profile-detail-location]");
const adminLink = document.querySelector("[data-admin-link]");
const saveButton = form.querySelector('[type="submit"]');

let profile;
let editingPhoto = "";
let editingSticker = "";
let photoRevision = 0;

function setAvatar(container, initialTarget, image, stickerTarget, name, photo, stickerId) {
  const initial = name.trim().charAt(0).toLocaleUpperCase() || "?";
  const symbol = getProfileStickerSymbol(stickerId);
  initialTarget.textContent = initial;
  image.hidden = !photo;
  stickerTarget.textContent = symbol;
  stickerTarget.hidden = !symbol;
  initialTarget.hidden = Boolean(photo || symbol);
  container.classList.toggle("has-avatar-photo", Boolean(photo));
  container.classList.toggle("has-avatar-sticker", Boolean(symbol));
  if (photo) image.src = photo;
  else image.removeAttribute("src");
}

function renderStickerPicker() {
  const options = [
    { id: "", label: "No sticker", symbol: "×" },
    ...PROFILE_STICKERS,
  ];
  stickerPicker.replaceChildren();
  for (const sticker of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "profile-sticker-option";
    button.dataset.stickerId = sticker.id;
    button.setAttribute("aria-label", sticker.label);
    button.setAttribute("aria-pressed", String(editingSticker === sticker.id));
    button.title = sticker.label;
    button.textContent = sticker.symbol;
    button.addEventListener("click", () => {
      editingSticker = sticker.id;
      renderStickerPicker();
      renderPhotoPreview(editingPhoto);
    });
    stickerPicker.append(button);
  }
}

function renderProfile(savedProfile) {
  profile = savedProfile;
  setAvatar(avatar, avatarInitial, avatarPhoto, avatarSticker, profile.name, profile.profilePhoto, profile.avatarSticker);
  displayName.textContent = profile.name;
  displayEmail.textContent = profile.email;
  displayBio.textContent = profile.bio || "Add a short introduction to say hello to your team.";
  detailName.textContent = profile.name;
  detailEmail.textContent = profile.email;
  detailBio.textContent = profile.bio || "Not added yet";
  detailPosition.textContent = profile.position || "Not added yet";
  detailPhone.textContent = profile.phone || "Not added yet";
  detailLocation.textContent = profile.location || "Not added yet";
}

function renderPhotoPreview(photo) {
  const name = form.elements.name.value || profile?.name || "?";
  setAvatar(
    document.querySelector(".profile-photo-preview"),
    editPhotoInitial,
    editPhoto,
    editPhotoSticker,
    name,
    photo,
    editingSticker,
  );
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("The selected photo could not be read.")));
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The selected photo could not be processed."));
    }, "image/jpeg", quality);
  });
}

async function preparePhoto(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPEG, PNG, or WebP photo.");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Choose a photo smaller than 10 MB.");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth > 10_000 ||
      image.naturalHeight > 10_000
    ) {
      throw new Error("This photo has unsupported dimensions.");
    }

    const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = (image.naturalWidth - cropSize) / 2;
    const sourceY = (image.naturalHeight - cropSize) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photo processing is not available in this browser.");
    context.drawImage(image, sourceX, sourceY, cropSize, cropSize, 0, 0, 512, 512);

    let blob = await canvasToBlob(canvas, 0.82);
    if (blob.size > 256 * 1024) {
      canvas.width = 384;
      canvas.height = 384;
      context.drawImage(image, sourceX, sourceY, cropSize, cropSize, 0, 0, 384, 384);
      blob = await canvasToBlob(canvas, 0.68);
    }
    if (blob.size > 256 * 1024) {
      throw new Error("This photo is still too large after compression. Choose a smaller image.");
    }
    return await readFileAsDataUrl(blob);
  } catch (error) {
    if (error instanceof Error && error.message) throw error;
    throw new Error("The selected photo could not be processed.");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function initialize() {
  try {
    const loadedProfile = await loadProfile();
    if (loadedProfile.role === "admin") adminLink.hidden = false;
    form.elements.name.value = loadedProfile.name;
    form.elements.email.value = loadedProfile.email;
    form.elements.bio.value = loadedProfile.bio;
    form.elements.position.value = loadedProfile.position;
    form.elements.phone.value = loadedProfile.phone;
    form.elements.location.value = loadedProfile.location;
    editingSticker = loadedProfile.avatarSticker;
    renderStickerPicker();
    renderProfile(loadedProfile);
  } catch (error) {
    if (redirectToLoginIfUnauthorized(error)) return;
    console.error("Could not read the saved mail profile.", error);
    status.textContent = error.message || "Your saved profile could not be loaded.";
  }
}
void initialize();

document.querySelectorAll("[data-edit-profile]").forEach((button) => {
  button.addEventListener("click", () => {
    status.textContent = "";
    editingPhoto = profile?.profilePhoto ?? "";
    editingSticker = profile?.avatarSticker ?? "";
    photoInput.value = "";
    renderStickerPicker();
    renderPhotoPreview(editingPhoto);
    dialog.showModal();
    form.elements.name.focus();
  });
});
document.querySelectorAll("[data-close-profile]").forEach((button) => {
  button.addEventListener("click", () => dialog.close());
});

photoInput.addEventListener("change", async () => {
  const file = photoInput.files?.[0];
  if (!file) return;
  const revision = ++photoRevision;
  status.textContent = "Preparing your photo…";
  try {
    const photo = await preparePhoto(file);
    if (revision !== photoRevision) return;
    editingPhoto = photo;
    renderPhotoPreview(editingPhoto);
    status.textContent = "";
  } catch (error) {
    if (revision !== photoRevision) return;
    console.error("Could not prepare the profile photo.", error);
    status.textContent = error.message || "The selected photo could not be processed.";
    photoInput.value = "";
  }
});

removePhoto.addEventListener("click", () => {
  photoRevision += 1;
  editingPhoto = "";
  photoInput.value = "";
  renderPhotoPreview("");
});

form.elements.name.addEventListener("input", () => renderPhotoPreview(editingPhoto));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity() || !profile) return;

  const formData = new FormData(form);
  saveButton.disabled = true;
  saveButton.textContent = "Saving…";
  try {
    const updatedProfile = await saveProfile({
      name: formData.get("name"),
      email: formData.get("email"),
      bio: formData.get("bio"),
      position: formData.get("position"),
      phone: formData.get("phone"),
      location: formData.get("location"),
      profilePhoto: editingPhoto,
      avatarSticker: editingSticker,
    });
    renderProfile(updatedProfile);
    status.textContent = "Your profile is up to date.";
    dialog.close();
  } catch (error) {
    if (redirectToLoginIfUnauthorized(error)) return;
    console.error("Could not save the mail profile.", error);
    status.textContent = error.message || "Your profile could not be saved.";
  } finally {
    saveButton.disabled = false;
    saveButton.innerHTML = 'Save changes <span aria-hidden="true">→</span>';
  }
});
