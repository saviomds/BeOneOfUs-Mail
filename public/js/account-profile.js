import { apiRequest } from "./api-client.js";

export async function loadProfile() {
  const { user } = await apiRequest("/api/users/me");
  return {
    name: user.name,
    email: user.email,
    bio: user.bio,
    phone: user.phone ?? "",
    location: user.location ?? "",
    position: user.position ?? "",
    profilePhoto: user.profilePhoto ?? "",
    avatarSticker: user.avatarSticker ?? "",
    role: user.role,
  };
}

export async function saveProfile({
  name,
  email,
  bio = "",
  phone = "",
  location = "",
  position = "",
  profilePhoto,
  avatarSticker = "",
}) {
  const { user } = await apiRequest("/api/users/me", {
    method: "PUT",
    body: { name, email, bio, phone, location, position, profilePhoto, avatarSticker },
  });
  return {
    name: user.name,
    email: user.email,
    bio: user.bio,
    phone: user.phone ?? "",
    location: user.location ?? "",
    position: user.position ?? "",
    profilePhoto: user.profilePhoto ?? "",
    avatarSticker: user.avatarSticker ?? "",
    role: user.role,
  };
}
