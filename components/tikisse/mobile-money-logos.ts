import type { ImageSourcePropType } from "react-native";
import type { MobileMoneyOperatorId } from "@/shared/mobile-money-operators";

/**
 * Logos des opérateurs Mobile Money (PNG 192×192, sources dans assets/images/operators/SOURCES.md).
 * Un opérateur sans logo garde sa pastille d'initiales (shared/mobile-money-operators.ts).
 */
export const MOBILE_MONEY_LOGOS: Partial<Record<MobileMoneyOperatorId, ImageSourcePropType>> = {
  orange_money: require("@/assets/images/operators/orange_money.png"),
  moov_money: require("@/assets/images/operators/moov_money.png"),
  mtn_money: require("@/assets/images/operators/mtn_money.png"),
  wave: require("@/assets/images/operators/wave.png"),
  airtel_money: require("@/assets/images/operators/airtel_money.png"),
  vodacom_mpesa: require("@/assets/images/operators/vodacom_mpesa.png"),
  zamani_money: require("@/assets/images/operators/zamani_money.png"),
  africell_money: require("@/assets/images/operators/africell_money.png"),
  yas_money: require("@/assets/images/operators/yas_money.png"),
};
