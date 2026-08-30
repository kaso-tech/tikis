import type { Delivery } from "./tikis-domain";

export type DriverHomeAction = "apply" | "withdraw" | "confirm" | "start" | "none";

export function resolveDriverHomeAction(delivery: Pick<Delivery, "status" | "ownCandidateStatus">): DriverHomeAction {
  if (delivery.ownCandidateStatus === "applied") return "withdraw";
  if (delivery.ownCandidateStatus === "selected") return "confirm";
  if (delivery.ownCandidateStatus === "confirmed" || delivery.status === "active") return "start";
  if (delivery.status === "open") return "apply";
  return "none";
}
