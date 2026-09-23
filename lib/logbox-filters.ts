/**
 * Les avertissements de dépendances qu'on ne peut pas corriger chez nous.
 *
 * Importé en toute première ligne de `app/_layout.tsx` : un filtre posé après coup n'attraperait
 * rien, puisque l'avertissement part au moment où le module fautif est évalué.
 *
 * Ce fichier n'a vocation à contenir que des lignes temporaires, chacune accompagnée de la
 * condition qui permettra de la retirer. Masquer un avertissement qui vient de notre propre code
 * serait une faute : il faudrait le corriger.
 */
import { LogBox } from "react-native";

LogBox.ignoreLogs([
  // NativeWind (react-native-css-interop) appelle `cssInterop(SafeAreaView)` au chargement de son
  // runtime et touche ainsi l'export déprécié de react-native. Aucun de nos écrans n'utilise ce
  // composant — tous passent par react-native-safe-area-context — et il n'existe aucun réglage
  // pour l'en empêcher. À retirer après une montée de nativewind (4.2.1 ici, 4.2.7 disponible) qui
  // cesserait d'y toucher : relancer l'application sans cette ligne pour vérifier.
  "SafeAreaView has been deprecated and will be removed in a future release",
]);
