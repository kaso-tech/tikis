import { Platform } from "react-native";
import type { ComponentType } from "react";
import type { LocationLabel } from "@/shared/tikis-domain";

type AddressMapPickerProps = {
  visible: boolean;
  targetTitle: string;
  initialPlace: LocationLabel | null;
  countryCode?: string;
  onClose: () => void;
  onUse: (place: LocationLabel) => void;
  onFavorite: (place: LocationLabel, label: string) => Promise<void>;
};

const AddressMapPicker = (Platform.OS === "web"
  ? require("./address-map-picker.web").AddressMapPicker
  : require("./address-map-picker.native").AddressMapPicker) as ComponentType<AddressMapPickerProps>;

export { AddressMapPicker };
