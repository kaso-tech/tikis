import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FinancialConfirmationModal } from "@/components/tikis/financial-modal";
import { Avatar, SectionHeading, StatusBadge, SurfaceCard, TikisButton } from "@/components/tikis/ui";
import { haptic } from "@/lib/haptics";
import { useTikisStore } from "@/lib/tikis-store";
import { deliveryStatusMeta, displayLocation, formatMoney, type DriverCandidate } from "@/shared/tikis-domain";

type FinancialAction = "apply" | "withdraw" | "select" | "confirm" | "complete" | null;

export default function DeliveryDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const {
    role, policy, deliveryById, candidatesForDelivery, driverCandidateForDelivery,
    applyToDelivery, withdrawFromDelivery, selectCandidate, confirmAssignedDelivery, completeDelivery, reviewForDelivery,
  } = useTikisStore();
  const delivery = deliveryById(params.id);
  const candidates = candidatesForDelivery(params.id);
  const ownCandidate = driverCandidateForDelivery(params.id);
  const [action, setAction] = useState<FinancialAction>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<DriverCandidate | null>(null);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");

  const actionConfig = useMemo(() => {
    if (!delivery) return null;
    const commission = selectedCandidate?.commissionBlocked ?? Math.round(delivery.estimatedPrice * policy.rate);
    if (action === "apply") return { title: "Envoyer votre candidature", description: "Cette commission sera temporairement bloquée sur votre Wallet. Elle sera prélevée seulement si vous êtes retenu puis confirmez la mission.", amount: commission, label: "Confirmer ma candidature", irreversible: false };
    if (action === "withdraw") return { title: "Retirer votre candidature", description: "Votre candidature sera retirée et la commission temporairement bloquée redeviendra immédiatement disponible.", amount: ownCandidate?.commissionBlocked ?? commission, label: "Retirer ma candidature", irreversible: false };
    if (action === "select") return { title: delivery.status === "active" ? "Remplacer le livreur" : "Choisir ce livreur", description: delivery.status === "active" ? "Le nouveau livreur devra confirmer sa disponibilité. Sa commission compensera automatiquement celle de l’ancien livreur : Tikis conservera une seule commission." : "Le livreur devra confirmer sa disponibilité avant le partage de vos coordonnées. La commission restera bloquée jusqu’à cette confirmation.", amount: commission, label: delivery.status === "active" ? "Demander le remplacement" : "Choisir ce livreur", irreversible: false };
    if (action === "confirm") return { title: "Confirmer la mission", description: "Votre confirmation autorise le partage des coordonnées avec l’expéditeur et finalise la mise en relation Tikis.", amount: ownCandidate?.commissionBlocked ?? commission, label: "Confirmer la mission", irreversible: true };
    if (action === "complete") return { title: "Terminer la livraison", description: "Confirmez uniquement lorsque la remise et le paiement direct avec l’expéditeur sont finalisés.", amount: 0, label: "Marquer comme terminée", irreversible: false };
    return null;
  }, [action, delivery, ownCandidate, policy.rate, selectedCandidate]);

  if (!delivery) {
    return <SafeAreaView style={styles.safe}><View style={styles.notFound}><Text style={styles.notFoundTitle}>Livraison introuvable</Text><TikisButton label="Retour aux courses" onPress={() => router.replace("/(tabs)/deliveries" as any)} /></View></SafeAreaView>;
  }

  const status = deliveryStatusMeta[delivery.status];
  const deliveryId = delivery.id;
  const canRevealContact = delivery.status === "active" || delivery.status === "completed";
  const review = reviewForDelivery(delivery.id);
  const showCandidates = role === "sender" && (delivery.status === "open" || delivery.status === "pending_confirmation" || delivery.status === "active");

  async function confirmAction() {
    setProcessing(true);
    await new Promise((resolve) => setTimeout(resolve, 450));
    if (action === "apply") {
      const result = applyToDelivery(deliveryId);
      if (!result.ok) setMessage(result.message ?? "La candidature n’a pas pu être envoyée.");
    }
    if (action === "withdraw") withdrawFromDelivery(deliveryId);
    if (action === "select" && selectedCandidate) selectCandidate(deliveryId, selectedCandidate.id);
    if (action === "confirm") confirmAssignedDelivery(deliveryId);
    if (action === "complete") completeDelivery(deliveryId);
    setProcessing(false);
    setAction(null);
    setSelectedCandidate(null);
    haptic.success();
  }

  function openCandidateAction(candidate: DriverCandidate) {
    setSelectedCandidate(candidate);
    setAction("select");
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <FlatList
        data={showCandidates ? candidates : []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        renderItem={({ item }) => <CandidateRow candidate={item} delivery={delivery} onChoose={() => openCandidateAction(item)} />}
        ListHeaderComponent={<>
          <View style={styles.topBar}><Pressable onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={22} color="#0B1F3A" /></Pressable><Text style={styles.topTitle}>Détail de livraison</Text><Pressable onPress={() => router.push(`/report/${deliveryId}` as any)} style={({ pressed }) => [styles.report, pressed && styles.pressed]}><MaterialIcons name="flag" size={20} color="#C23B45" /></Pressable></View>
          <StatusBadge label={status.label} color={status.color} background={status.background} />
          <Text style={styles.title}>{delivery.title}</Text>
          <Text style={styles.schedule}>{delivery.scheduledAt} · {delivery.distanceKm.toLocaleString("fr-FR")} km</Text>

          <SurfaceCard style={styles.routeCard}>
            <RouteLine label="Récupération" value={displayLocation(delivery.pickup)} tone="pickup" />
            <View style={styles.routeDivider} />
            <RouteLine label="Destination" value={displayLocation(delivery.dropoff)} tone="dropoff" />
          </SurfaceCard>

          <SectionHeading title="Détails" />
          <SurfaceCard style={styles.detailCard}>
            <DetailRow icon="category" label="Type" value={delivery.type} />
            {delivery.type === "Autre" && delivery.weightKg ? <DetailRow icon="scale" label="Poids" value={`${delivery.weightKg} kg`} /> : null}
            {delivery.type === "Autre" && delivery.dimensions ? <DetailRow icon="straighten" label="Dimensions" value={[delivery.dimensions.lengthCm, delivery.dimensions.widthCm, delivery.dimensions.heightCm].filter(Boolean).join(" × ") + " cm"} /> : null}
            {delivery.type === "Personne" && delivery.passengers ? <DetailRow icon="group" label="Nombre" value={`${delivery.passengers} personne`} /> : null}
            <DetailRow icon="two-wheeler" label="Engins" value={delivery.vehicleTypes.join(", ")} />
            <View style={styles.detailLast}><Text style={styles.detailDescription}>{delivery.details}</Text></View>
          </SurfaceCard>

          <SectionHeading title="Tarification" />
          <SurfaceCard style={styles.pricingCard}>
            <View style={styles.pricingRow}><Text style={styles.pricingLabel}>{delivery.offeredPrice ? "Frais proposés" : "Frais suggérés"}</Text><Text style={styles.pricingValue}>{formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice)}</Text></View>
            <Text style={styles.pricingNote}>{role === "sender" ? "Vous réglerez directement le livreur lors de la livraison." : "Votre gain reste informatif jusqu’à la confirmation de la mission."}</Text>
          </SurfaceCard>

          {role === "sender" && (delivery.status === "pending_confirmation" || delivery.status === "active") ? <TikisButton label="Suivre en direct" icon="my-location" variant="secondary" onPress={() => router.push(`/track/${deliveryId}` as any)} style={styles.trackButton} /> : null}

          {canRevealContact && delivery.driverName ? <><SectionHeading title="Mise en relation" /><SurfaceCard style={styles.contactCard}><View style={styles.contactTop}><Avatar initials={delivery.driverName.split(" ").map((part) => part[0]).join("")} color="#007B8B" /><View style={styles.contactInfo}><Text style={styles.contactName}>{role === "sender" ? delivery.driverName : delivery.senderName}</Text><Text style={styles.contactMeta}>{role === "sender" ? "Livreur confirmé" : "Expéditeur"}</Text></View><MaterialIcons name="verified" size={21} color="#18A572" /></View><TikisButton label={role === "sender" ? "Appeler le livreur" : "Appeler l’expéditeur"} variant="secondary" icon="phone" onPress={() => void Linking.openURL(`tel:${role === "sender" ? delivery.driverPhone : delivery.senderPhone}`)} style={styles.contactButton} /></SurfaceCard></> : null}

          {role === "driver" ? <DriverActions deliveryStatus={delivery.status} ownCandidateStatus={ownCandidate?.status} onApply={() => setAction("apply")} onWithdraw={() => setAction("withdraw")} onConfirm={() => setAction("confirm")} onComplete={() => setAction("complete")} /> : null}
          {showCandidates ? <SectionHeading title={delivery.status === "active" ? "Remplacer le livreur" : `Intéressés (${candidates.length})`} /> : null}
          {message ? <Text style={styles.message}>{message}</Text> : null}
        </>}
        ListEmptyComponent={showCandidates ? <Text style={styles.empty}>Aucun livreur n’a encore postulé à cette livraison.</Text> : null}
        ListFooterComponent={delivery.status === "completed" && role === "sender" ? review ? <SurfaceCard style={styles.reviewDone}><MaterialIcons name="star" size={20} color="#F59E0B" /><View style={styles.reviewDoneInfo}><Text style={styles.reviewDoneTitle}>Avis envoyé · {review.rating}/5</Text><Text style={styles.reviewDoneText}>{review.comment || "Votre évaluation est enregistrée dans votre historique."}</Text></View></SurfaceCard> : <TikisButton label="Noter le livreur" variant="ghost" icon="star-outline" onPress={() => router.push(`/review/${deliveryId}` as any)} style={styles.rateButton} /> : null}
      />
      {actionConfig ? <FinancialConfirmationModal visible title={actionConfig.title} description={actionConfig.description} amount={actionConfig.amount} confirmLabel={actionConfig.label} irreversible={actionConfig.irreversible} loading={processing} onCancel={() => { setAction(null); setSelectedCandidate(null); }} onConfirm={() => void confirmAction()} /> : null}
    </SafeAreaView>
  );
}

