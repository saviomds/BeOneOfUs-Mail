import { randomUUID, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { AccountError } from "./errors.js";
import { withDatabase } from "./json-database.service.js";
import { PROFILE_STICKERS } from "../public/js/profile-stickers.js";

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;
export const COMPANY_EMAIL_DOMAIN = "beoneofus.com";
const PROFILE_STICKER_IDS = new Set(PROFILE_STICKERS.map(({ id }) => id));

async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const derivedKey = await scrypt(password, salt, PASSWORD_KEY_LENGTH);
  return { salt, hash: derivedKey.toString("hex") };
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    bio: user.bio ?? "",
    phone: user.phone ?? "",
    location: user.location ?? "",
    position: user.position ?? "",
    profilePhoto: user.profilePhoto ?? "",
    avatarSticker: user.avatarSticker ?? "",
    status: user.status ?? "pending",
    role: user.role ?? "member",
  };
}

export async function registerAccount({ name, email, password }) {
  if (typeof name !== "string" || typeof email !== "string") {
    throw new AccountError("Enter your name and a valid email address.");
  }
  const normalizedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedName.length < 2 || normalizedName.length > 80) {
    throw new AccountError("Enter a name between 2 and 80 characters.");
  }
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
    normalizedEmail.length > 254 ||
    !normalizedEmail.endsWith(`@${COMPANY_EMAIL_DOMAIN}`)
  ) {
    throw new AccountError(`Use your BeOneOfUs company address (@${COMPANY_EMAIL_DOMAIN}).`);
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw new AccountError("Password must be between 8 and 128 characters.");
  }

  const credentials = await hashPassword(password);
  return withDatabase((database) => {
    if (database.users.some((user) => user.email === normalizedEmail)) {
      throw new AccountError("An account with that email already exists.", 409);
    }
    const user = {
      id: `user-${randomUUID()}`,
      name: normalizedName,
      email: normalizedEmail,
      bio: "",
      role: "member",
      status: "pending",
      passwordSalt: credentials.salt,
      passwordHash: credentials.hash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    database.users.push(user);
    database.notifications.push({
      id: `notification-${randomUUID()}`,
      type: "registration_pending",
      userId: user.id,
      title: "New access request",
      message: `${normalizedName} requested a BeOneOfUs Mail account.`,
      createdAt: new Date().toISOString(),
      readAt: null,
    });
    return publicUser(user);
  });
}

export async function authenticateAccount({ email, password }) {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw new AccountError("Email or password is incorrect.", 401);
  }
  const user = await withDatabase((database) =>
    database.users.find((item) => item.email === normalizedEmail),
  );
  if (!user) throw new AccountError("Email or password is incorrect.", 401);
  const supplied = await hashPassword(password, user.passwordSalt);
  const expectedBuffer = Buffer.from(user.passwordHash, "hex");
  const suppliedBuffer = Buffer.from(supplied.hash, "hex");
  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    throw new AccountError("Email or password is incorrect.", 401);
  }
  const status = user.status ?? "pending";
  if (status === "pending") {
    throw new AccountError("Your account is awaiting admin approval.", 403);
  }
  if (status !== "approved") {
    throw new AccountError("Your account is not approved for BeOneOfUs Mail.", 403);
  }
  return publicUser(user);
}

export async function verifyAccountPassword(userId, password) {
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw new AccountError("Admin password confirmation is required.", 403);
  }
  const user = await withDatabase((database) =>
    database.users.find((item) => item.id === userId),
  );
  if (!user || (user.role ?? "member") !== "admin" || (user.status ?? "pending") !== "approved") {
    throw new AccountError("Admin access is no longer available.", 403);
  }
  const supplied = await hashPassword(password, user.passwordSalt);
  const expectedBuffer = Buffer.from(user.passwordHash, "hex");
  const suppliedBuffer = Buffer.from(supplied.hash, "hex");
  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    throw new AccountError("Admin password confirmation failed.", 403);
  }
}

