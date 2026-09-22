import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Marker, type MapMarkerProps } from "react-native-maps";

/**
 * Un marqueur à dessin personnalisé qui se redessine quand il le faut.
 *
 * `react-native-maps` ne pose pas nos vues sur la carte : il en prend un
 * instantané et colle l'image obtenue. Le moment de la prise est gouverné par
 * `tracksViewChanges`, vrai par défaut — l'instantané est alors repris à chaque
 * rendu, ce qui coûte cher et, sur Android, finit par rendre une image vide
 * quand l'écran a perdu puis repris le focus. C'est ce qui effaçait le marqueur
 * de collecte de la page d'accueil : il restait monté, mais son image était
 * vide. Changer de livraison changeait sa clé, donc créait un marqueur neuf
 * avec une image neuve — d'où le retour apparent.
 *
 * Ici le suivi est piloté : actif à l'arrivée sur l'écran et à chaque
 * changement de `redrawKey`, puis coupé une fois l'image prise. Le dessin est
 * donc fixé sur une image juste, et refait exactement quand il le doit.
 *
 * Les icônes viennent d'une police (`MaterialIcons`) : si l'instantané était
 * pris avant que la police soit prête, le marqueur sortirait sans son symbole.
 * `SETTLE_MS` laisse le temps de la mise en page et du chargement de la police
 * avant de figer.
 */
const SETTLE_MS = 900;

export function TrackedMarker({
  redrawKey,
  children,
  ...markerProps
}: MapMarkerProps & {
  /** Change quand le contenu dessiné change (le cap du livreur, par exemple) :
   *  le marqueur reprend alors un instantané. La coordonnée n'en fait pas
   *  partie — la déplacer ne modifie pas le dessin. */
  redrawKey?: string | number;
}) {
  const [tracks, setTracks] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const retake = useCallback(() => {
    setTracks(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTracks(false), SETTLE_MS);
  }, []);

  useEffect(() => {
    retake();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [redrawKey, retake]);

  // Retour sur l'écran : l'image a pu être perdue pendant que la carte était
  // hors champ, on la reprend systématiquement.
  useFocusEffect(useCallback(() => {
    retake();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [retake]));

  return <Marker tracksViewChanges={tracks} {...markerProps}>{children}</Marker>;
}
