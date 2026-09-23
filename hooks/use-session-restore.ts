/**
 * Rend la session au démarrage, au lieu de la redemander.
 *
 * Le jeton de session vit un an (server/tikis-session.ts) et survit à la fermeture de
 * l'application — stockage sécurisé de l'OS en natif, cookie httpOnly sur le web. Mais le profil,
 * lui, vivait uniquement dans l'état React de `TikisStoreProvider` : à chaque relance, et à chaque
 * rechargement d'Expo Go, il repartait à `null`, l'écran d'accueil montrait le parcours
 * d'authentification, et il fallait ressaisir son numéro alors que le jeton posé sur l'appareil
 * était toujours valide. Personne ne se reconnecte à WhatsApp à chaque ouverture.
 *
 * Ce hook ferme cet écart : si l'appareil porte encore une session, il redemande le profil au
 * serveur (`profiles.status`, la seule route qu'un compte banni ou en cours de suppression peut
 * encore appeler — c'est `AppStatusGate` qui décidera ensuite quel écran lui montrer) et le
 * replace dans le store. Le serveur reste seul juge : un jeton expiré, révoqué depuis un autre
 * appareil ou dont le profil a disparu renvoie une erreur, et on retombe sur l'authentification.
 */
import { useEffect, useState } from "react";
import { router } from "expo-router";
import { Platform } from "react-native";
import { getTikisSessionToken } from "@/lib/tikis-session";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";

export type SessionRestoreState =
  /** Appel en cours : ni l'authentification ni l'application ne doivent s'afficher pendant ce temps. */
  | "checking"
  /** Session retrouvée, profil replacé dans le store, navigation vers l'application déjà lancée. */
  | "restored"
  /** Aucune session exploitable : c'est bien l'authentification qu'il faut montrer. */
  | "absent";

export function useSessionRestore(): SessionRestoreState {
  const { profile, signInProfile } = useTikisStore();
  const utilities = trpc.useUtils();
  // Un profil déjà en mémoire (retour sur l'accueil après une déconnexion, par exemple) n'a rien à
  // restaurer : on ne veut ni l'appel réseau, ni l'écran d'attente.
  const [state, setState] = useState<SessionRestoreState>(profile ? "restored" : "checking");

  useEffect(() => {
    // Un seul endroit qui navigue, qu'on vienne de restaurer la session ou qu'un profil ait déjà
    // été en mémoire au montage : sans ça, revenir sur l'accueil une fois connecté laissait un
    // écran d'attente qui ne partait jamais.
    if (state === "restored") {
      router.replace("/(tabs)");
      return;
    }
    if (state !== "checking") return;
    let active = true;
    void (async () => {
      try {
        // En natif, l'absence de jeton tranche sans réseau. Sur le web, le cookie est httpOnly donc
        // illisible d'ici : seul l'appel peut répondre, et il part avec `credentials: "include"`.
        if (Platform.OS !== "web" && !(await getTikisSessionToken())) {
          if (active) setState("absent");
          return;
        }
        const restored = await utilities.profiles.status.fetch();
        if (!active) return;
        // `signInProfile` et non `registerProfile` : ce dernier pousse la notification de
        // bienvenue, qui n'a rien à faire là — le compte existe depuis longtemps. La navigation
        // suit, portée par la branche `restored` de cet effet.
        signInProfile(restored);
        setState("restored");
      } catch {
        // Jeton expiré, session révoquée, profil supprimé, serveur injoignable : dans tous les cas
        // l'authentification reste la porte d'entrée, et se reconnecter y remplacera le jeton
        // périmé. On ne l'efface pas ici : une simple coupure réseau ne doit pas coûter sa session
        // à quelqu'un qui rouvrira l'application une fois de nouveau connecté.
        if (active) setState("absent");
      }
    })();
    return () => { active = false; };
  }, [state, signInProfile, utilities]);

  return state;
}