function CandidateRow({ candidate, delivery, onChoose }: { candidate: DriverCandidate; delivery: { status: string }; onChoose: () => void }) {
  const unavailable = candidate.status === "selected" || candidate.status === "confirmed";
  return <SurfaceCard style={styles.candidateCard}><View style={styles.candidateHeader}><Avatar initials={candidate.initials} color={candidate.id.includes("adama") ? "#7657A7" : "#007B8B"} /><View style={styles.candidateInfo}><Text style={styles.candidateName}>{candidate.name}</Text><Text style={styles.candidateMeta}>★ {candidate.rating.toLocaleString("fr-FR")} · {candidate.completedDeliveries} livraisons</Text></View>{candidate.isVerified ? <MaterialIcons name="verified" size={20} color="#18A572" /> : null}</View><View style={styles.candidateFooter}><View><Text style={styles.candidateVehicle}>{candidate.vehicles.join(", ")}</Text><Text style={styles.candidatePrice}>{formatMoney(candidate.offerPrice ?? candidate.commissionBlocked * 10)}</Text></View><TikisButton label={unavailable ? "En attente" : delivery.status === "active" ? "Remplacer" : "Choisir"} variant={unavailable ? "ghost" : "secondary"} onPress={onChoose} disabled={unavailable} style={styles.candidateButton} /></View></SurfaceCard>;
}

