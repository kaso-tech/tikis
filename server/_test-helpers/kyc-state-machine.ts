export type KycStatus = "submitted" | "approved" | "rejected";

export const KYC_TRANSITIONS: Record<KycStatus, ReadonlyArray<KycStatus>> = {
  submitted: ["approved", "rejected"],
  approved: [],
  rejected: [],
};

export function canTransitionKyc(from: KycStatus, to: KycStatus): boolean {
  return KYC_TRANSITIONS[from].includes(to);
}
