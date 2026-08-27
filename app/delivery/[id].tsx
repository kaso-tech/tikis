import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Linking, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FinancialConfirmationModal } from "@/components/tikis/financial-modal";
import { Avatar, SectionHeading, StatusBadge, SurfaceCard, TikisButton } from "@/components/tikis/ui";
import { haptic } from "@/lib/haptics";
import { offeredPriceError, parseOfferedPrice, sanitizeOfferedPriceInput } from "@/lib/delivery-price";
import { formatDeliveryDetailPlace } from "@/lib/geo-rules";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { deliveryStatusMeta, formatMoney, formatRelativeDate, type DriverCandidate } from "@/shared/tikis-domain";

type FinancialAction = "apply" | "withdraw" | "select" | "confirm" | "complete" | null;
type SenderAction = "disable" | "reactivate" | "cancel" | "delete" | null;

export default function DeliveryDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const { role, profile } = useTikisStore();
  const utilities = trpc.useUtils();
  const walletQuery = trpc.wallet.snapshot.useQuery(undefined, { enabled: Boolean(profile?.phone) });
  const deliveryQuery = trpc.deliveries.get.useQuery({ id: params.id ?? "00000000-0000-4000-8000-000000000000" }, { enabled: Boolean(params.id && profile?.phone) });
  const candidatesQuery = trpc.deliveries.candidates.useQuery({ deliveryId: params.id ?? "00000000-0000-4000-8000-000000000000" }, { enabled: Boolean(params.id && profile?.phone) });
  const applyMutation = trpc.deliveries.submitApplication.useMutation();
  const withdrawMutation = trpc.deliveries.withdraw.useMutation();
  const selectMutation = trpc.deliveries.selectCandidate.useMutation();
  const confirmMutation = trpc.deliveries.confirm.useMutation();
  const completeMutation = trpc.deliveries.complete.useMutation();
  const disableMutation = trpc.deliveries.disable.useMutation();
  const reactivateMutation = trpc.deliveries.reactivate.useMutation();
  const cancelMutation = trpc.deliveries.cancel.useMutation();
  const reviewQuery = trpc.reviews.getForDelivery.useQuery({ deliveryId: params.id ?? "00000000-0000-4000-8000-000000000000" }, { enabled: Boolean(params.id && profile?.phone) });
  const delivery = deliveryQuery.data;
  const candidates = candidatesQuery.data ?? [];
  const ownCandidate = candidates.find((candidate) => candidate.driverId === profile?.phone);
  const [action, setAction] = useState<FinancialAction>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<DriverCandidate | null>(null);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");
  const [counterVisible, setCounterVisible] = useState(false);
  const [counterInput, setCounterInput] = useState("");
  const [counterError, setCounterError] = useState("");
  const [counterLoading, setCounterLoading] = useState(false);
  const [senderAction, setSenderAction] = useState<SenderAction>(null);
  const [senderProcessing, setSenderProcessing] = useState(false);
  const [openingMap, setOpeningMap] = useState(false);

  async function refreshDelivery() {
    await Promise.all([
      utilities.deliveries.get.invalidate({ id: params.id ?? "" }),
      utilities.deliveries.candidates.invalidate({ deliveryId: params.id ?? "" }),
      utilities.deliveries.list.invalidate(),
      utilities.wallet.snapshot.invalidate(),
      utilities.notifications.list.invalidate(),
    ]);
  }

  const actionConfig = useMemo(() => {
    if (!delivery) return null;
    const commissionBase = delivery.offeredPrice ?? delivery.estimatedPrice;
    const commission = selectedCandidate?.commissionBlocked ?? Math.round(commissionBase * (walletQuery.data?.commissionRate ?? 0));
    if (action === "apply") return { title: "Envoyer votre candidature", description: "Cette commission sera temporairement bloquée sur votre Wallet. Elle sera définitivement prélevée uniquement si l’expéditeur vous sélectionne.", amount: commission, label: "Confirmer ma candidature", irreversible: false };
    if (action === "withdraw") return { title: "Retirer votre candidature", description: "Votre candidature sera retirée et la commission temporairement bloquée redeviendra immédiatement disponible.", amount: ownCandidate?.commissionBlocked ?? commission, label: "Retirer ma candidature", irreversible: false };
    if (action === "select") return { title: delivery.status === "active" ? "Remplacer le livreur" : "Choisir ce livreur", description: delivery.status === "active" ? "Le nouveau livreur devra confirmer sa disponibilité. Sa commission compensera automatiquement celle de l’ancien livreur : Tikis conservera une seule commission." : "Le choix rend la mise en relation effective. La commission bloquée du livreur sera définitivement prélevée et les autres commissions seront libérées.", amount: commission, label: delivery.status === "active" ? "Demander le remplacement" : "Choisir ce livreur", irreversible: true };
    if (action === "confirm") return { title: "Confirmer la mission", description: "Votre confirmation autorise le partage des coordonnées avec l’expéditeur et finalise la mise en relation Tikis.", amount: ownCandidate?.commissionBlocked ?? commission, label: "Confirmer la mission", irreversible: true };
    if (action === "complete") return { title: "Terminer la livraison", description: "Confirmez uniquement lorsque la remise et le paiement direct avec l’expéditeur sont finalisés.", amount: 0, label: "Marquer comme terminée", irreversible: false };
    return null;
  }, [action, delivery, ownCandidate, selectedCandidate, walletQuery.data?.commissionRate]);

  const senderActionConfig = useMemo(() => {
    if (senderAction === "disable") return { title: "Désactiver la livraison", description: "Elle ne sera plus visible pour de nouveaux livreurs. Les candidatures en cours seront annulées et les commissions temporairement bloquées seront libérées.", confirmLabel: "Désactiver", tone: "warning" as const };
    if (senderAction === "reactivate") return { title: "Activer la livraison", description: "La livraison redeviendra visible pour les livreurs compatibles. Les anciennes candidatures restent annulées afin de leur permettre de se proposer avec les informations actuelles.", confirmLabel: "Activer", tone: "success" as const };
    if (senderAction === "cancel") return { title: "Annuler la livraison", description: "Cette action est réservée aux courses qui n’ont pas encore démarré. La livraison sera conservée dans votre historique avec son statut d’annulation.", confirmLabel: "Annuler la livraison", tone: "danger" as const };
    if (senderAction === "delete") return { title: "Supprimer la livraison", description: "Pour préserver la traçabilité et les écritures Wallet, cette demande sera annulée puis conservée dans l’historique plutôt que supprimée définitivement.", confirmLabel: "Supprimer", tone: "danger" as const };
    return null;
  }, [senderAction]);

  if (deliveryQuery.isLoading) {
    return <SafeAreaView style={styles.safe}><View style={styles.notFound}><Text style={styles.notFoundTitle}>Chargement de la livraison…</Text></View></SafeAreaView>;
  }

  if (!delivery) {
    return <SafeAreaView style={styles.safe}><View style={styles.notFound}><Text style={styles.notFoundTitle}>Livraison introuvable</Text><TikisButton label="Retour aux courses" onPress={() => router.replace("/(tabs)/deliveries" as any)} /></View></SafeAreaView>;
  }

  const status = deliveryStatusMeta[delivery.status];
  const deliveryId = delivery.id;
  const canRevealContact = delivery.status === "active" || delivery.status === "completed";
  const review = reviewQuery.data;
  const showCandidates = role === "sender" && (delivery.status === "open" || delivery.status === "pending_confirmation" || delivery.status === "active");
  const canEdit = role === "sender" && (delivery.status === "open" || delivery.status === "disabled");
  const canDisable = role === "sender" && delivery.status === "open";
  const canReactivate = role === "sender" && delivery.status === "disabled";
  const canCancel = role === "sender" && (delivery.status === "open" || delivery.status === "disabled" || delivery.status === "pending_confirmation");
  const pickupPresentation = formatDeliveryDetailPlace(delivery.pickup);
  const dropoffPresentation = formatDeliveryDetailPlace(delivery.dropoff);

  async function confirmAction() {
    setProcessing(true);
    try {
      if (action === "apply") await applyMutation.mutateAsync({ deliveryId });
      if (action === "withdraw") await withdrawMutation.mutateAsync({ deliveryId });
      if (action === "select" && selectedCandidate) await selectMutation.mutateAsync({ deliveryId, candidateId: selectedCandidate.id });
      if (action === "confirm") await confirmMutation.mutateAsync({ deliveryId });
      if (action === "complete") await completeMutation.mutateAsync({ deliveryId });
      await refreshDelivery();
      setAction(null);
      setSelectedCandidate(null);
      haptic.success();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Cette action n’a pas pu être enregistrée.");
    } finally { setProcessing(false); }
  }

  async function confirmSenderAction() {
    setSenderProcessing(true);
    try {
      if (senderAction === "disable") await disableMutation.mutateAsync({ deliveryId });
      if (senderAction === "reactivate") await reactivateMutation.mutateAsync({ deliveryId });
      if (senderAction === "cancel" || senderAction === "delete") await cancelMutation.mutateAsync({ deliveryId });
      await refreshDelivery();
      setSenderAction(null);
      haptic.success();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Cette action n’a pas pu être enregistrée.");
    } finally { setSenderProcessing(false); }
  }

  function openMap() {
    setOpeningMap(true);
    router.push(`/delivery/${deliveryId}/map` as any);
    setTimeout(() => setOpeningMap(false), 500);
  }

  function openCandidateAction(candidate: DriverCandidate) {
    setSelectedCandidate(candidate);
    setAction("select");
  }

  function openCounterOffer() {
    if (!delivery) return;
    setCounterError("");
    setCounterInput(String(ownCandidate?.offerPrice ?? delivery.offeredPrice ?? delivery.estimatedPrice));
    setCounterVisible(true);
  }

  async function submitCounterOffer() {
    const amount = parseOfferedPrice(counterInput);
    const inputError = offeredPriceError(counterInput);
    if (!amount || inputError) { setCounterError(inputError ?? "Saisissez un prix valide."); return; }
    setCounterLoading(true); setCounterError("");
    try {
      await applyMutation.mutateAsync({ deliveryId, offerPrice: amount });
      await refreshDelivery();
      setCounterVisible(false); setMessage("Votre contre-proposition a été envoyée à l’expéditeur."); haptic.success();
    } catch (cause) {
      setCounterError(cause instanceof Error ? cause.message : "La contre-proposition n’a pas pu être envoyée.");
    } finally { setCounterLoading(false); }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <FlatList
        data={showCandidates ? candidates : []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        renderItem={({ item }) => <CandidateRow candidate={item} delivery={delivery} loading={processing && selectedCandidate?.id === item.id} onChoose={() => openCandidateAction(item)} />}
        ListHeaderComponent={<>
          <View style={styles.topBar}><Pressable onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={22} color="#0B1F3A" /></Pressable><Text style={styles.topTitle}>Livraison</Text><Pressable onPress={() => router.push(`/report/${deliveryId}` as any)} style={({ pressed }) => [styles.report, pressed && styles.pressed]}><MaterialIcons name="flag" size={20} color="#C23B45" /></Pressable></View>
          <StatusBadge label={status.label} color={status.color} background={status.background} />
          {role === "driver" ? <><Text style={styles.driverStatusLabel}>Statut</Text><Text style={styles.driverStatus}>{status.label}</Text></> : <Text style={styles.title}>{delivery.title}</Text>}
          <Text style={styles.schedule}>{delivery.status === "open" ? `Créée ${formatRelativeDate(delivery.createdAt).toLocaleLowerCase("fr-FR")}` : formatRelativeDate(delivery.createdAt)} · <Text style={styles.distanceText}>{delivery.distanceKm.toLocaleString("fr-FR")} km</Text></Text>
          {delivery.routeSource === "provisional" ? <Text style={styles.provisionalRoute}>Distance et estimation provisoires, à recalculer avec Routes API dès que le service est activé.</Text> : null}

          <SurfaceCard style={styles.routeCard}>
            <RouteLine label="Récupération" title={pickupPresentation.title} subtitle={pickupPresentation.subtitle} tone="pickup" />
            <View style={styles.routeDivider} />
            <RouteLine label="Destination" title={dropoffPresentation.title} subtitle={dropoffPresentation.subtitle} tone="dropoff" />
          </SurfaceCard>
          <TikisButton label="Voir sur la carte" icon="map" variant="secondary" onPress={openMap} loading={openingMap} loadingLabel="Ouverture de la carte…" style={styles.mapButton} />

          <SectionHeading title="Détails" />
          <SurfaceCard style={styles.detailCard}>
            <DetailRow icon="title" label="Titre" value={delivery.title} />
            <DetailRow icon="category" label="Type" value={delivery.type} />
            {delivery.type === "Autre" && delivery.weightKg ? <DetailRow icon="scale" label="Poids" value={`${delivery.weightKg} kg`} /> : null}
            {delivery.type === "Autre" && delivery.dimensions ? <DetailRow icon="straighten" label="Dimensions" value={[delivery.dimensions.lengthCm, delivery.dimensions.widthCm, delivery.dimensions.heightCm].filter(Boolean).join(" × ") + " cm"} /> : null}
            {delivery.type === "Personne" && delivery.passengers ? <DetailRow icon="group" label="Nombre" value={`${delivery.passengers} personne`} /> : null}
            <DetailRow icon="route" label="Distance" value={`${delivery.distanceKm.toLocaleString("fr-FR")} km`} />
            <DetailRow icon="two-wheeler" label="Engins" value={delivery.vehicleTypes.join(", ")} />
            <View style={styles.detailLast}><Text style={styles.detailDescription}>{delivery.details}</Text></View>
          </SurfaceCard>

          <SectionHeading title="Tarification" />
          <SurfaceCard style={styles.pricingCard}>
            <View style={styles.pricingRow}><Text style={styles.pricingLabel}>{role === "driver" ? ownCandidate?.offerPrice ? "Frais client" : "Frais de la course" : "Frais de livraison"}</Text><Text style={styles.pricingValue}>{formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice)}</Text></View>
            {role === "driver" && ownCandidate?.offerPrice ? <View style={styles.counterPrice}><Text style={styles.counterPriceLabel}>Frais proposé</Text><Text style={styles.counterPriceValue}>{formatMoney(ownCandidate.offerPrice)}</Text></View> : null}
            <Text style={styles.pricingNote}>{role === "sender" ? "Vous réglerez directement le livreur lors de la livraison." : "Votre gain reste informatif jusqu’à la confirmation de la mission."}</Text>
          </SurfaceCard>

          {role === "sender" && (delivery.status === "pending_confirmation" || delivery.status === "active") ? <TikisButton label="Suivre en direct" icon="my-location" variant="secondary" onPress={() => router.push(`/track/${deliveryId}` as any)} style={styles.trackButton} /> : null}
          {role === "sender" ? <View style={styles.senderActions}>
            {canEdit ? <TikisButton label="Modifier la livraison" icon="edit" variant="secondary" onPress={() => router.push({ pathname: "/create-delivery", params: { deliveryId } } as any)} disabled={senderProcessing} style={styles.senderActionButton} /> : null}
            {canReactivate ? <TikisButton label="Activer la livraison" icon="play-circle" onPress={() => setSenderAction("reactivate")} loading={senderProcessing && senderAction === "reactivate"} disabled={senderProcessing} style={styles.senderActionButton} /> : null}
            {canDisable ? <TikisButton label="Désactiver la livraison" icon="pause-circle" variant="secondary" onPress={() => setSenderAction("disable")} loading={senderProcessing && senderAction === "disable"} disabled={senderProcessing} style={styles.senderActionButton} /> : null}
            {canCancel ? <TikisButton label="Annuler la livraison" icon="cancel" variant="ghost" onPress={() => setSenderAction("cancel")} loading={senderProcessing && senderAction === "cancel"} disabled={senderProcessing} style={styles.senderActionButton} /> : null}
            {canCancel ? <TikisButton label="Supprimer" icon="delete-outline" variant="danger" onPress={() => setSenderAction("delete")} loading={senderProcessing && senderAction === "delete"} disabled={senderProcessing} style={styles.deleteActionButton} /> : null}
          </View> : null}

          {canRevealContact && delivery.driverName ? <><SectionHeading title="Mise en relation" /><SurfaceCard style={styles.contactCard}><View style={styles.contactTop}><Avatar initials={delivery.driverName.split(" ").map((part) => part[0]).join("")} color="#007B8B" /><View style={styles.contactInfo}><Text style={styles.contactName}>{role === "sender" ? delivery.driverName : delivery.senderName}</Text><Text style={styles.contactMeta}>{role === "sender" ? "Livreur confirmé" : "Expéditeur"}</Text></View><MaterialIcons name="verified" size={21} color="#18A572" /></View><TikisButton label={role === "sender" ? "Appeler le livreur" : "Appeler l’expéditeur"} variant="secondary" icon="phone" onPress={() => void Linking.openURL(`tel:${role === "sender" ? delivery.driverPhone : delivery.senderPhone}`)} style={styles.contactButton} /></SurfaceCard></> : null}

          {role === "driver" ? <DriverActions deliveryStatus={delivery.status} ownCandidateStatus={ownCandidate?.status} loading={processing} onApply={() => setAction("apply")} onCounterOffer={openCounterOffer} onWithdraw={() => setAction("withdraw")} onConfirm={() => setAction("confirm")} onComplete={() => setAction("complete")} /> : null}
          {showCandidates ? <SectionHeading title={delivery.status === "active" ? "Remplacer le livreur" : `Livreurs qui se sont proposés (${candidates.length})`} /> : null}
          {message ? <Text style={styles.message}>{message}</Text> : null}
        </>}
        ListEmptyComponent={showCandidates ? <Text style={styles.empty}>Aucun livreur n’a encore postulé à cette livraison.</Text> : null}
        ListFooterComponent={delivery.status === "completed" && role === "sender" ? review ? <SurfaceCard style={styles.reviewDone}><MaterialIcons name="star" size={20} color="#F59E0B" /><View style={styles.reviewDoneInfo}><Text style={styles.reviewDoneTitle}>Avis envoyé · {review.rating}/5</Text><Text style={styles.reviewDoneText}>{review.comment || "Votre évaluation est enregistrée dans votre historique."}</Text></View></SurfaceCard> : <TikisButton label="Noter le livreur" variant="ghost" icon="star-outline" onPress={() => router.push(`/review/${deliveryId}` as any)} style={styles.rateButton} /> : null}
      />
      {actionConfig ? <FinancialConfirmationModal visible title={actionConfig.title} description={actionConfig.description} amount={actionConfig.amount} confirmLabel={actionConfig.label} irreversible={actionConfig.irreversible} loading={processing} onCancel={() => { setAction(null); setSelectedCandidate(null); }} onConfirm={() => void confirmAction()} /> : null}
      {senderActionConfig ? <DeliveryActionConfirmationModal visible title={senderActionConfig.title} description={senderActionConfig.description} confirmLabel={senderActionConfig.confirmLabel} tone={senderActionConfig.tone} loading={senderProcessing} onCancel={() => !senderProcessing && setSenderAction(null)} onConfirm={() => void confirmSenderAction()} /> : null}
      <Modal visible={counterVisible} transparent animationType="fade" onRequestClose={() => !counterLoading && setCounterVisible(false)}>
        <View style={styles.counterOverlay}><View style={styles.counterDialog}>
          <View style={styles.counterIcon}><MaterialIcons name="price-change" size={24} color="#007B8B" /></View>
          <Text style={styles.counterTitle}>{ownCandidate ? "Modifier votre contre-proposition" : "Faire une contre-proposition"}</Text>
          <Text style={styles.counterText}>Proposez le montant que vous souhaitez percevoir. La commission Tikis sera ajustée sur ce prix si l’expéditeur vous retient.</Text>
          <View style={styles.counterInputWrap}><TextInput value={counterInput} onChangeText={(value) => setCounterInput(sanitizeOfferedPriceInput(value))} keyboardType="number-pad" maxLength={8} autoFocus style={styles.counterInput} placeholder="Ex. 6 500" placeholderTextColor="#9AA5B6" /><Text style={styles.counterCurrency}>FCFA</Text></View>
          {counterError ? <Text style={styles.counterError}>{counterError}</Text> : <Text style={styles.counterHint}>Prix client : {formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice)}</Text>}
          <View style={styles.counterActions}><TikisButton label="Annuler" variant="secondary" onPress={() => setCounterVisible(false)} disabled={counterLoading} style={styles.counterAction} /><TikisButton label="Envoyer" icon="send" onPress={() => void submitCounterOffer()} loading={counterLoading} style={styles.counterAction} /></View>
        </View></View>
      </Modal>
    </SafeAreaView>
  );
}

