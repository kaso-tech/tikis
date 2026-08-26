import { SIMULATION_OTP } from "../shared/tikis-domain";

export const OTP_LENGTH = 6;
export const OTP_MAX_ATTEMPTS = 5;

export function normalizePhone(countryCode: string, localNumber: string) {
  return normalizedInternationalPhone(localNumber, findCountry(countryCode));
}

export function isValidPhone(countryCode: string, localNumber: string) {
  return isValidInternationalPhone(localNumber, findCountry(countryCode));
}

export function isValidOtp(value: string) {
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(value);
}

export function verifySimulationOtp(value: string) {
  return isValidOtp(value) && value === SIMULATION_OTP;
}

export function maskPhone(phone: string) {
  if (phone.length < 6) return phone;
  const country = ["+226", "+225", "+223", "+221", "+228", "+233", "+33"].map(findCountry).find((item) => phone.startsWith(item.dialCode));
  if (!country) return `${phone.slice(0, 5)} ••• ${phone.slice(-3)}`;
  const local = phone.slice(country.dialCode.length);
  const visible = formatLocalPhone(local, country);
  return `${country.dialCode} ${visible.slice(0, Math.max(2, visible.length - 5))}•••`;
}
import { findCountry, formatLocalPhone, isValidInternationalPhone, normalizedInternationalPhone, type CountrySpec } from "./registration-rules";
