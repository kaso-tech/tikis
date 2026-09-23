import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APPROACH_MAX_AGE_MS, APPROACH_MIN_MOVE_METERS, shouldRefreshApproach } from "../lib/route-refresh";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/**
 * Ce qui tient la facture Mapbox.
 *
 * Le rendu de carte est chez Google, où il est gratuit sur mobile natif ; tout ce qui est facturé
 * est chez Mapbox (Search Box, Geocoding, Directions). Ces garde-fous protègent donc les seuls
 * appels qui coûtent quelque chose, et chacun corrige une dépense qui était bien réelle.
 */
describe("appels Mapbox facturés", () => {
  const picker = read("components/tikis/yango-address-picker.tsx");

  it("le sélecteur d'adresse ne lance plus deux recherches par requête saisie", () => {
    // Un second minuteur partait en parallèle du debounce et élargissait systématiquement, ce qui
    // valait trois appels facturés (suggest, puis suggest + forward) là où un seul suffit.
    expect(picker).not.toContain("expandedSearchTimer");
    expect(picker).toContain("EXPANDED_SEARCH_FROM_BELOW");
  });

  it("n'élargit que lorsque la recherche ordinaire répond mal", () => {
    expect(picker).toContain("found >= EXPANDED_SEARCH_FROM_BELOW) return;");
    // Le repli reste déclenchable à la main depuis la touche « Rechercher » du clavier.
    expect(picker).toContain("onSubmitEditing={() => void runSearch(query, true)}");
  });

  it("garde le recalcul d'approche piloté par le déplacement, pas par l'horloge", () => {
    // À l'arrêt, le tracé ne change pas : seule la gigue GPS bougeait l'origine, assez pour manquer
    // le cache serveur mais pas assez pour changer le trajet. Une approche de vingt minutes coûtait
    // quatre-vingts appels Directions par écran qui l'affiche.
    expect(APPROACH_MAX_AGE_MS).toBeGreaterThanOrEqual(60_000);
    const anchor = { latitude: 12.3714, longitude: -1.5197, at: 0 };
    // Immobile, une demi-minute plus tard : rien à redemander.
    expect(shouldRefreshApproach(anchor, { latitude: 12.3714, longitude: -1.5197 }, 30_000)).toBe(false);
    // En mouvement : le seuil de distance déclenche, quelle que soit l'horloge.
    const moved = { latitude: anchor.latitude + (APPROACH_MIN_MOVE_METERS + 10) / 111_320, longitude: anchor.longitude };
    expect(shouldRefreshApproach(anchor, moved, 1_000)).toBe(true);
  });

  it("garde un cache d'itinéraires assez long pour servir un corridor répété", () => {
    // Entre deux points fixes seule la durée bouge avec le trafic ; la distance, qui fait le prix,
    // ne change pas. À cinq minutes, une même course était refacturée douze fois par heure.
    const geography = read("server/geography.ts");
    const ttl = /const ROUTE_CACHE_TTL_MS = (\d+) \* 60_000;/.exec(geography);
    expect(ttl).not.toBeNull();
    expect(Number(ttl?.[1])).toBeGreaterThanOrEqual(15);
  });
});
