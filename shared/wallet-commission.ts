export function candidateMovementVersion(candidate?: { status: string; updatedAt: Date }): string {
  return candidate ? `${candidate.status}:${candidate.updatedAt.getTime()}` : "initial";
}
