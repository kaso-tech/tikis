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

export function detectCountry(timeZone?: string) {
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return COUNTRIES.find((country) => country.timeZones.includes(zone)) ?? DEFAULT_COUNTRY;
}

export function findCountry(dialCode: string) {
  return COUNTRIES.find((country) => country.dialCode === dialCode) ?? DEFAULT_COUNTRY;
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

const FULL_NAME_PATTERN = /^[\p{L}]+(?:[ '-][\p{L}]+)+(?:[ '-][\p{L}]+)*$/u;

export function sanitizeFullName(value: string) {
  return value
    .replace(/[<>`{}\[\]\\/;=]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function validateFullName(value: string) {
  const sanitized = sanitizeFullName(value);
  if (sanitized.length < 3 || sanitized.length > 70) return { valid: false, message: "Saisissez un nom complet entre 3 et 70 caractères." };
  if (!FULL_NAME_PATTERN.test(sanitized)) return { valid: false, message: "Utilisez au moins un prénom et un nom, avec des lettres uniquement." };
  return { valid: true, value: sanitized } as const;
}

export const SIMULATED_ACCOUNTS: Record<string, RegisteredProfile> = {
  "+22670000000": { fullName: "Aïcha Traoré", phone: "+22670000000", role: "sender", vehicles: [], roleLocked: true },
  "+22676000000": { fullName: "Antoine Kaboré", phone: "+22676000000", role: "driver", vehicles: ["Moto", "Tricycle"], roleLocked: true },
};

export function findSimulatedAccount(phone: string) {
  return SIMULATED_ACCOUNTS[phone] ?? null;
}

export function createRegisteredProfile(input: { fullName: string; phone: string; role: UserRole; vehicles?: VehicleType[] }): RegisteredProfile {
  return { fullName: sanitizeFullName(input.fullName), phone: input.phone, role: input.role, vehicles: input.role === "driver" ? input.vehicles ?? [] : [], roleLocked: true };
}
