export type UserRole = "sender" | "driver";

export type DeliveryStatus =
  | "draft"
  | "open"
  | "pending_confirmation"
  | "active"
  | "completed"
  | "disabled"
  | "cancelled";

export type CandidateStatus = "applied" | "selected" | "confirmed" | "withdrawn" | "replaced";

export type WalletOperation = "block" | "unblock" | "debit" | "compensation" | "credit";

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
  provider?: "mapbox" | "manual" | "legacy";
  source?: "retrieve" | "reverse" | "forward" | "favorite" | "manual" | "legacy";
  featureType?: "address" | "secondary_address" | "poi" | "street" | "neighborhood" | "locality" | "place" | "point" | "unknown";
  precision?: "exact" | "street" | "area" | "city" | "unknown";
}

export interface PlaceSuggestion {
  mapboxId: string;
  mapboxSessionToken: string;
  name: string;
  district: string;
  city: string;
  formattedAddress?: string;
  street?: string;
  province?: string;
  country?: string;
  featureType?: LocationLabel["featureType"];
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

export type LocationPresentation = Pick<LocationLabel, "name" | "district" | "city" | "formattedAddress" | "street" | "province" | "country">;

export { displayLocation, locationSubtitle, locationTitle } from "../lib/geo-rules";

export const formatMoney = (amount: number) =>
  `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(amount)} FCFA`;

export const deliveryStatusMeta: Record<
  DeliveryStatus,
  { label: string; color: string; background: string }
> = {
  draft: { label: "Brouillon", color: "#697386", background: "#EEF1F5" },
  open: { label: "Active", color: "#B45309", background: "#FEF3C7" },
  pending_confirmation: { label: "À confirmer", color: "#3B6BCD", background: "#EAF1FF" },
  active: { label: "Attribuée", color: "#11875D", background: "#DCFCE7" },
  completed: { label: "Terminée", color: "#677489", background: "#EEF1F5" },
  disabled: { label: "Désactivée", color: "#C23B45", background: "#FEE2E2" },
  cancelled: { label: "Annulée", color: "#C23B45", background: "#FEE2E2" },
};
