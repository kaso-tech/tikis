import { describe, expect, it } from "vitest";
import { formatDeliveryCreationDate } from "../lib/date-format";

describe("formatDeliveryCreationDate", () => {
  const now = new Date("2026-08-30T12:00:00.000Z").getTime();

  it("affiche les secondes, minutes, heures et jours avec le libellé relatif court", () => {
    expect(formatDeliveryCreationDate(new Date(now - 1_000).toISOString(), now).primary).toBe("Il y a 1 sec");
    expect(formatDeliveryCreationDate(new Date(now - 60_000).toISOString(), now).primary).toBe("Il y a 1 min");
    expect(formatDeliveryCreationDate(new Date(now - 3_600_000).toISOString(), now).primary).toBe("Il y a 1 h");
    expect(formatDeliveryCreationDate(new Date(now - 24 * 3_600_000).toISOString(), now).primary).toBe("Il y a 1 j");
  });

  it("conserve un libellé explicite lorsque la date est absente ou invalide", () => {
    expect(formatDeliveryCreationDate(undefined, now).primary).toBe("Date de publication indisponible");
    expect(formatDeliveryCreationDate("invalide", now).primary).toBe("Date de publication indisponible");
  });
});
