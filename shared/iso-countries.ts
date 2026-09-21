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
 * Cette table ne porte que ce dont on est sûr et qui ne bouge pas : le code, le
 * nom et l'indicatif. Le nombre de chiffres, les groupes d'affichage et les
 * fuseaux restent saisis par l'administrateur, qui les connaît mieux que nous
 * et qui peut les vérifier sur place.
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
};

export const ISO_COUNTRIES: IsoCountry[] = [
  // Afrique de l'Ouest
  { id: "BJ", name: "Bénin", dialCode: "+229" },
  { id: "BF", name: "Burkina Faso", dialCode: "+226" },
  { id: "CV", name: "Cabo Verde", dialCode: "+238", aliases: ["cap vert", "cap-vert"] },
  { id: "CI", name: "Côte d’Ivoire", dialCode: "+225", aliases: ["cote d ivoire", "cote divoire"] },
  { id: "GM", name: "Gambie", dialCode: "+220" },
  { id: "GH", name: "Ghana", dialCode: "+233" },
  { id: "GN", name: "Guinée", dialCode: "+224", aliases: ["guinee conakry"] },
  { id: "GW", name: "Guinée-Bissau", dialCode: "+245" },
  { id: "LR", name: "Liberia", dialCode: "+231", aliases: ["libéria"] },
  { id: "ML", name: "Mali", dialCode: "+223" },
  { id: "MR", name: "Mauritanie", dialCode: "+222" },
  { id: "NE", name: "Niger", dialCode: "+227" },
  { id: "NG", name: "Nigeria", dialCode: "+234", aliases: ["nigéria"] },
  { id: "SN", name: "Sénégal", dialCode: "+221" },
  { id: "SL", name: "Sierra Leone", dialCode: "+232" },
  { id: "TG", name: "Togo", dialCode: "+228" },
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
  { id: "FR", name: "France", dialCode: "+33" },
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