function CandidateRow({ candidate, delivery, loading, onChoose }: { candidate: DriverCandidate; delivery: { status: string }; loading: boolean; onChoose: () => void }) {
  const unavailable = candidate.status === "selected" || candidate.status === "confirmed";
  return <SurfaceCard style={styles.candidateCard}><View style={styles.candidateHeader}><Avatar initials={candidate.initials} color="#007B8B" /><View style={styles.candidateInfo}><Text style={styles.candidateName}>{candidate.name}</Text><Text style={styles.candidateMeta}>{candidate.completedDeliveries ? `★ ${candidate.rating.toLocaleString("fr-FR")} · ${candidate.completedDeliveries} livraisons` : "Aucune note · Profil Tikis vérifié"}</Text></View>{candidate.isVerified ? <MaterialIcons name="verified" size={20} color="#18A572" /> : null}</View><View style={styles.candidateFooter}><View><Text style={styles.candidateVehicle}>{candidate.vehicles.join(", ") || "Engin à confirmer"}</Text><Text style={styles.candidatePrice}>{formatMoney(candidate.offerPrice ?? candidate.commissionBlocked * 10)}</Text></View><TikisButton label={unavailable ? "En attente" : delivery.status === "active" ? "Remplacer" : "Choisir"} variant={unavailable ? "ghost" : "secondary"} onPress={onChoose} disabled={unavailable || loading} loading={loading} style={styles.candidateButton} /></View></SurfaceCard>;
}

