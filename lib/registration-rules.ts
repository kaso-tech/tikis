import type { RegisteredProfile, UserRole, VehicleType } from "@/shared/tikis-domain";

export type CountrySpec = {
  id: string;
  name: string;
  flag: string;
  dialCode: string;
  digits: number;
  groups: number[];
  timeZones: string[];
};

export const COUNTRIES: CountrySpec[] = [
  { id: "BF", name: "Burkina Faso", flag: "BF", dialCode: "+226", digits: 8, groups: [2, 2, 2, 2], timeZones: ["Africa/Ouagadougou"] },
  { id: "CI", name: "Côte d’Ivoire", flag: "CI", dialCode: "+225", digits: 10, groups: [2, 2, 2, 2, 2], timeZones: ["Africa/Abidjan"] },
  { id: "ML", name: "Mali", flag: "ML", dialCode: "+223", digits: 8, groups: [2, 2, 2, 2], timeZones: ["Africa/Bamako"] },
  { id: "SN", name: "Sénégal", flag: "SN", dialCode: "+221", digits: 9, groups: [2, 3, 2, 2], timeZones: ["Africa/Dakar"] },
  { id: "TG", name: "Togo", flag: "TG", dialCode: "+228", digits: 8, groups: [2, 2, 2, 2], timeZones: ["Africa/Lome"] },
  { id: "GH", name: "Ghana", flag: "GH", dialCode: "+233", digits: 9, groups: [2, 3, 4], timeZones: ["Africa/Accra"] },
  { id: "FR", name: "France", flag: "FR", dialCode: "+33", digits: 9, groups: [1, 2, 2, 2, 2], timeZones: ["Europe/Paris"] },
];

export const DEFAULT_COUNTRY = COUNTRIES[0];

/** Convertit un code pays ISO (ex. "BF") en emoji drapeau, sans dépendre d'une donnée par pays :
 *  chaque lettre est mappée sur son "regional indicator symbol" Unicode. */
export function countryFlagEmoji(isoCode: string) {
  if (!/^[A-Za-z]{2}$/.test(isoCode)) return "🏳️";
  return isoCode.toUpperCase().replace(/./g, (letter) => String.fromCodePoint(127397 + letter.charCodeAt(0)));
}

export function detectCountry(timeZone?: string) {
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return COUNTRIES.find((country) => country.timeZones.includes(zone)) ?? DEFAULT_COUNTRY;
}

export function findCountry(dialCode: string) {
  return COUNTRIES.find((country) => country.dialCode === dialCode) ?? DEFAULT_COUNTRY;
}

export function findCountryForPhone(phone: string) {
  return [...COUNTRIES]
    .sort((left, right) => right.dialCode.length - left.dialCode.length)
    .find((country) => phone.startsWith(country.dialCode)) ?? DEFAULT_COUNTRY;
}

export function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

export function sanitizePhoneInput(value: string, country: CountrySpec) {
  return digitsOnly(value).slice(0, country.digits);
}

export function formatLocalPhone(value: string, country: CountrySpec) {
  const digits = sanitizePhoneInput(value, country);
  const parts: string[] = [];
  let cursor = 0;
  for (const size of country.groups) {
    const part = digits.slice(cursor, cursor + size);
    if (part) parts.push(part);
    cursor += size;
  }
  return parts.join(" ");
}

export function normalizedInternationalPhone(value: string, country: CountrySpec) {
  return `${country.dialCode}${sanitizePhoneInput(value, country)}`;
}

export function isValidInternationalPhone(value: string, country: CountrySpec) {
  const localNumber = sanitizePhoneInput(value, country);
  return localNumber.length === country.digits && /^[1-9]\d*$/.test(localNumber);
}

const NAME_PATTERN = /^[\p{L}]+(?:[ '-][\p{L}]+)*$/u;
const ALLOWED_NAME_CHARACTERS = /[^\p{L} '-]/gu;

export function sanitizeFullName(value: string, options: { preserveTrailingSeparator?: boolean } = {}) {
  let sanitized = "";
  for (const character of value.normalize("NFC").replace(/[’‘]/g, "'").replace(ALLOWED_NAME_CHARACTERS, "")) {
    const isLetter = /^\p{L}$/u.test(character);
    if (isLetter) {
      sanitized += character;
      continue;
    }
    const isSeparator = character === " " || character === "-" || character === "'";
    if (isSeparator && sanitized && /^\p{L}$/u.test(sanitized.at(-1) ?? "")) sanitized += character;
  }
  const capped = sanitized.slice(0, 70);
  return options.preserveTrailingSeparator ? capped : capped.replace(/[ '-]+$/g, "");
}

export function validateFullName(value: string) {
  if (/[^\p{L} '’‘-]/u.test(value)) return { valid: false, message: "Le nom contient des caractères non autorisés." };
  const sanitized = sanitizeFullName(value);
  if (sanitized.length < 3 || sanitized.length > 70) return { valid: false, message: "Saisissez un nom entre 3 et 70 caractères." };
  if (!NAME_PATTERN.test(sanitized)) return { valid: false, message: "Utilisez des lettres et un seul séparateur entre les mots." };
  return { valid: true, value: sanitized } as const;
}

export function generateDriverReferralCode(fullName: string, randomNumber = Math.floor(Math.random() * 100000)) {
  const letters = sanitizeFullName(fullName).replace(/[^\p{L}]/gu, "").toLocaleUpperCase("fr-FR").slice(0, 3);
  const digits = String(Math.max(0, Math.min(99999, randomNumber))).padStart(8 - letters.length, "0");
  return `${letters}${digits}`.slice(0, 8);
}

export const SIMULATED_ACCOUNTS: Record<string, RegisteredProfile> = {
  "+22670000000": { fullName: "Aïcha Traoré", phone: "+22670000000", countryCode: "BF", role: "sender", vehicles: [], roleLocked: true },
  "+22676000000": { fullName: "Antoine Kaboré", phone: "+22676000000", countryCode: "BF", role: "driver", vehicles: ["Moto", "Tricycle"], roleLocked: true },
};

export function findSimulatedAccount(phone: string) {
  return SIMULATED_ACCOUNTS[phone] ?? null;
}

export function createRegisteredProfile(input: { fullName: string; phone: string; countryCode?: string; role: UserRole; vehicles?: VehicleType[] }): RegisteredProfile {
  const normalizedName = sanitizeFullName(input.fullName);
  const countryCode = COUNTRIES.some((country) => country.id === input.countryCode) ? input.countryCode! : findCountryForPhone(input.phone).id;
  return { fullName: normalizedName, phone: input.phone, countryCode, role: input.role, vehicles: input.role === "driver" ? input.vehicles ?? [] : [], roleLocked: true, referralCode: input.role === "driver" ? generateDriverReferralCode(normalizedName) : undefined };
}
