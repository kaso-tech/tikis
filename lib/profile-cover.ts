import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_PREFIX = "tikis.profile-cover.";

function keyFor(profilePhone: string) {
  return `${KEY_PREFIX}${profilePhone}`;
}

export type StoredProfileCover = {
  base64: string;
  mime: "image/jpeg" | "image/png" | "image/webp";
  updatedAt: string;
};

export async function loadProfileCover(profilePhone: string): Promise<StoredProfileCover | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(profilePhone));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredProfileCover;
    if (!parsed.base64 || !parsed.mime) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveProfileCover(profilePhone: string, cover: StoredProfileCover): Promise<void> {
  await AsyncStorage.setItem(keyFor(profilePhone), JSON.stringify(cover));
}

export async function clearProfileCover(profilePhone: string): Promise<void> {
  await AsyncStorage.removeItem(keyFor(profilePhone));
}