function DeliveryActionConfirmationModal({ visible, title, description, confirmLabel, tone, loading, onCancel, onConfirm }: { visible: boolean; title: string; description: string; confirmLabel: string; tone: "success" | "warning" | "danger"; loading: boolean; onCancel: () => void; onConfirm: () => void }) {
  const color = tone === "danger" ? "#C23B45" : tone === "warning" ? "#B45309" : "#007B8B";
  const background = tone === "danger" ? "#FDEBEC" : tone === "warning" ? "#FFF4D8" : "#E5F6F7";
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}><View style={styles.actionOverlay}><Pressable style={styles.actionBackdrop} onPress={onCancel} /><View style={styles.actionSheet}><View style={styles.actionHandle} /><View style={[styles.actionIcon, { backgroundColor: background }]}><MaterialIcons name={tone === "danger" ? "warning-amber" : tone === "warning" ? "pause-circle" : "play-circle"} size={25} color={color} /></View><Text style={styles.actionTitle}>{title}</Text><Text style={styles.actionDescription}>{description}</Text><TikisButton label={confirmLabel} variant={tone === "danger" ? "danger" : tone === "warning" ? "secondary" : "primary"} onPress={onConfirm} loading={loading} style={styles.actionConfirm} /><TikisButton label="Conserver la livraison" variant="ghost" onPress={onCancel} disabled={loading} style={styles.actionCancel} /></View></View></Modal>;
}

