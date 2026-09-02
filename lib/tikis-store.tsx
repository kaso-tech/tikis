import { createContext, useContext, useMemo, useState } from "react";
import type { FinancialRecord, InAppNotification, RegisteredProfile, ReferralRecord, UserRole, WalletSnapshot } from "../shared/tikis-domain";
import { formatMoney } from "../shared/tikis-domain";
import { REFERRAL_REWARD_AMOUNT, canClaimReferralReward } from "./referral-rules";

const INITIAL_WALLET: WalletSnapshot = { total: 45000, blocked: 0 };
const INITIAL_JOURNAL: FinancialRecord[] = [];
const INITIAL_NOTIFICATIONS: InAppNotification[] = [];
const INITIAL_REFERRALS: ReferralRecord[] = [
  { id: "ref-001", fullName: "Moussa Kaboré", joinedAt: "18 août 2026", completedDeliveries: 1, status: "qualified", rewardAmount: REFERRAL_REWARD_AMOUNT },
  { id: "ref-002", fullName: "Aminata Diallo", joinedAt: "23 août 2026", completedDeliveries: 0, status: "invited", rewardAmount: REFERRAL_REWARD_AMOUNT },
];

type Store = {
  role: UserRole;
  setRole: (role: UserRole) => void;
  profile: RegisteredProfile | null;
  signInProfile: (profile: RegisteredProfile) => void;
  registerProfile: (profile: RegisteredProfile) => void;
  updateProfile: (changes: Partial<Pick<RegisteredProfile, "fullName" | "photoUrl" | "country" | "city" | "deletionRequestedAt" | "deletionScheduledAt">>) => void;
  logout: () => void;
  wallet: WalletSnapshot;
  journal: FinancialRecord[];
  notifications: InAppNotification[];
  referrals: ReferralRecord[];
  claimReferralReward: (referralId: string) => { ok: boolean; message?: string };
  addNotification: (notification: Pick<InAppNotification, "title" | "body" | "tone">) => void;
  markNotificationsRead: () => void;
};

const TikisStoreContext = createContext<Store | null>(null);

function makeNotification(title: string, body: string, tone: InAppNotification["tone"]): InAppNotification {
  return { id: `note-${Date.now()}`, title, body, tone, createdAt: "À l’instant", read: false };
}

export function TikisStoreProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<UserRole>("sender");
  const [profile, setProfile] = useState<RegisteredProfile | null>(null);
  const [wallet, setWallet] = useState<WalletSnapshot>(INITIAL_WALLET);
  const [journal, setJournal] = useState<FinancialRecord[]>(INITIAL_JOURNAL);
  const [notifications, setNotifications] = useState<InAppNotification[]>(INITIAL_NOTIFICATIONS);
  const [referrals, setReferrals] = useState<ReferralRecord[]>(INITIAL_REFERRALS);

  const addJournal = (record: Omit<FinancialRecord, "id" | "createdAt">) => {
    setJournal((items) => [{ ...record, id: `fin-${Date.now()}`, createdAt: "À l’instant" }, ...items]);
  };

  const setRoleSafely = (nextRole: UserRole) => {
    if (profile?.roleLocked && profile.role !== nextRole) return;
    setRole(nextRole);
  };

  const signInProfile = (nextProfile: RegisteredProfile) => {
    setProfile(nextProfile);
    setRole(nextProfile.role);
  };

  const registerProfile = (nextProfile: RegisteredProfile) => {
    setProfile(nextProfile);
    setRole(nextProfile.role);
    setNotifications((items) => [makeNotification("Bienvenue sur Tikis", `Votre compte ${nextProfile.role === "sender" ? "expéditeur" : "livreur"} a été créé avec succès.`, "success"), ...items]);
  };

  const updateProfile = (changes: Partial<Pick<RegisteredProfile, "fullName" | "photoUrl" | "country" | "city" | "deletionRequestedAt" | "deletionScheduledAt">>) => {
    setProfile((current) => current ? { ...current, ...changes } : current);
  };

  const logout = () => {
    setProfile(null);
    setRole("sender");
  };

  const claimReferralReward = (referralId: string) => {
    const referral = referrals.find((item) => item.id === referralId);
    if (!referral || !canClaimReferralReward(referral.status)) return { ok: false, message: "Cette récompense est déjà versée ou pas encore éligible." };
    const before = wallet.total;
    setReferrals((items) => items.map((item) => item.id === referralId ? { ...item, status: "rewarded" } : item));
    setWallet((current) => ({ ...current, total: current.total + referral.rewardAmount }));
    addJournal({ deliveryId: `referral-${referral.id}`, operation: "credit", amount: referral.rewardAmount, balanceBefore: before, balanceAfter: before + referral.rewardAmount, reason: `Récompense de parrainage après la première course de ${referral.fullName}` });
    setNotifications((items) => [makeNotification("Récompense de parrainage créditée", `${formatMoney(referral.rewardAmount)} ont été ajoutés à votre Wallet.`, "success"), ...items]);
    return { ok: true };
  };

  const value = useMemo<Store>(() => ({
    role, setRole: setRoleSafely, profile, signInProfile, registerProfile, updateProfile, logout, wallet, journal, notifications, referrals, claimReferralReward,
    addNotification: (notification) => setNotifications((items) => [makeNotification(notification.title, notification.body, notification.tone), ...items]),
    markNotificationsRead: () => setNotifications((items) => items.map((item) => ({ ...item, read: true }))),
  }), [role, profile, wallet, journal, notifications, referrals]);

  return <TikisStoreContext.Provider value={value}>{children}</TikisStoreContext.Provider>;
}

export function useTikisStore() {
  const store = useContext(TikisStoreContext);
  if (!store) throw new Error("useTikisStore must be used inside TikisStoreProvider");
  return store;
}
