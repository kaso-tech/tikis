import type { ComponentType } from "react";

import type { LocationLabel } from "@/shared/tikis-domain";

/** Le composant n'existe qu'en variantes de plateforme (`.native.tsx` / `.web.tsx`) : Metro les résout
 *  à la compilation du bundle, mais TypeScript a besoin de cette déclaration pour le spécificateur nu
 *  `@/components/tikis/place-picker`. Même dispositif que live-tracking-screen.d.ts. */
type PlacePickerProps = {
  label: string;
  tone: "pickup" | "dropoff";
  value: LocationLabel | null;
  countryCode?: string;
  onChange: (place: LocationLabel) => void;
};

export declare const PlacePicker: ComponentType<PlacePickerProps>;