function DriverActions({ deliveryStatus, ownCandidateStatus, loading, onApply, onCounterOffer, onWithdraw, onConfirm, onComplete }: { deliveryStatus: string; ownCandidateStatus?: string; loading: boolean; onApply: () => void; onCounterOffer: () => void; onWithdraw: () => void; onConfirm: () => void; onComplete: () => void }) {
  if (deliveryStatus === "open") return <View style={styles.driverAction}>{ownCandidateStatus === "applied" ? <TikisButton label="Renoncer" variant="ghost" icon="undo" onPress={onWithdraw} loading={loading} disabled={loading} /> : <><TikisButton label="Se proposer" icon="add-task" onPress={onApply} loading={loading} disabled={loading} /><TikisButton label="Faire une contre-proposition" variant="secondary" icon="price-change" onPress={onCounterOffer} disabled={loading} style={styles.secondaryDriverAction} /></>}<Text style={styles.driverHint}>{ownCandidateStatus === "applied" ? "Votre candidature est enregistrée. Vous pouvez la retirer tant que vous n’êtes pas sélectionné." : "Vous pouvez candidater au prix client ou proposer un montant différent."}</Text></View>;
  if (deliveryStatus === "pending_confirmation" && ownCandidateStatus === "selected") return <View style={styles.driverAction}><TikisButton label="Confirmer la course" icon="check-circle" onPress={onConfirm} loading={loading} disabled={loading} /><Text style={styles.driverHint}>Après confirmation, vos coordonnées seront partagées avec l’expéditeur.</Text></View>;
  if (deliveryStatus === "active" && ownCandidateStatus === "confirmed") return <View style={styles.driverAction}><TikisButton label="Marquer comme terminée" icon="task-alt" onPress={onComplete} loading={loading} disabled={loading} /><Text style={styles.driverHint}>À utiliser après remise et paiement direct avec l’expéditeur.</Text></View>;
  return null;
}

