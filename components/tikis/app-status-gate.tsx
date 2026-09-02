import { useEffect } from "react";
import { BannedAccountScreen, DeletionPendingScreen, MaintenanceScreen } from "@/components/tikis/account-status-screens";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";

/**
 * Bloque toute l'application derrière l'écran adapté quand : le mode maintenance est actif,
 * ou que le profil connecté est banni / en cours de suppression. Placé au-dessus du Stack de
 * navigation dans app/_layout.tsx : aucune route de l'app n'est jamais atteignable dans ces cas.
 */
export function AppStatusGate({ children }: { children: React.ReactNode }) {
  const { profile, registerProfile } = useTikisStore();

  const maintenanceQuery = trpc.platform.maintenanceStatus.useQuery(undefined, { refetchInterval: 30_000, refetchOnMount: "always" });

  const statusQuery = trpc.profiles.status.useQuery(undefined, {
    enabled: Boolean(profile?.phone),
    refetchInterval: 60_000,
    refetchOnMount: "always",
    retry: false,
  });

  useEffect(() => {
    if (statusQuery.data) registerProfile(statusQuery.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusQuery.data]);

  if (maintenanceQuery.data?.enabled) {
    return <MaintenanceScreen message={maintenanceQuery.data.message} />;
  }

  if (profile?.accountStatus === "banned") {
    return <BannedAccountScreen reason={profile.accountStatusReason} />;
  }

  if (profile?.deletionRequestedAt) {
    return <DeletionPendingScreen deletionScheduledAt={profile.deletionScheduledAt} />;
  }

  return <>{children}</>;
}
