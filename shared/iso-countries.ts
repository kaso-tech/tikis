/**
 * Les codes ISO des pays que Tikis peut servir, et ce qu'ils désignent vraiment.
 *
 * Un pays s'ajoute depuis la console d'administration, dans un formulaire où le
 * code ISO, le nom et l'indicatif se saisissent à la main, sans que rien ne
 * vérifie qu'ils parlent du même pays. « Bénin / BN / +229 » s'enregistrait
 * donc sans broncher — et BN est le Brunei. Conséquences en chaîne, toutes
 * silencieuses : le drapeau affiché est celui du Brunei (`countryFlagEmoji`
 * dérive l'emoji des deux lettres), et la recherche de villes interroge Mapbox
 * avec `country=BN`, qui répond des villes bruneiennes.
 *
 * Les deux confusions qui reviennent : le Bénin est **BJ** (BN = Brunei), et le
 * Niger est **NE** (NG = Nigeria, NI = Nicaragua).
 *
 * Le code, le nom et l'indicatif ne bougent pas : ils sont vérifiés durement.
 * Le plan de numérotation, lui, change — le Bénin est passé de 8 à 10 chiffres
 * fin 2024 — donc `digits` et `groups` ne sont renseignés que là où on les
 * connaît, et seulement pour avertir : c'est l'administrateur qui tranche, et
 * qui doit pouvoir corriger le jour où un pays renumérote à son tour. Les
 * fuseaux restent entièrement à lui.
 */

export type IsoCountry = {
  /** Code ISO 3166-1 alpha-2, en majuscules. */
  id: string;
  /** Nom français usuel. */
  name: string;
  /** Indicatif téléphonique international, avec le « + ». */
  dialCode: string;
  /** Autres graphies acceptées à la saisie (sans accent, abréviations). */
  aliases?: string[];
  /** Longueur du numéro national, quand le plan de numérotation est connu. */
  digits?: number;
  /** Découpage d'affichage correspondant. La somme vaut `digits`. */
  groups?: number[];
  /**
   * Vrai lorsque le plan national commence par un zéro significatif. Au Bénin,
   * tous les numéros commencent par « 01 » depuis la renumérotation : la règle
   * générale, qui refuse un premier chiffre nul pour écarter les préfixes
   * d'acheminement saisis par erreur, y rejetterait tous les numéros.
   */
  allowsLeadingZero?: boolean;
  /** Ce qu'il faut savoir sur ce plan, affiché tel quel à l'administrateur. */
  digitsNote?: string;
};

export const ISO_COUNTRIES: IsoCountry[] = [
  // Afrique de l'Ouest
  { id: "BJ", name: "Bénin", dialCode: "+229", digits: 10, groups: [2, 2, 2, 2, 2], allowsLeadingZero: true, digitsNote: "Depuis la renumérotation de novembre 2024, les numéros béninois font 10 chiffres et commencent par 01." },
  { id: "BF", name: "Burkina Faso", dialCode: "+226", digits: 8, groups: [2, 2, 2, 2] },
  { id: "CV", name: "Cabo Verde", dialCode: "+238", aliases: ["cap vert", "cap-vert"] },
  { id: "CI", name: "Côte d’Ivoire", dialCode: "+225", aliases: ["cote d ivoire", "cote divoire"], digits: 10, groups: [2, 2, 2, 2, 2] },
  { id: "GM", name: "Gambie", dialCode: "+220" },
  { id: "GH", name: "Ghana", dialCode: "+233", digits: 9, groups: [2, 3, 4] },
  { id: "GN", name: "Guinée", dialCode: "+224", aliases: ["guinee conakry"] },
  { id: "GW", name: "Guinée-Bissau", dialCode: "+245" },
  { id: "LR", name: "Liberia", dialCode: "+231", aliases: ["libéria"] },
  { id: "ML", name: "Mali", dialCode: "+223", digits: 8, groups: [2, 2, 2, 2] },
  { id: "MR", name: "Mauritanie", dialCode: "+222" },
  { id: "NE", name: "Niger", dialCode: "+227", digits: 8, groups: [2, 2, 2, 2] },
  { id: "NG", name: "Nigeria", dialCode: "+234", aliases: ["nigéria"] },
  { id: "SN", name: "Sénégal", dialCode: "+221", digits: 9, groups: [2, 3, 2, 2] },
  { id: "SL", name: "Sierra Leone", dialCode: "+232" },
  { id: "TG", name: "Togo", dialCode: "+228", digits: 8, groups: [2, 2, 2, 2] },
  // Afrique centrale
  { id: "CM", name: "Cameroun", dialCode: "+237" },
  { id: "CF", name: "République centrafricaine", dialCode: "+236", aliases: ["centrafrique"] },
  { id: "TD", name: "Tchad", dialCode: "+235" },
  { id: "CG", name: "Congo-Brazzaville", dialCode: "+242", aliases: ["republique du congo"] },
  // « Congo » seul ne désigne ni l'un ni l'autre : laissé sans alias, pour ne pas
  // corriger un administrateur vers le mauvais des deux.
  { id: "CD", name: "République démocratique du Congo", dialCode: "+243", aliases: ["rdc", "congo kinshasa"] },
  { id: "GQ", name: "Guinée équatoriale", dialCode: "+240" },
  { id: "GA", name: "Gabon", dialCode: "+241" },
  { id: "ST", name: "Sao Tomé-et-Principe", dialCode: "+239", aliases: ["sao tome et principe"] },
  // Maghreb et Europe
  { id: "MA", name: "Maroc", dialCode: "+212" },
  { id: "DZ", name: "Algérie", dialCode: "+213" },
  { id: "TN", name: "Tunisie", dialCode: "+216" },
  { id: "FR", name: "France", dialCode: "+33", digits: 9, groups: [1, 2, 2, 2, 2] },
];