function RouteLine({ label, title, subtitle, tone }: { label: string; title: string; subtitle: string; tone: "pickup" | "dropoff" }) { return <View style={styles.routeLineRow}><View style={[styles.routePin, tone === "pickup" ? styles.pickupPin : styles.dropoffPin]}>{tone === "pickup" ? <View style={styles.pinInner} /> : <MaterialIcons name="location-on" size={15} color="#FFFFFF" />}</View><View style={styles.routeLineInfo}><Text style={styles.routeLabel}>{label}</Text><Text style={styles.routeValue}>{title}</Text><Text style={styles.routeMeta} numberOfLines={2}>{subtitle}</Text></View></View>; }
function DetailRow({ icon, label, value }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; value: string }) { return <View style={styles.detailRow}><MaterialIcons name={icon} size={18} color="#007B8B" /><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>; }

const baseStyles: any = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F6F8FC" }, content: { padding: 20, paddingBottom: 45 }, topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }, back: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E7ECF2", alignItems: "center", justifyContent: "center" }, report: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#FDEBEC", alignItems: "center", justifyContent: "center" }, topTitle: { color: "#0B1F3A", fontSize: 16, fontWeight: "900" }, title: { color: "#0B1F3A", fontSize: 26, lineHeight: 33, fontWeight: "900", marginTop: 12, letterSpacing: -0.4 }, schedule: { color: "#697386", fontSize: 13, marginTop: 5 }, provisionalRoute: { color: "#9A6700", fontSize: 11, fontWeight: "800", lineHeight: 16, marginTop: 7 }, routeCard: { marginTop: 21 }, routeLineRow: { flexDirection: "row", alignItems: "center" }, routePin: { width: 29, height: 29, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: 11 }, pickupPin: { backgroundColor: "#E5F6F7" }, dropoffPin: { backgroundColor: "#0B1F3A" }, pinInner: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#007B8B" }, routeLineInfo: { flex: 1 }, routeLabel: { color: "#8A96A8", fontSize: 11, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" }, routeValue: { color: "#0B1F3A", fontSize: 13, fontWeight: "700", marginTop: 2 }, routeMeta: { color: "#697386", fontSize: 11, lineHeight: 16, marginTop: 2 }, routeDivider: { height: 15, width: 1, backgroundColor: "#C9D4DF", marginLeft: 14, marginVertical: 3 }, detailCard: { paddingVertical: 3 }, detailRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderColor: "#EEF2F6", gap: 9 }, detailLabel: { color: "#697386", fontSize: 13, flex: 1 }, detailValue: { color: "#0B1F3A", fontSize: 13, fontWeight: "800", textAlign: "right", flex: 1.4 }, detailLast: { paddingVertical: 12 }, detailDescription: { color: "#485569", fontSize: 13, lineHeight: 19 }, pricingCard: { backgroundColor: "#E5F6F7", borderColor: "#CDE4E7" }, pricingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, pricingLabel: { color: "#35656C", fontSize: 13, fontWeight: "800" }, pricingValue: { color: "#006572", fontSize: 19, fontWeight: "900" }, estimateReference: { color: "#4D7075", fontSize: 11, fontWeight: "700", marginTop: 2 }, counterPrice: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 9, paddingTop: 9, borderTopWidth: 1, borderColor: "#C8E6E8" }, counterPriceLabel: { color: "#35656C", fontSize: 12, fontWeight: "800" }, counterPriceValue: { color: "#006572", fontSize: 15, fontWeight: "900" }, pricingNote: { color: "#4D7075", fontSize: 12, lineHeight: 18, marginTop: 5 }, trackButton: { marginTop: 12 }, contactCard: { padding: 15 }, contactTop: { flexDirection: "row", alignItems: "center", gap: 10 }, contactInfo: { flex: 1 }, contactName: { color: "#0B1F3A", fontSize: 16, fontWeight: "900" }, contactMeta: { color: "#697386", fontSize: 12, marginTop: 2 }, contactButton: { marginTop: 14 }, candidateCard: { marginBottom: 11 }, candidateHeader: { flexDirection: "row", alignItems: "center", gap: 10 }, candidateInfo: { flex: 1 }, candidateName: { color: "#0B1F3A", fontSize: 15, fontWeight: "900" }, candidateMeta: { color: "#697386", fontSize: 12, marginTop: 3 }, candidateFooter: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingTop: 13, marginTop: 13, borderTopWidth: 1, borderColor: "#EEF2F6" }, candidateVehicle: { color: "#697386", fontSize: 12 }, candidatePrice: { color: "#007B8B", fontSize: 15, fontWeight: "900", marginTop: 3 }, candidateButton: { minHeight: 40, paddingHorizontal: 13, borderRadius: 12 }, driverAction: { marginTop: 24, marginBottom: 6 }, secondaryDriverAction: { marginTop: 10 }, driverHint: { color: "#697386", fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 10, paddingHorizontal: 12 }, empty: { textAlign: "center", color: "#8A96A8", marginBottom: 18 }, message: { color: "#C23B45", textAlign: "center", fontSize: 13, fontWeight: "800", marginTop: 12 }, rateButton: { marginTop: 18 }, reviewDone: { marginTop: 18, flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: "#FFF7E6", borderColor: "#F6D48F" }, reviewDoneInfo: { flex: 1 }, reviewDoneTitle: { color: "#8A5A0E", fontSize: 13, fontWeight: "900" }, reviewDoneText: { color: "#936C1B", fontSize: 12, lineHeight: 17, marginTop: 2 }, counterOverlay: { flex: 1, backgroundColor: "rgba(11,31,58,0.42)", alignItems: "center", justifyContent: "center", padding: 24 }, counterDialog: { width: "100%", maxWidth: 400, backgroundColor: "#FFFFFF", borderRadius: 22, padding: 20 }, counterIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: "#E6F5F6", alignSelf: "center", alignItems: "center", justifyContent: "center", marginBottom: 10 }, counterTitle: { color: "#0B1F3A", fontSize: 18, fontWeight: "900", textAlign: "center" }, counterText: { color: "#697386", fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 7 }, counterInputWrap: { minHeight: 52, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#B8DDE0", borderRadius: 14, paddingHorizontal: 14, marginTop: 17 }, counterInput: { flex: 1, color: "#0B1F3A", fontSize: 16, fontWeight: "900", minHeight: 45 }, counterCurrency: { color: "#697386", fontSize: 12, fontWeight: "900", marginLeft: 8 }, counterHint: { color: "#4D7075", fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 7 }, counterError: { color: "#C23B45", fontSize: 11, fontWeight: "700", lineHeight: 16, textAlign: "center", marginTop: 7 }, counterActions: { flexDirection: "row", gap: 10, marginTop: 18 }, counterAction: { flex: 1, minHeight: 45 }, notFound: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 18 }, notFoundTitle: { color: "#0B1F3A", fontSize: 20, fontWeight: "900" }, pressed: { opacity: 0.67 },
});

