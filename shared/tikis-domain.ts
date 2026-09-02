export type UserRole = "sender" | "driver";

export type DeliveryStatus =
  | "draft"
  | "open"
  | "pending_confirmation"
  | "active"
  | "completed"
  | "disabled"
  | "cancelled"
  | "expired";

export type DeliveryRouteVisibility = "exact" | "approximate";

export type CandidateStatus = "applied" | "selected" | "confirmed" | "withdrawn" | "replaced";

export type WalletOperation = "block" | "unblock" | "debit" | "compensation" | "credit" | "refund" | "deposit_request" | "withdrawal_request";

export type VehicleType = "Vélo" | "Moto" | "Tricycle" | "Voiture" | "Fourgonnette";
export type SelectableVehicleType = Exclude<VehicleType, "Fourgonnette">;
export type DeliveryType = "Plis" | "Personne" | "Autre";

export interface RegisteredProfile {
  fullName: string;
  phone: string;
  countryCode: string;
  role: UserRole;
  vehicles: VehicleType[];
  roleLocked: true;
  photoUrl?: string;
  referralCode?: string;
  email?: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
}

export interface DeliveryReview {
  id: string;
  deliveryId: string;
  driverName: string;
  rating: 1 | 2 | 3 | 4 | 5;
  comment?: string;
  createdAt: string;
}

export type ReferralStatus = "invited" | "qualified" | "rewarded";

export interface ReferralRecord {
  id: string;
  fullName: string;
  joinedAt: string;
  completedDeliveries: number;
  status: ReferralStatus;
  rewardAmount: number;
}

export interface CommissionPolicy {
  rate: number;
  currency: "FCFA";
}

export interface LocationLabel {
  name: string;
  district: string;
  city: string;
  latitude: number;
  longitude: number;
  googlePlaceId?: string;
  mapboxId?: string;
  mapboxSessionToken?: string;
  formattedAddress?: string;
  street?: string;
  province?: string;
  country?: string;
  provider?: "mapbox" | "openstreetmap" | "manual" | "legacy";
  source?: "search" | "retrieve" | "reverse" | "forward" | "favorite" | "manual" | "legacy";
  featureType?: "address" | "secondary_address" | "poi" | "street" | "neighborhood" | "locality" | "place" | "point" | "unknown";
  precision?: "exact" | "street" | "area" | "city" | "unknown";
}

export interface PlaceSuggestion {
  id: string;
  mapboxId?: string;
  mapboxSessionToken?: string;
  name: string;
  district: string;
  city: string;
  formattedAddress?: string;
  street?: string;
  province?: string;
  country?: string;
  featureType?: LocationLabel["featureType"];
  provider?: LocationLabel["provider"];
  directLocation?: LocationLabel;
}

export interface Delivery {
  id: string;
  title: string;
  status: DeliveryStatus;
  type: DeliveryType;
  pickup: LocationLabel;
  dropoff: LocationLabel;
  distanceKm: number;
  routeSource?: "routes" | "provisional";
  estimatedPrice: number;
  offeredPrice?: number;
  vehicleTypes: SelectableVehicleType[];
  createdAt: string;
  scheduledAt: string;
  completedAt?: string;
  senderName: string;
  senderPhone?: string;
  driverId?: string;
  driverName?: string;
  driverPhone?: string;
  previousDriverId?: string;
  previousDriverName?: string;
  details: string;
  weightKg?: number;
  dimensions?: { lengthCm?: number; widthCm?: number; heightCm?: number };
  passengers?: number;
  ownCandidateStatus?: CandidateStatus;
  candidateCount?: number;
  routeVisibility?: DeliveryRouteVisibility;
}

export function isDeliveryCompletedToday(delivery: Pick<Delivery, "status" | "completedAt">, now = new Date()): boolean {
  if (delivery.status !== "completed" || !delivery.completedAt) return false;
  const completedAt = new Date(delivery.completedAt);
  if (!Number.isFinite(completedAt.getTime())) return false;
  return completedAt.getFullYear() === now.getFullYear()
    && completedAt.getMonth() === now.getMonth()
    && completedAt.getDate() === now.getDate();
}

export function isDeliveryCompletedWithinLast24Hours(delivery: Pick<Delivery, "status" | "completedAt">, now = new Date()): boolean {
  if (delivery.status !== "completed" || !delivery.completedAt) return false;
  const completedAt = new Date(delivery.completedAt);
  const ageMs = now.getTime() - completedAt.getTime();
  return Number.isFinite(completedAt.getTime()) && ageMs >= 0 && ageMs < 24 * 60 * 60 * 1_000;
}

export interface DriverCandidate {
  id: string;
  deliveryId: string;
  driverId: string;
  name: string;
  initials: string;
  rating: number;
  completedDeliveries: number;
  vehicles: VehicleType[];
  offerPrice?: number;
  status: CandidateStatus;
  commissionBlocked: number;
  isVerified: boolean;
  isCertified: boolean;
  createdAt: string;
}

export const CERTIFICATION_MIN_DELIVERIES = 100;
export const CERTIFICATION_MIN_RATING = 4.5;

export function isDriverCertified(rating: number, completedDeliveries: number): boolean {
  return completedDeliveries >= CERTIFICATION_MIN_DELIVERIES && rating >= CERTIFICATION_MIN_RATING;
}

export interface WalletSnapshot {
  total: number;
  blocked: number;
}

export interface FinancialRecord {
  id: string;
  deliveryId: string;
  createdAt: string;
  operation: WalletOperation;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  reason: string;
}

export interface InAppNotification {
  id: string;
  deliveryId?: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  tone: "info" | "success" | "warning";
}

export const SIMULATION_OTP = "730512";

export const commissionFor = (price: number, policy: CommissionPolicy) =>
  Math.round(price * policy.rate);

export const availableWalletBalance = (wallet: WalletSnapshot) => wallet.total - wallet.blocked;

export type LocationPresentation = Pick<LocationLabel, "name" | "district" | "city" | "formattedAddress" | "street" | "province" | "country" | "featureType">;

export { displayLocation, locationSubtitle, locationTitle } from "../lib/geo-rules";

export const formatMoney = (amount: number) =>
  `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(amount)} FCFA`;

export function formatRelativeDate(value: string, now = Date.now()) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Date indisponible";
  const differenceMinutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (differenceMinutes < 1) return "À l’instant";
  if (differenceMinutes < 60) return `Il y a ${differenceMinutes} min`;
  const hours = Math.floor(differenceMinutes / 60);
  if (hours < 24) return `Il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Il y a ${days} j`;
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

export const deliveryStatusMeta: Record<
  DeliveryStatus,
  { label: string; color: string; background: string }
> = {
  draft: { label: "Brouillon", color: "#7A6E61", background: "#EEE8E0" },
  open: { label: "Active", color: "#9A6201", background: "#F8E8CE" },
  pending_confirmation: { label: "À confirmer", color: "#7A5600", background: "#F4E9D2" },
  active: { label: "Attribuée", color: "#176C52", background: "#DDEFE7" },
  completed: { label: "Terminée", color: "#4F6A5A", background: "#E6EFE9" },
  disabled: { label: "Désactivée", color: "#A43740", background: "#F7E6E7" },
  cancelled: { label: "Annulée", color: "#A43740", background: "#F7E6E7" },
  expired: { label: "Expirée", color: "#6B6257", background: "#EEE8E0" },
};
