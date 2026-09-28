import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
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
 * Au retour sur l'écran, remettre `tracksViewChanges` à vrai ne suffit pas :
 * l'observation le montre — le marqueur restait vide après un aller-retour
 * entre onglets, alors qu'un changement de livraison (donc une clé différente,
 * donc un marqueur natif neuf) le ramenait à tous les coups. Côté Android, le
 * marqueur natif détaché puis rattaché avec la carte ne reprend pas toujours
 * l'instantané qu'on lui redemande ; seule sa recréation le fait. On force donc
 * cette recréation à chaque retour de focus via `epoch`, clé du `Marker`
 * interne — jamais au tout premier affichage, où le marqueur vient de naître et
 * où le remonter ne ferait que clignoter pour rien.
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
  const [epoch, setEpoch] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const everFocused = useRef(false);

  const retake = useCallback(() => {
    setTracks(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTracks(false), SETTLE_MS);
  }, []);

  /** Retour sur l'écran : marqueur natif recréé (nouvel `epoch`) puis instantané repris sur ce marqueur neuf.
   *  Les deux changements d'état partent du même appel, donc du même rendu : le `Marker` neuf naît avec
   *  `tracksViewChanges` déjà à vrai, et n'a jamais l'occasion d'afficher une image vide. */
  const remountAndRetake = useCallback(() => {
    if (everFocused.current) setEpoch((previous) => previous + 1);
    else everFocused.current = true;
    retake();
  }, [retake]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- `retake` pose `tracks` à vrai puis programme, via le timer déjà tenu en ref, son retour à faux après SETTLE_MS : les deux doivent rester choreographiés ensemble dans un effet, pas scindés en un ajustement de rendu qui ne peut ni lire ni écrire `timer.current`.
    retake();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [redrawKey, retake]);

  useFocusEffect(useCallback(() => {
    remountAndRetake();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [remountAndRetake]));

  return <Marker key={epoch} tracksViewChanges={tracks} {...markerProps}>{children}</Marker>;
}
