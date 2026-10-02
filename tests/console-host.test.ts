import { describe, expect, it } from "vitest";
import { consoleHosts, isConsoleHost, siteHosts, siteRedirectHosts } from "../server/_core/console-host";

describe("domaine de la console", () => {
  it("console.tikisse.com par défaut", () => {
    const hosts = consoleHosts({});
    expect(isConsoleHost("console.tikisse.com", hosts)).toBe(true);
    expect(isConsoleHost("CONSOLE.tikisse.com", hosts)).toBe(true);
    expect(isConsoleHost("tikisse.com", hosts)).toBe(false);
    expect(isConsoleHost("api.tikisse.com", hosts)).toBe(false);
    expect(isConsoleHost(undefined, hosts)).toBe(false);
  });

  it("liste configurable (TIKISSE_CONSOLE_HOSTS)", () => {
    const hosts = consoleHosts({ TIKISSE_CONSOLE_HOSTS: " admin.example.com , console.example.com " });
    expect(isConsoleHost("admin.example.com", hosts)).toBe(true);
    expect(isConsoleHost("console.example.com", hosts)).toBe(true);
    expect(isConsoleHost("console.tikisse.com", hosts)).toBe(false);
  });
});

describe("domaines du site vitrine", () => {
  it("tikisse.com sert le site, www y renvoie", () => {
    expect(siteHosts({})).toEqual(["tikisse.com"]);
    expect(isConsoleHost("tikisse.com", siteHosts({}))).toBe(true);
    expect(isConsoleHost("app.tikisse.com", siteHosts({}))).toBe(false);
    expect(isConsoleHost("www.tikisse.com", siteRedirectHosts({}))).toBe(true);
  });
});
