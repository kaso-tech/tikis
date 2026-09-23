export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = "Please login (10001)";
export const NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

// Partagés entre server/routers.ts (deliveries.updateLivePosition) et lib/background-location-task.ts :
// des rejets attendus, qui se corrigent d'eux-mêmes au prochain point GPS — jamais une vraie panne à
// signaler bruyamment. La tâche de fond compare son message d'erreur à ces constantes pour ne pas les
// journaliser au même niveau qu'un échec inattendu (réseau, session expirée…).
export const LIVE_POSITION_GPS_JUMP_ERR_MSG = "Le saut de position détecté est trop important. Vérifie ta connexion GPS et réessaie.";
export const LIVE_POSITION_OUT_OF_ZONE_ERR_MSG = "La position partagée est en dehors de la zone de service. Vérifie ton GPS.";
