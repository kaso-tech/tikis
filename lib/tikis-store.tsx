import { createContext, useContext, useMemo, useState } from "react";
import type {
  CommissionPolicy,
  Delivery,
  DriverCandidate,
  FinancialRecord,
  InAppNotification,
  RegisteredProfile,
  UserRole,
  WalletSnapshot,
} from "../shared/tikis-domain";
import { commissionFor, formatMoney } from "../shared/tikis-domain";
import { canApplyToDelivery } from "./tikis-engine";

const POLICY: CommissionPolicy = { rate: 0.1, currency: "FCFA" };

const INITIAL_WALLET: WalletSnapshot = { total: 45000, blocked: 0 };

const INITIAL_DELIVERIES: Delivery[] = [
  {
    id: "liv-001",
    title: "Colis de bureau · Documents",
    status: "open",
    type: "Plis",
    pickup: { name: "Siège Coris Bank", district: "Koulouba", city: "Ouagadougou" },
    dropoff: { name: "Maison de l’Entreprise", district: "Ouaga 2000", city: "Ouagadougou" },
    distanceKm: 5.4,
    estimatedPrice: 4500,
    vehicleTypes: ["Moto", "Tricycle"],
    createdAt: "Aujourd’hui · 08:42",
    scheduledAt: "Aujourd’hui · avant 14:00",
    senderName: "A. Traoré",
    details: "Enveloppe scellée à remettre contre signature.",
  },
  {
    id: "liv-002",
    title: "Matériel informatique",
    status: "active",
    type: "Colis",
    pickup: { name: "Canal Olympia", district: "Pissy", city: "Ouagadougou" },
    dropoff: { name: "Immeuble Avenir", district: "Zone du Bois", city: "Ouagadougou" },
    distanceKm: 8.2,
    estimatedPrice: 8500,
    offeredPrice: 8500,
    vehicleTypes: ["Voiture", "Fourgonnette"],
    createdAt: "Hier · 17:25",
    scheduledAt: "Aujourd’hui · 16:30",
    senderName: "A. Traoré",
    senderPhone: "+226 70 12 34 56",
    driverId: "driver-kader",
    driverName: "Kader Ilboudo",
    driverPhone: "+226 76 44 88 21",
    details: "Unité centrale et écran protégés dans leurs emballages.",
    weightKg: 18,
    dimensions: "70 × 45 × 32 cm",
  },
  {
    id: "liv-003",
    title: "Déplacement vers l’aéroport",
    status: "completed",
    type: "Personne",
    pickup: { name: "Hôtel Sopatel Silmandé", district: "Koulouba", city: "Ouagadougou" },
    dropoff: { name: "Aéroport international", district: "Donsin", city: "Ouagadougou" },
    distanceKm: 9.8,
    estimatedPrice: 6500,
    vehicleTypes: ["Voiture"],
    createdAt: "12 août · 09:10",
    scheduledAt: "12 août · 11:00",
    senderName: "A. Traoré",
    senderPhone: "+226 70 12 34 56",
    driverId: "driver-antoine",
    driverName: "Antoine Kaboré",
    driverPhone: "+226 65 09 71 42",
    details: "Trajet pour une personne avec un bagage cabine.",
    passengers: 1,
  },
];

const INITIAL_CANDIDATES: DriverCandidate[] = [
  {
    id: "cand-antoine-001",
    deliveryId: "liv-001",
    driverId: "driver-antoine",
    name: "Antoine Kaboré",
    initials: "AK",
    rating: 4.9,
    completedDeliveries: 342,
    vehicles: ["Moto", "Tricycle"],
    status: "applied",
    commissionBlocked: 450,
    isVerified: true,
  },
  {
    id: "cand-adama-001",
    deliveryId: "liv-001",
    driverId: "driver-adama",
    name: "Adama Ouédraogo",
    initials: "AO",
    rating: 4.8,
    completedDeliveries: 217,
    vehicles: ["Moto"],
    offerPrice: 4200,
    status: "applied",
    commissionBlocked: 420,
    isVerified: true,
  },
  {
    id: "cand-yannick-001",
    deliveryId: "liv-001",
    driverId: "driver-yannick",
    name: "Yannick Sanou",
    initials: "YS",
    rating: 4.7,
    completedDeliveries: 128,
    vehicles: ["Moto", "Tricycle"],
    status: "applied",
    commissionBlocked: 450,
    isVerified: true,
  },
  {
    id: "cand-antoine-002",
    deliveryId: "liv-002",
    driverId: "driver-antoine",
    name: "Antoine Kaboré",
    initials: "AK",
    rating: 4.9,
    completedDeliveries: 342,
    vehicles: ["Moto", "Tricycle"],
    status: "applied",
    commissionBlocked: 850,
    isVerified: true,
  },
];