function DriverActions({ deliveryStatus, ownCandidateStatus, onApply, onWithdraw, onConfirm, onComplete }: { deliveryStatus: string; ownCandidateStatus?: string; onApply: () => void; onWithdraw: () => void; onConfirm: () => void; onComplete: () => void }) {
  if (deliveryStatus === "open") return <View style={styles.driverAction}>{ownCandidateStatus === "applied" ? <TikisButton label="Renoncer" variant="ghost" icon="undo" onPress={onWithdraw} /> : <TikisButton label="Se proposer" icon="add-task" onPress={onApply} />}<Text style={styles.driverHint}>{ownCandidateStatus === "applied" ? "Vous pouvez retirer votre candidature sans pénalité tant que vous n’êtes pas sélectionné." : "La commission sera temporairement bloquée et restera disponible si vous n’êtes pas retenu."}</Text></View>;
  if (deliveryStatus === "pending_confirmation" && ownCandidateStatus === "selected") return <View style={styles.driverAction}><TikisButton label="Confirmer la course" icon="check-circle" onPress={onConfirm} /><Text style={styles.driverHint}>Après confirmation, vos coordonnées seront partagées avec l’expéditeur.</Text></View>;
  if (deliveryStatus === "active" && ownCandidateStatus === "confirmed") return <View style={styles.driverAction}><TikisButton label="Marquer comme terminée" icon="task-alt" onPress={onComplete} /><Text style={styles.driverHint}>À utiliser après remise et paiement direct avec l’expéditeur.</Text></View>;
  return null;
}

