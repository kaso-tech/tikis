import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PlacePicker } from "@/components/tikis/place-picker";
import { TikisButton } from "@/components/tikis/ui";
import type { LocationLabel } from "@/shared/tikis-domain";

type LocationTarget = "pickup" | "dropoff";

export type SavedFavorite = {
  id: number | string;
  label: string;
  location: LocationLabel;
};

export function FloatingPlacePicker({
  visible,
  target,
  value,
  onClose,
  onSelect,
}: {
  visible: boolean;
  target: LocationTarget | null;
  value: LocationLabel | null;
  onClose: () => void;
  onSelect: (place: LocationLabel) => void;
}) {
  const title = target === "pickup" ? "Choisir la récupération" : "Choisir la destination";

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
            <MaterialIcons name="close" size={22} color="#0B1F3A" />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>LIEU DE LIVRAISON</Text>
            <Text style={styles.title}>{title}</Text>
          </View>
          <View style={styles.closeSpacer} />
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.subtitle}>Recherchez une adresse ou sélectionnez un point directement sur la carte.</Text>
          {target ? (
            <PlacePicker
              label={target === "pickup" ? "Adresse de récupération" : "Adresse de destination"}
              tone={target}
              value={value}
              onChange={(place) => {
                onSelect(place);
                onClose();
              }}
            />
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

export function FavoritePlacesSheet({
  visible,
  favorites,
  onClose,
  onPickup,
  onDropoff,
}: {
  visible: boolean;
  favorites: SavedFavorite[];
  onClose: () => void;
  onPickup: (place: LocationLabel) => void;
  onDropoff: (place: LocationLabel) => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer les favoris" onPress={onClose} style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
            <MaterialIcons name="close" size={22} color="#0B1F3A" />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>ADRESSES ENREGISTRÉES</Text>
            <Text style={styles.title}>Vos favoris</Text>
          </View>
          <View style={styles.closeSpacer} />
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.subtitle}>Choisissez si ce lieu correspond à la récupération ou à la destination.</Text>
          {favorites.length ? (
            favorites.map((favorite) => (
              <View key={favorite.id} style={styles.favoriteCard}>
                <View style={styles.favoriteTop}>
                  <View style={styles.favoriteIcon}>
                    <MaterialIcons name="star" size={18} color="#A86600" />
                  </View>
                  <View style={styles.favoriteCopy}>
                    <Text style={styles.favoriteTitle} numberOfLines={1}>{favorite.label}</Text>
                    <Text style={styles.favoriteMeta} numberOfLines={2}>{[favorite.location.district, favorite.location.city, favorite.location.formattedAddress].filter(Boolean).join(" · ") || favorite.location.name}</Text>
                  </View>
                </View>
                <View style={styles.favoriteActions}>
                  <TikisButton label="Récupération" variant="secondary" icon="trip-origin" onPress={() => { onPickup(favorite.location); onClose(); }} style={styles.favoriteAction} />
                  <TikisButton label="Destination" icon="location-on" onPress={() => { onDropoff(favorite.location); onClose(); }} style={styles.favoriteAction} />
                </View>
              </View>
            ))
          ) : (
            <View style={styles.empty}>
              <MaterialIcons name="star-outline" size={30} color="#A1ADBC" />
              <Text style={styles.emptyTitle}>Aucun lieu favori</Text>
              <Text style={styles.emptyText}>Après avoir choisi une adresse, utilisez l’icône étoile dans la création de livraison pour l’enregistrer ici.</Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F6F8FC" },
  header: { minHeight: 76, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFFFFF", borderBottomWidth: 1, borderBottomColor: "#E7ECF2" },
  close: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "#F3F6FA" },
  closeSpacer: { width: 42 },
  headerCopy: { flex: 1 },
  eyebrow: { color: "#007B8B", fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  title: { color: "#0B1F3A", fontSize: 18, fontWeight: "900", marginTop: 2 },
  content: { padding: 20, paddingBottom: 38 },
  subtitle: { color: "#697386", fontSize: 13, lineHeight: 19, marginBottom: 18 },
  favoriteCard: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E7ECF2", borderRadius: 18, padding: 14, marginBottom: 12 },
  favoriteTop: { flexDirection: "row", alignItems: "center", gap: 11 },
  favoriteIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#FFF4D8" },
  favoriteCopy: { flex: 1 },
  favoriteTitle: { color: "#0B1F3A", fontSize: 14, fontWeight: "900" },
  favoriteMeta: { color: "#778398", fontSize: 11, lineHeight: 16, marginTop: 3 },
  favoriteActions: { flexDirection: "row", gap: 9, marginTop: 14 },
  favoriteAction: { flex: 1, minHeight: 43 },
  empty: { alignItems: "center", paddingVertical: 54, paddingHorizontal: 28, backgroundColor: "#FFFFFF", borderRadius: 20, borderWidth: 1, borderColor: "#E7ECF2" },
  emptyTitle: { color: "#0B1F3A", fontSize: 16, fontWeight: "900", marginTop: 12 },
  emptyText: { color: "#778398", fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 6 },
  pressed: { opacity: 0.65 },
});
