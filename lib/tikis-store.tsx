import { createContext, useContext, useMemo, useState } from "react";
import type { FinancialRecord, InAppNotification, RegisteredProfile, UserRole, WalletSnapshot } from "../shared/tikis-domain";

const INITIAL_WALLET: WalletSnapshot = { total: 45000, blocked: 0 };
const INITIAL_JOURNAL: FinancialRecord[] = [];
const INITIAL_NOTIFICATIONS: InAppNotification[] = [];
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

  const value = useMemo<Store>(() => ({
    role, setRole: setRoleSafely, profile, signInProfile, registerProfile, updateProfile, logout, wallet, journal, notifications,
    addNotification: (notification) => setNotifications((items) => [makeNotification(notification.title, notification.body, notification.tone), ...items]),
    markNotificationsRead: () => setNotifications((items) => items.map((item) => ({ ...item, read: true }))),
  }), [role, profile, wallet, journal, notifications]);

  return <TikisStoreContext.Provider value={value}>{children}</TikisStoreContext.Provider>;
}

export function useTikisStore() {
  const store = useContext(TikisStoreContext);
  if (!store) throw new Error("useTikisStore must be used inside TikisStoreProvider");
  return store;
}
