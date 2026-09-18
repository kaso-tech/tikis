/**
 * Gestes de la feuille de suivi : la géométrie du glissement, isolée du rendu.
 *
 * La feuille est ancrée en bas et c'est sa *hauteur* qui est animée. Un geste
 * vers le bas (`dy` positif) doit donc la faire **rétrécir**, pas grandir : le
 * doigt et le bord supérieur de la feuille descendent ensemble. La conversion
 * est ici plutôt que dans le composant, pour être vérifiable.
 */

export type SheetLevel = "mini" | "mid" | "full";

/** Amplitude du suivi au doigt avant le relâchement, en points. */
export const SHEET_DRAG_LIMIT = 50;

/**
 * Le décalage de hauteur à appliquer pendant le glissement, pour un `dy` de
 * PanResponder (positif vers le bas).
 *
 * Le signe était omis : glisser vers le bas agrandissait la feuille et glisser
 * vers le haut la réduisait, donc elle partait à l'inverse du doigt.
 */
export function sheetDragOffset(dy: number, limit: number = SHEET_DRAG_LIMIT): number {
  if (!Number.isFinite(dy)) return 0;
  return Math.max(-limit, Math.min(limit, -dy));
}

/**
 * Le palier atteint au relâchement. Un geste franc (`dy`) ou rapide (`vy`)
 * fait passer au palier voisin ; sinon on reste où l'on était.
 *
 * `dy` et `vy` gardent la convention PanResponder : positifs vers le bas.
 */
export function nextSheetLevel(
  level: SheetLevel,
  dy: number,
  vy: number,
  options: { distance?: number; velocity?: number } = {},
): SheetLevel {
  const { distance = 30, velocity = 0.5 } = options;
  const up = dy < -distance || vy < -velocity;
  const down = dy > distance || vy > velocity;
  if (up && !down) {
    if (level === "mini") return "mid";
    if (level === "mid") return "full";
    return "full";
  }
  if (down && !up) {
    if (level === "full") return "mid";
    if (level === "mid") return "mini";
    return "mini";
  }
  return level;
}
