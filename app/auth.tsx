import { AuthFlow } from "@/components/tikis/auth-flow";

/** Point d’entrée explicite des parcours OTP, distinct de la route des onglets authentifiés. */
export default function AuthScreen() {
  return <AuthFlow />;
}
