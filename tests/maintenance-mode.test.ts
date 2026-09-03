import { describe, expect, it } from "vitest";
import { formatMaintenanceUserMessage, MAINTENANCE_DEFAULT_MESSAGE } from "../server/_test-helpers/maintenance-format";

describe("messages du mode maintenance", () => {
  it("le message par défaut est informatif et en français", () => {
    expect(MAINTENANCE_DEFAULT_MESSAGE.toLowerCase()).toContain("indisponible");
    expect(MAINTENANCE_DEFAULT_MESSAGE.toLowerCase()).toContain("patience");
  });

  it("formatMaintenanceUserMessage renvoie le custom s'il est fourni et non vide", () => {
    expect(formatMaintenanceUserMessage("Service en pause jusqu'à 14h.")).toBe("Service en pause jusqu'à 14h.");
  });

  it("formatMaintenanceUserMessage retombe sur le default si custom vide", () => {
    expect(formatMaintenanceUserMessage("")).toBe(MAINTENANCE_DEFAULT_MESSAGE);
    expect(formatMaintenanceUserMessage("   ")).toBe(MAINTENANCE_DEFAULT_MESSAGE);
  });

  it("formatMaintenanceUserMessage tronque les messages > 500 chars (limite DB)", () => {
    const longMessage = "x".repeat(800);
    const formatted = formatMaintenanceUserMessage(longMessage);
    expect(formatted.length).toBe(500);
  });
});