Object.assign(baseStyles, {
  distanceText: { color: "#0B1F3A", fontWeight: "900" },
  mapButton: { marginTop: 11 },
  senderActions: { marginTop: 12, gap: 9 },
  senderActionButton: { minHeight: 46 },
  deleteActionButton: { minHeight: 46, marginTop: 1 },
  actionOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(11,31,58,0.38)" },
  actionBackdrop: { ...StyleSheet.absoluteFillObject },
  actionSheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, paddingTop: 10, paddingBottom: 27 },
  actionHandle: { width: 40, height: 4, borderRadius: 3, backgroundColor: "#D8E0EA", alignSelf: "center", marginBottom: 17 },
  actionIcon: { width: 49, height: 49, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 13 },
  actionTitle: { color: "#0B1F3A", fontSize: 21, fontWeight: "900" },
  actionDescription: { color: "#5E6B7C", fontSize: 13, lineHeight: 20, marginTop: 7 },
  actionConfirm: { marginTop: 21 },
  actionCancel: { marginTop: 7 },
  driverStatusLabel: { color: "#8A96A8", fontSize: 11, fontWeight: "900", letterSpacing: 0.5, marginTop: 12, textTransform: "uppercase" },
  driverStatus: { color: "#0B1F3A", fontSize: 15, fontWeight: "900", marginTop: 3 },
});

