/**
 * Domaines servis par ce même serveur, chacun avec son contenu à la racine :
 *  - console (TIKISSE_CONSOLE_HOSTS, défaut console.tikisse.com) : la console d'administration ;
 *  - site vitrine (TIKISSE_SITE_HOSTS, défaut tikisse.com et www.tikisse.com) : les pages de site/public,
 *    servies directement sur les deux — le domaine nu garde chez Manus un enregistrement A impossible à
 *    retirer, une redirection de www vers lui enverrait une visite sur deux chez Manus ;
 *    TIKISSE_SITE_REDIRECT_HOSTS (vide par défaut) : domaines renvoyés en 301 vers le premier domaine du site ;
 *  - tout autre domaine (api.tikisse.com, app.tikisse.com) : la version web de l'application, la console
 *    restant sous /admin. L'API, sous /api, répond sur tous.
 */
function hostList(value: string | undefined, fallback: string): string[] {
  return (value ?? fallback)
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

export function consoleHosts(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set(hostList(env.TIKISSE_CONSOLE_HOSTS, "console.tikisse.com"));
}

export function siteHosts(env: Record<string, string | undefined> = process.env): string[] {
  return hostList(env.TIKISSE_SITE_HOSTS, "tikisse.com,www.tikisse.com");
}

export function siteRedirectHosts(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set(hostList(env.TIKISSE_SITE_REDIRECT_HOSTS, ""));
}

export function isConsoleHost(hostname: string | undefined, hosts: Set<string> | string[]): boolean {
  if (!hostname) return false;
  const host = hostname.toLowerCase();
  return hosts instanceof Set ? hosts.has(host) : hosts.includes(host);
}
