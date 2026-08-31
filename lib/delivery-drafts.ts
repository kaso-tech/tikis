import AsyncStorage from "@react-native-async-storage/async-storage";
import type { LocationLabel } from "@/shared/tikis-domain";

export type DeliveryDraft = {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  details: string;
  deliveryType: "Plis" | "Personne" | "Autre";
  vehicle: "Vélo" | "Moto" | "Tricycle" | "Voiture";
  pickup: LocationLabel | null;
  dropoff: LocationLabel | null;
  weightKg?: string;
  lengthCm?: string;
  widthCm?: string;
  heightCm?: string;
  passengers?: string;
  offeredPriceInput?: string;
};

const KEY_PREFIX = "tikis.delivery-drafts.";

function keyFor(profilePhone: string) {
  return `${KEY_PREFIX}${profilePhone}`;
}

export async function listDeliveryDrafts(profilePhone: string): Promise<DeliveryDraft[]> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(profilePhone));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DeliveryDraft[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveDeliveryDraft(profilePhone: string, draft: DeliveryDraft): Promise<void> {
  const existing = await listDeliveryDrafts(profilePhone);
  const filtered = existing.filter((item) => item.id !== draft.id);
  filtered.unshift(draft);
  await AsyncStorage.setItem(keyFor(profilePhone), JSON.stringify(filtered.slice(0, 20)));
}

export async function deleteDeliveryDraft(profilePhone: string, draftId: string): Promise<void> {
  const existing = await listDeliveryDrafts(profilePhone);
  const filtered = existing.filter((item) => item.id !== draftId);
  await AsyncStorage.setItem(keyFor(profilePhone), JSON.stringify(filtered));
}

export async function getDeliveryDraft(profilePhone: string, draftId: string): Promise<DeliveryDraft | null> {
  const existing = await listDeliveryDrafts(profilePhone);
  return existing.find((item) => item.id === draftId) ?? null;
}