const INITIAL_JOURNAL: FinancialRecord[] = [
  {
    id: "fin-001",
    deliveryId: "liv-001",
    createdAt: "Aujourd’hui · 08:44",
    operation: "block",
    amount: 450,
    balanceBefore: 45000,
    balanceAfter: 45000,
    reason: "Commission bloquée pour candidature",
  },
];

const INITIAL_NOTIFICATIONS: InAppNotification[] = [
  {
    id: "note-001",
    title: "3 livreurs sont intéressés",
    body: "Comparez leurs profils et choisissez la meilleure option pour votre course.",
    createdAt: "Il y a 6 min",
    read: false,
    tone: "info",
  },
  {
    id: "note-002",
    title: "Votre Wallet est à jour",
    body: "La commission de 450 FCFA a été temporairement bloquée.",
    createdAt: "Il y a 14 min",
    read: true,
    tone: "warning",
  },
];

const CURRENT_DRIVER_ID = "driver-antoine";

type Store = {
  role: UserRole;
  setRole: (role: UserRole) => void;
  profile: RegisteredProfile | null;
  signInProfile: (profile: RegisteredProfile) => void;
  registerProfile: (profile: RegisteredProfile) => void;
  logout: () => void;
  policy: CommissionPolicy;
  wallet: WalletSnapshot;
  deliveries: Delivery[];
  candidates: DriverCandidate[];
  journal: FinancialRecord[];
  notifications: InAppNotification[];
  deliveryById: (id: string) => Delivery | undefined;
  candidatesForDelivery: (id: string) => DriverCandidate[];
  driverCandidateForDelivery: (id: string) => DriverCandidate | undefined;
  applyToDelivery: (deliveryId: string) => { ok: boolean; message?: string };
  withdrawFromDelivery: (deliveryId: string) => void;
  selectCandidate: (deliveryId: string, candidateId: string) => void;
  confirmAssignedDelivery: (deliveryId: string) => void;
  completeDelivery: (deliveryId: string) => void;
  createDemoDelivery: (input: Pick<Delivery, "title" | "pickup" | "dropoff" | "estimatedPrice" | "vehicleTypes" | "type" | "details">) => Delivery;
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
  const [deliveries, setDeliveries] = useState<Delivery[]>(INITIAL_DELIVERIES);
  const [candidates, setCandidates] = useState<DriverCandidate[]>(INITIAL_CANDIDATES);
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

  const logout = () => {
    setProfile(null);
    setRole("sender");
  };

  const deliveryById = (id: string) => deliveries.find((delivery) => delivery.id === id);
  const candidatesForDelivery = (id: string) => candidates.filter((candidate) => candidate.deliveryId === id && candidate.status !== "withdrawn");
  const driverCandidateForDelivery = (id: string) => candidates.find((candidate) => candidate.deliveryId === id && candidate.driverId === CURRENT_DRIVER_ID && candidate.status !== "withdrawn");

  const applyToDelivery = (deliveryId: string) => {
    const delivery = deliveryById(deliveryId);
    if (!delivery) return { ok: false, message: "Livraison introuvable." };
    const existing = driverCandidateForDelivery(deliveryId);
    if (existing) return { ok: true };
    if (!canApplyToDelivery(wallet, delivery.estimatedPrice, POLICY)) {
      return { ok: false, message: "Votre Wallet ne couvre pas la commission de mise en relation." };
    }
    const commission = commissionFor(delivery.estimatedPrice, POLICY);
    setCandidates((items) => [
      ...items,
      {
        id: `cand-antoine-${Date.now()}`,
        deliveryId,
        driverId: CURRENT_DRIVER_ID,
        name: "Antoine Kaboré",
        initials: "AK",
        rating: 4.9,
        completedDeliveries: 342,
        vehicles: ["Moto", "Tricycle"],
        status: "applied",
        commissionBlocked: commission,
        isVerified: true,
      },
    ]);
    setWallet((current) => ({ ...current, blocked: current.blocked + commission }));
    addJournal({ deliveryId, operation: "block", amount: commission, balanceBefore: wallet.total, balanceAfter: wallet.total, reason: "Commission temporairement bloquée pour candidature" });
    setNotifications((items) => [makeNotification("Candidature envoyée", `La commission de ${formatMoney(commission)} est bloquée jusqu’à la sélection.`, "warning"), ...items]);
    return { ok: true };
  };

  const withdrawFromDelivery = (deliveryId: string) => {
    const candidate = driverCandidateForDelivery(deliveryId);
    if (!candidate || candidate.status !== "applied") return;
    setCandidates((items) => items.map((item) => item.id === candidate.id ? { ...item, status: "withdrawn" } : item));
    setWallet((current) => ({ ...current, blocked: Math.max(0, current.blocked - candidate.commissionBlocked) }));
    addJournal({ deliveryId, operation: "unblock", amount: candidate.commissionBlocked, balanceBefore: wallet.total, balanceAfter: wallet.total, reason: "Commission débloquée après retrait de candidature" });
    setNotifications((items) => [makeNotification("Candidature retirée", `${formatMoney(candidate.commissionBlocked)} sont de nouveau disponibles sur votre Wallet.`, "success"), ...items]);
  };

  const selectCandidate = (deliveryId: string, candidateId: string) => {
    const candidate = candidates.find((item) => item.id === candidateId);
    const delivery = deliveryById(deliveryId);
    if (!candidate || !delivery) return;
    const isReplacement = delivery.status === "active";
    setCandidates((items) => items.map((item) => {
      if (item.deliveryId !== deliveryId) return item;
      if (item.id === candidateId) return { ...item, status: "selected" };
      return item.status === "selected" ? { ...item, status: "applied" } : item;
    }));
    setDeliveries((items) => items.map((item) => item.id === deliveryId ? {
      ...item,
      status: "pending_confirmation",
      previousDriverId: isReplacement ? item.driverId : undefined,
      previousDriverName: isReplacement ? item.driverName : undefined,
      driverId: candidate.driverId,
      driverName: candidate.name,
      driverPhone: undefined,
    } : item));
    setNotifications((items) => [makeNotification(isReplacement ? "Remplacement à confirmer" : "Livreur présélectionné", `${candidate.name} doit confirmer sa disponibilité avant le partage des coordonnées.`, "info"), ...items]);
  };

  const confirmAssignedDelivery = (deliveryId: string) => {
    const delivery = deliveryById(deliveryId);
    const candidate = driverCandidateForDelivery(deliveryId);
    if (!delivery || !candidate || candidate.status !== "selected") return;
    const before = wallet.total;
    const wasReplacement = Boolean(delivery.previousDriverId);
    setWallet((current) => ({ total: current.total - candidate.commissionBlocked, blocked: Math.max(0, current.blocked - candidate.commissionBlocked) }));
    setCandidates((items) => items.map((item) => item.id === candidate.id ? { ...item, status: "confirmed" } : item));
    setDeliveries((items) => items.map((item) => item.id === deliveryId ? {
      ...item,
      status: "active",
      senderPhone: "+226 70 12 34 56",
      driverPhone: "+226 65 09 71 42",
    } : item));
    addJournal({ deliveryId, operation: "debit", amount: candidate.commissionBlocked, balanceBefore: before, balanceAfter: before - candidate.commissionBlocked, reason: wasReplacement ? "Commission définitivement débitée après confirmation de remplacement" : "Commission définitivement débitée après confirmation de mission" });
    if (wasReplacement) {
      addJournal({ deliveryId, operation: "compensation", amount: candidate.commissionBlocked, balanceBefore: before, balanceAfter: before, reason: `Compensation envoyée à ${delivery.previousDriverName ?? "l’ancien livreur"}; Tikis conserve une seule commission.` });
    }
    setNotifications((items) => [makeNotification("Mission confirmée", wasReplacement ? "Le remplacement est confirmé et la compensation a été enregistrée." : "Les coordonnées de l’expéditeur sont maintenant disponibles.", "success"), ...items]);
  };

  const completeDelivery = (deliveryId: string) => {
    setDeliveries((items) => items.map((item) => item.id === deliveryId ? { ...item, status: "completed" } : item));
    setNotifications((items) => [makeNotification("Livraison terminée", "La course a été ajoutée à votre historique et à vos statistiques.", "success"), ...items]);
  };

  const createDemoDelivery = (input: Pick<Delivery, "title" | "pickup" | "dropoff" | "estimatedPrice" | "vehicleTypes" | "type" | "details">) => {
    const delivery: Delivery = {
      ...input,
      id: `liv-${Date.now()}`,
      status: "open",
      distanceKm: 4.8,
      createdAt: "À l’instant",
      scheduledAt: "Aujourd’hui · dès que possible",
      senderName: profile?.fullName ?? "A. Traoré",
    };
    setDeliveries((items) => [delivery, ...items]);
    setNotifications((items) => [makeNotification("Livraison publiée", "Les livreurs compatibles peuvent désormais se proposer.", "success"), ...items]);
    return delivery;
  };

  const value = useMemo<Store>(() => ({
    role, setRole: setRoleSafely, profile, signInProfile, registerProfile, logout, policy: POLICY, wallet, deliveries, candidates, journal, notifications,
    deliveryById, candidatesForDelivery, driverCandidateForDelivery,
    applyToDelivery, withdrawFromDelivery, selectCandidate, confirmAssignedDelivery, completeDelivery, createDemoDelivery,
    addNotification: (notification) => setNotifications((items) => [makeNotification(notification.title, notification.body, notification.tone), ...items]),
    markNotificationsRead: () => setNotifications((items) => items.map((item) => ({ ...item, read: true }))),
  }), [role, profile, wallet, deliveries, candidates, journal, notifications]);

  return <TikisStoreContext.Provider value={value}>{children}</TikisStoreContext.Provider>;
}

export function useTikisStore() {
  const store = useContext(TikisStoreContext);
  if (!store) throw new Error("useTikisStore must be used inside TikisStoreProvider");
  return store;
}
