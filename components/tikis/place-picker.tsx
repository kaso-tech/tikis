import { Platform } from "react-native";
import { PlacePicker as NativePlacePicker } from "./place-picker.native";
import { PlacePicker as WebPlacePicker } from "./place-picker.web";
import type { LocationLabel } from "@/shared/tikis-domain";

export function PlacePicker({ label, tone, value, countryCode, onChange }: { label: string; tone: "pickup" | "dropoff"; value: LocationLabel | null; countryCode?: string; onChange: (place: LocationLabel) => void }) {
  return Platform.OS === "web" ? <WebPlacePicker label={label} tone={tone} value={value} countryCode={countryCode} onChange={onChange} /> : <NativePlacePicker label={label} tone={tone} value={value} countryCode={countryCode} onChange={onChange} />;
}
