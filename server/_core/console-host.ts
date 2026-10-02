/**
 * Domaines dédiés à la console d'administration (TIKISSE_CONSOLE_HOSTS, séparés par des virgules ;
 * défaut : console.tikisse.com). Sur ces domaines, la console est servie à la racine — le même serveur
 * sert sinon la version web de l'application à la racine et la console sous /admin.
 */
export function consoleHosts(env: Record<string, string | undefined> = process.env): Set<string> {
  const configured = (env.TIKISSE_CONSOLE_HOSTS ?? "console.tikisse.com")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return new Set(configured);
}

export function isConsoleHost(hostname: string | undefined, hosts: Set<string>): boolean {
  return Boolean(hostname) && hosts.has(hostname!.toLowerCase());
}
