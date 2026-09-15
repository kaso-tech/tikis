import { useEffect, useRef } from "react";
import { router, usePathname } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTikisStore } from "@/lib/tikis-store";
import { clearTikisSessionToken } from "@/lib/tikis-session";
import { isUnauthorizedTrpcError } from "@/lib/trpc-error";
import { logger } from "@/lib/logger";

/**
 * Filet de sécurité : jusqu'ici, un rejet UNAUTHORIZED d'une requête protégée (session expirée,
 * cookie non honoré par le navigateur — SameSite=None sans Secure sur une connexion mal détectée
 * comme non-HTTPS derrière un proxy, révocation manuelle…) n'était traité NULLE PART côté client.
 * Chaque écran affichait alors son état vide habituel (« Aucune livraison disponible », etc.) au lieu
 * d'une vraie erreur : l'app semblait fonctionner (connexion, accueil affichés depuis l'état local
 * déjà en mémoire) mais plus aucune action dépendant du serveur n'aboutissait, sans qu'aucun message
 * ne l'explique nulle part.
 *
 * Ce composant écoute les caches React Query (queries ET mutations, montées ici après la création du
 * `queryClient` dans app/_layout.tsx) : dès qu'une requête tRPC authentifiée échoue en UNAUTHORIZED
 * alors qu'un profil Tikis est chargé localement, on efface cet état local et on renvoie vers l'écran
 * de connexion — pour que l'incident redevienne visible et actionnable (se reconnecter) plutôt que de
 * laisser l'app dans un état silencieusement cassé. Ne se déclenche qu'une fois par session invalide
 * (`handledRef`) : plusieurs requêtes en échec simultané ne doivent pas déclencher plusieurs redirections.
 */
export function SessionExpiryGuard() {
  const queryClient = useQueryClient();
  const { profile, logout } = useTikisStore();
  const pathname = usePathname();
  const handledRef = useRef(false);
  const profileRef = useRef(profile);
  const pathnameRef = useRef(pathname);
  profileRef.current = profile;
  pathnameRef.current = pathname;

  useEffect(() => {
    handledRef.current = false;
  }, [profile?.phone]);

  useEffect(() => {
    function handleUnauthorized() {
      if (handledRef.current) return;
      if (!profileRef.current) return; // Pas de session locale à invalider (déjà sur /auth, etc.).
      if (pathnameRef.current?.startsWith("/auth")) return;
      handledRef.current = true;
      logger.warn("[session-guard]", "Session Tikis rejetée par le serveur (UNAUTHORIZED) — déconnexion locale et retour à la connexion.");
      void clearTikisSessionToken();
      logout();
      router.replace("/auth" as any);
    }

    const unsubQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error" && isUnauthorizedTrpcError(event.action.error)) {
        handleUnauthorized();
      }
    });
    const unsubMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error" && isUnauthorizedTrpcError(event.action.error)) {
        handleUnauthorized();
      }
    });
    return () => {
      unsubQueries();
      unsubMutations();
    };
  }, [queryClient, logout]);

  return null;
}