/** Réduit un nom à sa forme comparable : sans accent, sans ponctuation, en minuscules. */
export function normalizeCountryName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z]+/g, " ")
    .trim()
    .toLowerCase();
}

export function isoCountry(code: string): IsoCountry | undefined {
  const upper = code.trim().toUpperCase();
  return ISO_COUNTRIES.find((country) => country.id === upper);
}

/** Le pays que ce nom désigne, ou `undefined` si aucun ne correspond sûrement. */
export function isoCountryByName(name: string): IsoCountry | undefined {
  const needle = normalizeCountryName(name);
  if (!needle) return undefined;
  return ISO_COUNTRIES.find((country) =>
    normalizeCountryName(country.name) === needle
    || (country.aliases ?? []).some((alias) => normalizeCountryName(alias) === needle));
}

/** Vrai si ce nom désigne bien ce pays — ou s'il ne désigne aucun pays connu. */
export function countryNameMatches(code: string, name: string): boolean {
  const byName = isoCountryByName(name);
  // Un nom que la table ne connaît pas n'est pas une erreur : ce peut être une
  // graphie locale légitime. On ne se prononce que sur ce qu'on reconnaît.
  if (!byName) return true;
  return byName.id === code.trim().toUpperCase();
}

export type CountryDraft = { id: string; name: string; dialCode: string };

/**
 * Ce qui cloche dans un pays saisi, en une phrase, ou `null` s'il est cohérent.
 *
 * Le message nomme la correction plutôt que de dire « invalide » : c'est la
 * seule façon de rattraper une confusion de code, où tout paraît plausible.
 */
export function countryDraftIssue(draft: CountryDraft): string | null {
  const code = draft.id.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "Le code pays doit être un code ISO à 2 lettres (ex. BF).";

  const known = isoCountry(code);
  const byName = isoCountryByName(draft.name);

  if (!known) {
    if (byName) return `Le code ISO de « ${byName.name} » est ${byName.id}, pas ${code}.`;
    return `Le code ISO ${code} n’est pas un pays desservi par Tikis. Vérifiez-le avant d’enregistrer.`;
  }

  if (byName && byName.id !== code) {
    return `${code} est le code de « ${known.name} », pas de « ${byName.name} » — dont le code est ${byName.id}.`;
  }

  const dial = draft.dialCode.trim();
  if (dial && dial !== known.dialCode) {
    return `L’indicatif de « ${known.name} » est ${known.dialCode}, pas ${dial}.`;
  }

  return null;
}

export type CountryPlanDraft = CountryDraft & { digits?: number; groups?: number[] };

/**
 * Ce qui paraît douteux dans le plan de numérotation saisi, ou `null`.
 *
 * Simple avertissement, jamais un refus : un plan change, et l'administrateur
 * doit pouvoir enregistrer la nouvelle réalité avant que cette table la
 * connaisse.
 */
export function countryPlanWarning(draft: CountryPlanDraft): string | null {
  const known = isoCountry(draft.id);
  if (!known?.digits) return null;

  if (typeof draft.digits === "number" && draft.digits !== known.digits) {
    const note = known.digitsNote ? ` ${known.digitsNote}` : "";
    return `Les numéros de « ${known.name} » font ${known.digits} chiffres, pas ${draft.digits}.${note}`;
  }
  if (draft.groups && known.groups && draft.groups.join(",") !== known.groups.join(",")) {
    return `Le découpage habituel pour « ${known.name} » est ${known.groups.join(",")}.`;
  }
  return null;
}