function normalizeOptionalField(value, label, maxLength) {
  if (value !== undefined && typeof value !== "string") {
    throw new AccountError(`${label} must be text.`);
  }
  const normalized = (value ?? "").trim();
  if (normalized.length > maxLength) {
    throw new AccountError(`${label} must be ${maxLength} characters or fewer.`);
  }
  return normalized;
}

function validateProfilePhoto(profilePhoto) {
  if (profilePhoto === undefined) return undefined;
  if (profilePhoto === null || profilePhoto === "") return "";
  if (typeof profilePhoto !== "string" || profilePhoto.length > 350_000) {
    throw new AccountError("Profile photos must be JPEG images under 256 KB.");
  }
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(profilePhoto);
  if (!match) throw new AccountError("Profile photos must be JPEG images.");
  const bytes = Buffer.from(match[1], "base64");
  if (
    bytes.length > 256 * 1024 ||
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[2] !== 0xff ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  ) {
    throw new AccountError("Profile photos must be valid JPEG images under 256 KB.");
  }
  return profilePhoto;
}

function validateAvatarSticker(avatarSticker) {
  if (avatarSticker === undefined) return undefined;
  if (avatarSticker === null || avatarSticker === "") return "";
  if (typeof avatarSticker !== "string" || !PROFILE_STICKER_IDS.has(avatarSticker)) {
    throw new AccountError("Choose one of the available profile avatar stickers.");
  }
  return avatarSticker;
}

export async function updateAccountProfile(userId, {
  name,
  email,
  bio,
  phone,
  location,
  position,
  profilePhoto,
  avatarSticker,
}) {
  if (typeof name !== "string" || typeof email !== "string") {
    throw new AccountError("Enter a name and your company email address.");
  }
  const normalizedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedBio = normalizeOptionalField(bio, "Your introduction", 240);
  const normalizedPhone = normalizeOptionalField(phone, "Phone number", 32);
  const normalizedLocation = normalizeOptionalField(location, "Location", 100);
  const normalizedPosition = normalizeOptionalField(position, "Position", 100);
  const normalizedPhoto = validateProfilePhoto(profilePhoto);
  const normalizedAvatarSticker = validateAvatarSticker(avatarSticker);
  if (normalizedName.length < 2 || normalizedName.length > 80) {
    throw new AccountError("Enter a name between 2 and 80 characters.");
  }
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
    normalizedEmail.length > 254 ||
    !normalizedEmail.endsWith(`@${COMPANY_EMAIL_DOMAIN}`)
  ) {
    throw new AccountError(`Use your BeOneOfUs company address (@${COMPANY_EMAIL_DOMAIN}).`);
  }
  if (normalizedBio.length > 240) {
    throw new AccountError("Your introduction must be 240 characters or fewer.");
  }
  if (normalizedPhone && !/^[+()\d.\-\s]{7,32}$/.test(normalizedPhone)) {
    throw new AccountError("Enter a valid phone number using digits and common phone symbols.");
  }

  return withDatabase((database) => {
    const user = database.users.find((item) => item.id === userId);
    if (!user) throw new AccountError("Your account could not be found.", 404);
    if (normalizedEmail !== user.email) {
      throw new AccountError("Company email addresses cannot be changed from your profile.", 403);
    }
    if (database.users.some((item) => item.id !== userId && item.email === normalizedEmail)) {
      throw new AccountError("That email address is already in use.", 409);
    }
    user.name = normalizedName;
    user.bio = normalizedBio;
    user.phone = normalizedPhone;
    user.location = normalizedLocation;
    user.position = normalizedPosition;
    if (normalizedPhoto !== undefined) user.profilePhoto = normalizedPhoto;
    if (normalizedAvatarSticker !== undefined) user.avatarSticker = normalizedAvatarSticker;
    user.updatedAt = new Date().toISOString();
    return publicUser(user);
  });
}

export { AccountError, publicUser };
