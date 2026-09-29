import { useSyncExternalStore } from "react";

/**
 * « L'application est prête à être montrée » : le splash animé (components/tikisse/animated-splash.tsx)
 * ne s'efface qu'une fois ce signal reçu, pour ne jamais révéler un écran encore en train de décider
 * quoi afficher.
 *
 * Le signalent : l'accueil une fois la session tranchée (app/index.tsx), l'application connectée
 * (app/(tabs)/_layout.tsx) et les écrans de blocage (maintenance, compte banni ou en suppression,
 * components/tikisse/app-status-gate.tsx). Un seul appel suffit ; les suivants ne font rien.
 */
let ready = false;
const listeners = new Set<() => void>();

export function markAppReady() {
  if (ready) return;
  ready = true;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => ready;

export function useAppReady() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