function RouteLine({ label, value, tone }: { label: string; value: string; tone: "pickup" | "dropoff" }) { return <View style={styles.routeLineRow}><View style={[styles.routePin, tone === "pickup" ? styles.pickupPin : styles.dropoffPin]}>{tone === "pickup" ? <View style={styles.pinInner} /> : <MaterialIcons name="location-on" size={15} color="#FFFFFF" />}</View><View style={styles.routeLineInfo}><Text style={styles.routeLabel}>{label}</Text><Text style={styles.routeValue}>{value}</Text></View></View>; }
function DetailRow({ icon, label, value }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; value: string }) { return <View style={styles.detailRow}><MaterialIcons name={icon} size={18} color="#007B8B" /><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F6F8FC" }, content: { padding: 20, paddingBottom: 45 }, topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }, back: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E7ECF2", alignItems: "center", justifyContent: "center" }, report: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#FDEBEC", alignItems: "center", justifyContent: "center" }, topTitle: { color: "#0B1F3A", fontSize: 16, fontWeight: "900" }, title: { color: "#0B1F3A", fontSize: 26, lineHeight: 33, fontWeight: "900", marginTop: 12, letterSpacing: -0.4 }, schedule: { color: "#697386", fontSize: 13, marginTop: 5 }, routeCard: { marginTop: 21 }, routeLineRow: { flexDirection: "row", alignItems: "center" }, routePin: { width: 29, height: 29, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: 11 }, pickupPin: { backgroundColor: "#E5F6F7" }, dropoffPin: { backgroundColor: "#0B1F3A" }, pinInner: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#007B8B" }, routeLineInfo: { flex: 1 }, routeLabel: { color: "#8A96A8", fontSize: 11, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" }, routeValue: { color: "#0B1F3A", fontSize: 13, fontWeight: "700", marginTop: 2 }, routeDivider: { height: 15, width: 1, backgroundColor: "#C9D4DF", marginLeft: 14, marginVertical: 3 }, detailCard: { paddingVertical: 3 }, detailRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderColor: "#EEF2F6", gap: 9 }, detailLabel: { color: "#697386", fontSize: 13, flex: 1 }, detailValue: { color: "#0B1F3A", fontSize: 13, fontWeight: "800", textAlign: "right", flex: 1.4 }, detailLast: { paddingVertical: 12 }, detailDescription: { color: "#485569", fontSize: 13, lineHeight: 19 }, pricingCard: { backgroundColor: "#E5F6F7", borderColor: "#CDE4E7" }, pricingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, pricingLabel: { color: "#35656C", fontSize: 13, fontWeight: "800" }, pricingValue: { color: "#006572", fontSize: 19, fontWeight: "900" }, pricingNote: { color: "#4D7075", fontSize: 12, lineHeight: 18, marginTop: 5 }, trackButton: { marginTop: 12 }, contactCard: { padding: 15 }, contactTop: { flexDirection: "row", alignItems: "center", gap: 10 }, contactInfo: { flex: 1 }, contactName: { color: "#0B1F3A", fontSize: 16, fontWeight: "900" }, contactMeta: { color: "#697386", fontSize: 12, marginTop: 2 }, contactButton: { marginTop: 14 }, candidateCard: { marginBottom: 11 }, candidateHeader: { flexDirection: "row", alignItems: "center", gap: 10 }, candidateInfo: { flex: 1 }, candidateName: { color: "#0B1F3A", fontSize: 15, fontWeight: "900" }, candidateMeta: { color: "#697386", fontSize: 12, marginTop: 3 }, candidateFooter: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingTop: 13, marginTop: 13, borderTopWidth: 1, borderColor: "#EEF2F6" }, candidateVehicle: { color: "#697386", fontSize: 12 }, candidatePrice: { color: "#007B8B", fontSize: 15, fontWeight: "900", marginTop: 3 }, candidateButton: { minHeight: 40, paddingHorizontal: 13, borderRadius: 12 }, driverAction: { marginTop: 24, marginBottom: 6 }, driverHint: { color: "#697386", fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 10, paddingHorizontal: 12 }, empty: { textAlign: "center", color: "#8A96A8", marginBottom: 18 }, message: { color: "#C23B45", textAlign: "center", fontSize: 13, fontWeight: "800", marginTop: 12 }, rateButton: { marginTop: 18 }, reviewDone: { marginTop: 18, flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: "#FFF7E6", borderColor: "#F6D48F" }, reviewDoneInfo: { flex: 1 }, reviewDoneTitle: { color: "#8A5A0E", fontSize: 13, fontWeight: "900" }, reviewDoneText: { color: "#936C1B", fontSize: 12, lineHeight: 17, marginTop: 2 }, notFound: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 18 }, notFoundTitle: { color: "#0B1F3A", fontSize: 20, fontWeight: "900" }, pressed: { opacity: 0.67 },
});
