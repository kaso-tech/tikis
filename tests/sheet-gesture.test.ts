import { describe, expect, it } from "vitest";
import { nextSheetLevel, sheetDragOffset, SHEET_DRAG_LIMIT } from "../lib/sheet-gesture";

/**
 * La feuille de suivi partait à l'inverse du doigt : tirée vers le bas elle
 * montait, tirée vers le haut elle descendait. Sa hauteur est animée alors
 * qu'elle est ancrée en bas, donc un `dy` positif (doigt vers le bas) doit
 * la faire rétrécir — le signe manquait.
 */
describe("glissement de la feuille de suivi", () => {
  it("rétrécit la feuille quand le doigt descend", () => {
    expect(sheetDragOffset(40)).toBe(-40);
  });

  it("agrandit la feuille quand le doigt monte", () => {
    expect(sheetDragOffset(-40)).toBe(40);
  });

  it("borne le suivi au doigt dans les deux sens", () => {
    expect(sheetDragOffset(400)).toBe(-SHEET_DRAG_LIMIT);
    expect(sheetDragOffset(-400)).toBe(SHEET_DRAG_LIMIT);
  });

  it("ignore une valeur non exploitable", () => {
    expect(sheetDragOffset(Number.NaN)).toBe(0);
  });
});

describe("palier atteint au relâchement", () => {
  it("monte d’un palier sur un geste franc vers le haut", () => {
    expect(nextSheetLevel("mini", -60, 0)).toBe("mid");
    expect(nextSheetLevel("mid", -60, 0)).toBe("full");
  });

  it("descend d’un palier sur un geste franc vers le bas", () => {
    expect(nextSheetLevel("full", 60, 0)).toBe("mid");
    expect(nextSheetLevel("mid", 60, 0)).toBe("mini");
  });

  it("suffit d’un geste rapide, même court", () => {
    expect(nextSheetLevel("mid", -5, -1.2)).toBe("full");
    expect(nextSheetLevel("mid", 5, 1.2)).toBe("mini");
  });

  it("ne dépasse pas les paliers extrêmes", () => {
    expect(nextSheetLevel("full", -60, 0)).toBe("full");
    expect(nextSheetLevel("mini", 60, 0)).toBe("mini");
  });

  it("reste en place sur un geste trop faible", () => {
    expect(nextSheetLevel("mid", 10, 0.1)).toBe("mid");
    expect(nextSheetLevel("mid", 0, 0)).toBe("mid");
  });
});
