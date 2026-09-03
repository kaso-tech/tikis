/** Règle d'auto-crédit d'un loyalty grant.
 *  - Si autoCredit = false : pas d'auto-crédit (validation admin requise).
 *  - Si autoCredit = true et autoCreditMaxAmount = 0 : auto-crédit illimité (tout bonus).
 *  - Si autoCredit = true et autoCreditMaxAmount > 0 : auto-crédit si bonusAmount <= maxAmount.
 */
export function shouldAutoCredit(program: { autoCredit: boolean; autoCreditMaxAmount: number; bonusAmount: number }): boolean {
  if (!program.autoCredit) return false;
  if (program.autoCreditMaxAmount <= 0) return true;
  return program.bonusAmount <= program.autoCreditMaxAmount;
}
