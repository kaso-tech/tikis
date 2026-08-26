import { SIMULATION_OTP } from "../shared/tikis-domain";

export const OTP_LENGTH = 6;
export const OTP_MAX_ATTEMPTS = 5;

export function normalizePhone(countryCode: string, localNumber: string) {
  const digits = localNumber.replace(/\D/g, "");
  return `${countryCode}${digits}`;
}

export function isValidPhone(countryCode: string, localNumber: string) {
  const phone = normalizePhone(countryCode, localNumber);
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

export function isValidOtp(value: string) {
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(value);
}

export function verifySimulationOtp(value: string) {
  return isValidOtp(value) && value === SIMULATION_OTP;
}

export function maskPhone(phone: string) {
  if (phone.length < 6) return phone;
  return `${phone.slice(0, 5)} ••• ${phone.slice(-3)}`;
}