const styles: any = StyleSheet.create({
  ...baseStyles,
  safe: { ...baseStyles.safe, backgroundColor: "#EEEDF3" },
  content: { ...baseStyles.content, padding: 16, paddingBottom: 28 },
  topBar: { ...baseStyles.topBar, marginBottom: 16 },
  back: { ...baseStyles.back, borderRadius: 8, borderWidth: 0 },
  report: { ...baseStyles.report, borderRadius: 8 },
  topTitle: { ...baseStyles.topTitle, color: "#111111", fontWeight: "600" },
  title: { ...baseStyles.title, color: "#111111", fontWeight: "600", fontSize: 24, lineHeight: 30, marginTop: 10 },
  provisionalRoute: { ...baseStyles.provisionalRoute, fontWeight: "600" },
  routeCard: { ...baseStyles.routeCard, marginTop: 16 },
  routePin: { ...baseStyles.routePin, borderRadius: 8 },
  routeLabel: { ...baseStyles.routeLabel, fontWeight: "600" },
  routeValue: { ...baseStyles.routeValue, color: "#111111", fontWeight: "600" },
  detailRow: { ...baseStyles.detailRow, paddingVertical: 10, borderBottomWidth: 0 },
  detailLast: { ...baseStyles.detailLast, paddingVertical: 10 },
  detailValue: { ...baseStyles.detailValue, color: "#111111", fontWeight: "600" },
  pricingCard: { ...baseStyles.pricingCard, backgroundColor: "#FFFFFF", borderWidth: 0 },
  pricingLabel: { ...baseStyles.pricingLabel, color: "#555555", fontWeight: "600" },
  pricingValue: { ...baseStyles.pricingValue, color: "#111111", fontWeight: "600" },
  counterPrice: { ...baseStyles.counterPrice, borderTopWidth: 0 },
  counterPriceLabel: { ...baseStyles.counterPriceLabel, color: "#555555", fontWeight: "600" },
  counterPriceValue: { ...baseStyles.counterPriceValue, color: "#111111", fontWeight: "600" },
  contactCard: { ...baseStyles.contactCard, padding: 13 },
  contactName: { ...baseStyles.contactName, color: "#111111", fontWeight: "600" },
  candidateCard: { ...baseStyles.candidateCard, marginBottom: 8 },
  candidateName: { ...baseStyles.candidateName, color: "#111111", fontWeight: "600" },
  candidateFooter: { ...baseStyles.candidateFooter, paddingTop: 10, marginTop: 10, borderTopWidth: 0 },
  candidatePrice: { ...baseStyles.candidatePrice, fontWeight: "600" },
  candidateButton: { ...baseStyles.candidateButton, borderRadius: 8 },
  driverAction: { ...baseStyles.driverAction, marginTop: 18 },
  reviewDone: { ...baseStyles.reviewDone, borderWidth: 0 },
  reviewDoneTitle: { ...baseStyles.reviewDoneTitle, fontWeight: "600" },
  counterOverlay: { ...baseStyles.counterOverlay, backgroundColor: "rgba(0,0,0,0.42)", padding: 16 },
  counterDialog: { ...baseStyles.counterDialog, borderRadius: 12, padding: 16 },
  counterIcon: { ...baseStyles.counterIcon, borderRadius: 9 },
  counterTitle: { ...baseStyles.counterTitle, color: "#111111", fontWeight: "600" },
  counterInputWrap: { ...baseStyles.counterInputWrap, borderWidth: 0, borderRadius: 9, backgroundColor: "#EEEDF3" },
  counterInput: { ...baseStyles.counterInput, color: "#111111", fontWeight: "500" },
  counterCurrency: { ...baseStyles.counterCurrency, fontWeight: "600" },
  actionOverlay: { ...baseStyles.actionOverlay, backgroundColor: "rgba(0,0,0,0.42)" },
  actionSheet: { ...baseStyles.actionSheet, borderTopLeftRadius: 14, borderTopRightRadius: 14, padding: 16, paddingBottom: 20 },
  actionIcon: { ...baseStyles.actionIcon, borderRadius: 9 },
  actionTitle: { ...baseStyles.actionTitle, color: "#111111", fontWeight: "600" },
  driverStatusLabel: { ...baseStyles.driverStatusLabel, fontWeight: "600" },
  driverStatus: { ...baseStyles.driverStatus, color: "#111111", fontWeight: "600" },
  notFoundTitle: { ...baseStyles.notFoundTitle, color: "#111111", fontWeight: "600" },
});
