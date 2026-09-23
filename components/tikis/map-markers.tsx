/**
 * Les trois marqueurs qui se posent sur une carte Tikis.
 *
 * Ils vivaient jusqu'ici en trois exemplaires — l'accueil, la fiche de
 * livraison, le suivi en direct — et avaient divergé : le point de collecte
 * était un colis ici, un simple cercle là ; la destination une goutte rouge
 * partout, indistincte d'un marqueur générique ; le livreur une flèche de
 * navigation d'un côté, une moto de l'autre. Un même trajet ne se lisait donc
 * pas pareil selon l'écran.
 *
 * Ils disent maintenant la même chose partout, et la disent par leur forme :
 * un colis pour ce qu'on prend, un drapeau d'arrivée pour là où ça va, une
 * moto pour qui roule. Les deux extrémités sont des épingles — corps blanc,
 * anneau coloré, pointe posée sur le point exact — parce qu'une extrémité ne
 * bouge pas. Le livreur est une pastille pleine et centrée, parce que lui
 * bouge, et qu'une pointe qui glisse d'un GPS à l'autre se lit mal.
 */

import { StyleSheet, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

/** Couleur du point de collecte : l'orange de la marque. */
export const PICKUP_COLOR = "#FF9800";
/** Couleur de la destination : le rouge des états terminaux. */
export const DROPOFF_COLOR = "#A43740";
/** Couleur du livreur : l'encre, pour qu'il ressorte des deux extrémités. */
export const DRIVER_COLOR = "#111111";

/**
 * Ancrage d'une épingle : la pointe, en bas, tombe sur la coordonnée.
 * `anchor` seul — jamais combiné à `centerOffset`, les deux se cumulent et
 * décalaient le marqueur de collecte de plusieurs mètres.
 */
export const PIN_ANCHOR = { x: 0.5, y: 1 } as const;
/** Ancrage d'une pastille : son centre tombe sur la coordonnée. */
export const CHIP_ANCHOR = { x: 0.5, y: 0.5 } as const;

/**
 * L'ordre de superposition sur la carte.
 *
 * « The order of overlays with the same z-index is arbitrary », dit la
 * documentation de `react-native-maps` — et tous les marqueurs de Tikis
 * partageaient le même rang par défaut. Leur ordre de dessin dépendait donc de
 * l'implémentation, ce qui n'est pas une base pour une carte qui doit se lire
 * pareil à chaque ouverture.
 */
export const MAP_Z = {
  /** Le trajet de la course, dessous. */
  route: 1,
  /** L'approche du livreur, par-dessus le trajet. */
  approach: 2,
  /** Les deux extrémités. */
  pin: 3,
  /** Le livreur, toujours visible au-dessus du reste. */
  driver: 4,
} as const;

function Pin({ color, icon }: { color: string; icon: "inventory-2" | "sports-score" }) {
  return (
    <View style={styles.pin}>
      <View style={styles.pinGround} />
      <View style={[styles.pinHead, { borderColor: color }]}>
        <MaterialIcons name={icon} size={15} color={color} />
      </View>
      <View style={[styles.pinTip, { borderTopColor: color }]} />
    </View>
  );
}

/** Point de collecte : le colis à prendre. */
export function PickupMarker() {
  return <Pin color={PICKUP_COLOR} icon="inventory-2" />;
}

/** Destination : le damier d'arrivée. */
export function DropoffMarker() {
  return <Pin color={DROPOFF_COLOR} icon="sports-score" />;
}

/**
 * Livreur : la moto, toujours droite.
 *
 * Le cap ne fait pas pivoter la moto — vue de profil, elle roulerait sur le
 * toit dès que le livreur va vers le sud. Il fait pivoter un ergot autour de
 * la pastille, qui donne la direction sans retourner le dessin.
 */
export function DriverMarker({ heading }: { heading?: number | null }) {
  return (
    <View style={styles.driver}>
      {typeof heading === "number" ? (
        <View style={[styles.driverHeading, { transform: [{ rotate: `${heading}deg` }] }]}>
          <View style={styles.driverHeadingPip} />
        </View>
      ) : null}
      <View style={styles.driverChip}>
        <MaterialIcons name="two-wheeler" size={17} color="#FFFFFF" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pin: { width: 38, alignItems: "center" },
  pinGround: { position: "absolute", bottom: 0, width: 11, height: 3.5, borderRadius: 6, backgroundColor: "rgba(17,17,17,0.16)" },
  pinHead: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 2.5,
  },
  pinTip: {
    width: 0,
    height: 0,
    marginTop: -2,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 9,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  driver: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  driverHeading: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center" },
  driverHeadingPip: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 7,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: DRIVER_COLOR,
  },
  driverChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DRIVER_COLOR,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
});
