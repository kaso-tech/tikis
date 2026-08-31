import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const buttonSource = source("components/tikis/ui.tsx");
const themeSource = source("lib/use-theme-colors.ts");
const createDeliverySource = source("app/create-delivery.tsx");
const addressesSource = source("app/(tabs)/addresses.tsx");
const contactSource = source("app/contact.tsx");
const reviewSource = source("app/review/[id].tsx");
const reportSource = source("app/report/[id].tsx");
const profileSource = source("app/(tabs)/profile.tsx");
const walletSource = source("app/(tabs)/wallet.tsx");
const nativeHomeSource = source("components/tikis/screens/home-screen.native.tsx");
const webHomeSource = source("components/tikis/screens/home-screen.web.tsx");
const placeSheetSource = source("components/tikis/place-sheets.tsx");
const pickerNativeSource = source("components/tikis/place-picker.native.tsx");
const pickerWebSource = source("components/tikis/place-picker.web.tsx");
const yangoSource = source("components/tikis/yango-address-picker.tsx");
const authSource = source("components/tikis/auth-flow.tsx");

describe("palette des champs et menus", () => {
  it("expose le fond crème comme token d’entrée", () => {
    expect(themeSource).toContain('input: scheme === "light" ? "#F7EFE5" : "#3A2B1A"');
  });

  it("harmonise les formulaires principaux", () => {
    for (const formSource of [createDeliverySource, contactSource, reviewSource, reportSource, profileSource, walletSource]) {
      expect(formSource).toContain("#F7EFE5");
      expect(formSource).toContain("#9A6201");
    }
  });

  it("harmonise les recherches et sélecteurs de lieux sur mobile et web", () => {
    expect(addressesSource).toContain("backgroundColor: theme.input");
    expect(yangoSource).toContain("backgroundColor: theme.input");
    for (const pickerSource of [placeSheetSource, pickerNativeSource, pickerWebSource, nativeHomeSource, webHomeSource]) {
      expect(pickerSource).toContain("#F7EFE5");
      expect(pickerSource).toContain("#9A6201");
    }
  });

  it("ne modifie pas la palette de fond des boutons d’authentification", () => {
    expect((authSource.match(/<TikisButton authStyle/g) ?? []).length).toBe(6);
    expect(buttonSource).toContain('authStyle && variant === "primary"');
    expect(buttonSource).toContain('background: "#9A6201", foreground: "#FFFFFF"');
  });
});
