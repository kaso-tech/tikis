import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import { type ComponentProps, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CandidatesSheet } from "@/components/tikis/candidates-sheet";
import { DeliveryRouteMap } from "@/components/tikis/delivery-route-map";
import { FinancialConfirmationModal } from "@/components/tikis/financial-modal";
import { SectionHeading, TikisButton } from "@/components/tikis/ui";
import { haptic } from "@/lib/haptics";
import { deliveryRemainingMs, formatDeliveryCountdown } from "@/lib/delivery-countdown";
import { offeredPriceError, parseOfferedPrice, sanitizeOfferedPriceInput } from "@/lib/delivery-price";
import { formatDeliveryDetailPlace } from "@/lib/geo-rules";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { deliveryStatusMeta, formatMoney, formatRelativeDate, type DriverCandidate } from "@/shared/tikis-domain";

type FinancialAction = "apply" | "withdraw" | "select" | "confirm" | "complete" | null;
type SenderAction = "disable" | "reactivate" | "cancel" | null;

function DetailRow({ icon, label, value }: { icon: ComponentProps<typeof MaterialIcons>["name"]; label: string; value: string }) {
  return (
    <View style={styles.detailsRow}>
      <View style={styles.detailsIcon}><MaterialIcons name={icon} size={16} color="#9A6201" /></View>
      <Text style={styles.detailsLabel}>{label}</Text>
      <Text style={styles.detailsValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

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
  const [candidatesSheetOpen, setCandidatesSheetOpen] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const countdownDeliveryId = delivery?.id;
  const countdownStatus = delivery?.status;

  useEffect(() => {
    if (!countdownDeliveryId || countdownStatus === "completed" || countdownStatus === "expired" || countdownStatus === "cancelled") return;
    setClock(Date.now());
    const interval = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [countdownDeliveryId, countdownStatus]);

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
    return null;
  }, [senderAction]);

  if (deliveryQuery.isLoading) {
    return <SafeAreaView style={styles.safe}><View style={styles.notFound}><ActivityIndicator color="#9A6201" /><Text style={styles.notFoundTitle}>Chargement de la livraison…</Text></View></SafeAreaView>;
  }

  if (!delivery) {
    return <SafeAreaView style={styles.safe}><View style={styles.notFound}><Text style={styles.notFoundTitle}>Livraison introuvable</Text><TikisButton label="Retour à l’accueil" onPress={() => router.replace("/(tabs)" as any)} /></View></SafeAreaView>;
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
  const isActive = delivery.status === "active";
  const isCompleted = delivery.status === "completed";
  const pickupPresentation = formatDeliveryDetailPlace(delivery.pickup);
  const dropoffPresentation = formatDeliveryDetailPlace(delivery.dropoff);
  const statusBadgeColor = status.color;
  const statusBadgeText = isActive ? `EN COURS · ETA 8 min` : isCompleted ? "TERMINÉE" : status.label.toUpperCase();
  const countdown = formatDeliveryCountdown(deliveryRemainingMs(delivery.createdAt, clock));
  const showsCountdown = delivery.status === "open" || delivery.status === "pending_confirmation" || delivery.status === "disabled" || isActive;
  const countdownLabel = isActive ? "Clôture automatique dans" : "Expiration automatique dans";

  async function confirmAction() {
    setProcessing(true);
    try {
      if (action === "apply") {
        if (!actionConfig?.amount) throw new Error("La commission doit être chargée puis confirmée avant la candidature.");
        const result = await applyMutation.mutateAsync({ deliveryId, confirmedCommission: actionConfig.amount });
        utilities.wallet.snapshot.setData(undefined, (current) => current ? { ...current, wallet: result.wallet } : current);
      }
      if (action === "withdraw") {
        const result = await withdrawMutation.mutateAsync({ deliveryId });
        utilities.wallet.snapshot.setData(undefined, (current) => current ? { ...current, wallet: result.wallet } : current);
      }
      if (action === "select" && selectedCandidate) await selectMutation.mutateAsync({ deliveryId, candidateId: selectedCandidate.id });
      if (action === "confirm") {
        const result = await confirmMutation.mutateAsync({ deliveryId });
        utilities.wallet.snapshot.setData(undefined, (current) => current ? { ...current, wallet: result.wallet } : current);
      }
      if (action === "complete") {
        const result = await completeMutation.mutateAsync({ deliveryId });
        utilities.wallet.snapshot.setData(undefined, (current) => current ? { ...current, wallet: result.wallet } : current);
      }
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
      if (senderAction === "cancel") await cancelMutation.mutateAsync({ deliveryId });
      await refreshDelivery();
      setSenderAction(null);
      haptic.success();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Cette action n’a pas pu être enregistrée.");
    } finally { setSenderProcessing(false); }
  }

  function openCandidateAction(candidate: DriverCandidate) {
    setSelectedCandidate(candidate);
    setCandidatesSheetOpen(false);
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
      const commissionRate = walletQuery.data?.commissionRate;
      if (!commissionRate) throw new Error("La commission doit être chargée avant d’envoyer la contre-proposition.");
      const result = await applyMutation.mutateAsync({ deliveryId, offerPrice: amount, confirmedCommission: Math.round(amount * commissionRate) });
      utilities.wallet.snapshot.setData(undefined, (current) => current ? { ...current, wallet: result.wallet } : current);
      await refreshDelivery();
      setCounterVisible(false); setMessage("Votre contre-proposition a été envoyée à l’expéditeur."); haptic.success();
    } catch (cause) {
      setCounterError(cause instanceof Error ? cause.message : "La contre-proposition n’a pas pu être envoyée.");
    } finally { setCounterLoading(false); }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]} accessibilityLabel="Retour">
            <MaterialIcons name="arrow-back" size={20} color="#111111" />
          </Pressable>
          <Pressable onPress={() => router.push(`/report/${deliveryId}` as any)} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]} accessibilityLabel="Signaler">
            <MaterialIcons name="flag" size={18} color="#B4232D" />
          </Pressable>
        </View>

        <View style={styles.heroMap}>
          <DeliveryRouteMap
            pickup={delivery.pickup}
            dropoff={delivery.dropoff}
            coordinates={[
              { latitude: delivery.pickup.latitude, longitude: delivery.pickup.longitude },
              { latitude: delivery.dropoff.latitude, longitude: delivery.dropoff.longitude },
            ]}
          />
          <View style={styles.heroMapStatus}>
            <View style={[styles.heroMapDot, { backgroundColor: statusBadgeColor }]} />
            <Text style={styles.heroMapStatusText}>{statusBadgeText}</Text>
          </View>
        </View>

        <Text style={styles.eyebrow}>{delivery.type} · {delivery.vehicleTypes[0] ?? "Moto"}</Text>
        <Text style={styles.title}>{delivery.title}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaText}>{formatRelativeDate(delivery.createdAt)}</Text>
          <View style={styles.metaDot} />
          <Text style={styles.metaText}>{delivery.distanceKm.toLocaleString("fr-FR")} km</Text>
          {showCandidates && candidates.length > 0 ? (
            <>
              <View style={styles.metaDot} />
              <Text style={styles.metaText}>{candidates.length} candidat{candidates.length > 1 ? "s" : ""}</Text>
            </>
          ) : null}
        </View>
        {showsCountdown ? <View style={styles.countdown} accessibilityRole="text" accessibilityLabel={`${countdownLabel} ${countdown}`}><MaterialIcons name="schedule" size={15} color="#9A6201" /><Text style={styles.countdownLabel}>{countdownLabel}</Text><Text style={styles.countdownValue}>{countdown}</Text></View> : null}

        <View style={styles.timelineCard}>
          <Text style={styles.eyebrowSmall}>SUIVI</Text>
          <View style={styles.timeline}>
            <TimelineStep label="Publiée" done />
            <TimelineLine done={isActive || isCompleted} />
            <TimelineStep label="Retenue" done={isActive || isCompleted} />
            <TimelineLine done={isCompleted} />
            <TimelineStep label="Terminée" done={isCompleted} />
          </View>
        </View>

        <View style={styles.routeCard}>
          <View style={styles.routeCol}>
            <View style={[styles.routePin, styles.routePinFrom]} />
            <View style={styles.routeLine} />
            <View style={[styles.routePin, styles.routePinTo]} />
          </View>
          <View style={styles.routeInfoWrap}>
            <View style={styles.routeInfo}>
              <Text style={styles.routeLabel}>RÉCUPÉRATION</Text>
              <Text style={styles.routeValue} numberOfLines={1}>{pickupPresentation.title}</Text>
              <Text style={styles.routeMeta} numberOfLines={1}>{pickupPresentation.subtitle}</Text>
            </View>
            <View style={styles.routeInfo}>
              <Text style={styles.routeLabel}>DESTINATION</Text>
              <Text style={styles.routeValue} numberOfLines={1}>{dropoffPresentation.title}</Text>
              <Text style={styles.routeMeta} numberOfLines={1}>{dropoffPresentation.subtitle}</Text>
            </View>
          </View>
        </View>

        {role === "sender" ? (
          <View style={styles.pricingCard}>
            <View style={styles.pricingRow}>
              <View>
                <Text style={styles.pricingLabel}>Frais de livraison</Text>
                {delivery.offeredPrice && delivery.offeredPrice !== delivery.estimatedPrice ? (
                  <Text style={styles.pricingRef}>Estimé {formatMoney(delivery.estimatedPrice)}</Text>
                ) : null}
              </View>
              <Text style={styles.pricingValue}>{formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice)}</Text>
            </View>
            <Text style={styles.pricingNote}>Vous réglerez directement le livreur lors de la livraison.</Text>
          </View>
        ) : (
          <View style={styles.pricingCard}>
            <View style={styles.pricingRow}>
              <Text style={styles.pricingLabel}>{ownCandidate?.offerPrice ? "Frais client" : "Frais de la course"}</Text>
              <Text style={styles.pricingValue}>{formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice)}</Text>
            </View>
            {ownCandidate?.offerPrice ? (
              <View style={styles.pricingCounterRow}>
                <Text style={styles.pricingCounterLabel}>Frais proposé</Text>
                <Text style={styles.pricingCounterValue}>{formatMoney(ownCandidate.offerPrice)}</Text>
              </View>
            ) : null}
            <Text style={styles.pricingNote}>Votre gain reste informatif jusqu’à la confirmation de la mission.</Text>
          </View>
        )}

        {canRevealContact && delivery.driverName ? (
          <View style={styles.driverCard}>
            <View style={styles.driverAvatar}>
              <Text style={styles.driverAvatarText}>{(delivery.driverName ?? "?").split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}</Text>
              <View style={styles.driverVerifiedBadge}>
                <MaterialIcons name="check" size={10} color="#167A55" />
              </View>
            </View>
            <View style={styles.driverInfo}>
              <View style={styles.driverNameRow}>
                <Text style={styles.driverName} numberOfLines={1}>{role === "sender" ? delivery.driverName : delivery.senderName}</Text>
                <MaterialIcons name="verified" size={14} color="#167A55" />
              </View>
              <Text style={styles.driverMeta}>{role === "sender" ? "Livreur confirmé" : "Expéditeur"}</Text>
            </View>
            <View style={styles.driverActions}>
              <Pressable onPress={() => void Linking.openURL(`tel:${role === "sender" ? delivery.driverPhone : delivery.senderPhone}`)} style={({ pressed }) => [styles.driverActionBtn, pressed && styles.pressed]} accessibilityLabel="Appeler">
                <MaterialIcons name="phone" size={16} color="#111111" />
              </Pressable>
              <Pressable style={({ pressed }) => [styles.driverActionBtn, pressed && styles.pressed]} accessibilityLabel="Message">
                <MaterialIcons name="chat" size={16} color="#111111" />
              </Pressable>
            </View>
          </View>
        ) : null}

        {showCandidates ? (
          <Pressable onPress={() => setCandidatesSheetOpen(true)} style={({ pressed }) => [styles.candidatesTrigger, isActive && styles.candidatesTriggerActive, pressed && styles.pressed]}>
            <View style={[styles.candidatesIcon, isActive && styles.candidatesIconActive]}>
              <MaterialIcons name="group" size={18} color="#9A6201" />
            </View>
            <View style={styles.candidatesBody}>
              <Text style={styles.candidatesTitle}>{isActive ? "Changer de livreur" : "Livreurs candidats"}</Text>
              <Text style={styles.candidatesMeta}>{isActive ? "Voir les autres candidatures reçues" : `${candidates.length} livreur${candidates.length > 1 ? "s" : ""} ont proposé leur service`}</Text>
            </View>
            {candidates.length > 0 ? <View style={styles.candidatesCount}><Text style={styles.candidatesCountText}>{candidates.length}</Text></View> : null}
            <MaterialIcons name="chevron-right" size={18} color="#747474" />
          </Pressable>
        ) : null}

        <SectionHeading title="Détails" />
        <View style={styles.detailsCard}>
          <DetailRow icon="title" label="Titre" value={delivery.title} />
          <DetailRow icon="category" label="Type" value={delivery.type} />
          {delivery.type === "Autre" && delivery.weightKg ? <DetailRow icon="scale" label="Poids" value={`${delivery.weightKg} kg`} /> : null}
          {delivery.type === "Personne" && delivery.passengers ? <DetailRow icon="group" label="Nombre" value={`${delivery.passengers} personne`} /> : null}
          <DetailRow icon="route" label="Distance" value={`${delivery.distanceKm.toLocaleString("fr-FR")} km`} />
          <DetailRow icon="two-wheeler" label="Engins" value={delivery.vehicleTypes.join(", ")} />
          {delivery.details ? <View style={styles.detailsLast}><Text style={styles.detailsDescription}>{delivery.details}</Text></View> : null}
        </View>

        {role === "sender" && (isActive || delivery.status === "pending_confirmation") ? (
          <Pressable onPress={() => router.push(`/delivery/${deliveryId}/map` as any)} style={({ pressed }) => [styles.trackButton, pressed && styles.pressed]}>
            <MaterialIcons name="my-location" size={16} color="#FFFFFF" />
            <Text style={styles.trackButtonText}>Suivre en direct</Text>
          </Pressable>
        ) : null}

        {role === "sender" ? (
          <View style={styles.senderActions}>
            {canEdit ? <TikisButton label="Modifier la livraison" icon="edit" variant="secondary" onPress={() => router.push({ pathname: "/create-delivery", params: { deliveryId } } as any)} disabled={senderProcessing} style={styles.senderActionBtn} /> : null}
            {canReactivate ? <TikisButton label="Activer la livraison" icon="play-circle" onPress={() => setSenderAction("reactivate")} loading={senderProcessing && senderAction === "reactivate"} disabled={senderProcessing} style={styles.senderActionBtn} /> : null}
            {canDisable ? <TikisButton label="Désactiver la livraison" icon="pause-circle" variant="secondary" onPress={() => setSenderAction("disable")} loading={senderProcessing && senderAction === "disable"} disabled={senderProcessing} style={styles.senderActionBtn} /> : null}
            {canCancel ? (
              <Pressable onPress={() => setSenderAction("cancel")} disabled={senderProcessing} style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed, senderProcessing && styles.cancelButtonDisabled]}>
                <MaterialIcons name="cancel" size={16} color={senderProcessing ? "#A0A0A0" : "#B4232D"} />
                <Text style={[styles.cancelButtonText, senderProcessing && styles.cancelButtonTextDisabled]}>Annuler la livraison</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {role === "driver" ? <DriverActions deliveryStatus={delivery.status} ownCandidateStatus={ownCandidate?.status} loading={processing} onApply={() => setAction("apply")} onCounterOffer={openCounterOffer} onWithdraw={() => setAction("withdraw")} onConfirm={() => setAction("confirm")} onComplete={() => setAction("complete")} /> : null}

        {message ? <Text style={styles.message}>{message}</Text> : null}
        {isCompleted && role === "sender" ? review ? (
          <View style={styles.reviewDone}><MaterialIcons name="star" size={20} color="#9A6200" /><View style={styles.reviewDoneInfo}><Text style={styles.reviewDoneTitle}>Avis envoyé · {review.rating}/5</Text><Text style={styles.reviewDoneText}>{review.comment || "Votre évaluation est enregistrée dans votre historique."}</Text></View></View>
        ) : (
          <TikisButton label="Noter le livreur" variant="ghost" icon="star-outline" onPress={() => router.push(`/review/${deliveryId}` as any)} style={styles.rateButton} />
        ) : null}
      </ScrollView>

      {actionConfig ? <FinancialConfirmationModal visible title={actionConfig.title} description={actionConfig.description} amount={actionConfig.amount} confirmLabel={actionConfig.label} irreversible={actionConfig.irreversible} loading={processing} onCancel={() => { setAction(null); setSelectedCandidate(null); }} onConfirm={() => void confirmAction()} /> : null}
      {senderActionConfig ? <DeliveryActionConfirmationModal visible title={senderActionConfig.title} description={senderActionConfig.description} confirmLabel={senderActionConfig.confirmLabel} tone={senderActionConfig.tone} loading={senderProcessing} onCancel={() => !senderProcessing && setSenderAction(null)} onConfirm={() => void confirmSenderAction()} /> : null}
      <Modal visible={counterVisible} transparent animationType="fade" onRequestClose={() => !counterLoading && setCounterVisible(false)}>
        <View style={styles.counterOverlay}><View style={styles.counterDialog}>
          <View style={styles.counterIcon}><MaterialIcons name="price-change" size={24} color="#9A6201" /></View>
          <Text style={styles.counterTitle}>{ownCandidate ? "Modifier votre contre-proposition" : "Faire une contre-proposition"}</Text>
          <Text style={styles.counterText}>Proposez le montant que vous souhaitez percevoir. La commission Tikis sera ajustée sur ce prix si l’expéditeur vous retient.</Text>
          <View style={styles.counterInputWrap}><TextInput value={counterInput} onChangeText={(value) => setCounterInput(sanitizeOfferedPriceInput(value))} keyboardType="number-pad" maxLength={8} autoFocus style={styles.counterInput} placeholder="Ex. 6 500" placeholderTextColor="#9AA5B6" /><Text style={styles.counterCurrency}>FCFA</Text></View>
          {counterError ? <Text style={styles.counterError}>{counterError}</Text> : <Text style={styles.counterHint}>Prix client : {formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice)}</Text>}
          <View style={styles.counterActions}><TikisButton label="Annuler" variant="secondary" onPress={() => setCounterVisible(false)} disabled={counterLoading} style={styles.counterAction} /><TikisButton label="Envoyer" icon="send" onPress={() => void submitCounterOffer()} loading={counterLoading} style={styles.counterAction} /></View>
        </View></View>
      </Modal>
      <CandidatesSheet
        visible={candidatesSheetOpen}
        candidates={candidates}
        deliveryStatus={delivery.status}
        loadingId={processing ? selectedCandidate?.id ?? null : null}
        onClose={() => setCandidatesSheetOpen(false)}
        onChoose={openCandidateAction}
      />
    </SafeAreaView>
  );
}

function TimelineStep({ label, done }: { label: string; done: boolean }) {
  return (
    <View style={styles.timelineStep}>
      <View style={[styles.timelineDot, done && styles.timelineDotDone]}>
        {done ? <MaterialIcons name="check" size={11} color="#FFFFFF" /> : <MaterialIcons name="radio-button-unchecked" size={9} color="#747474" />}
      </View>
      <Text style={[styles.timelineLabel, done && styles.timelineLabelDone]}>{label}</Text>
    </View>
  );
}

function TimelineLine({ done }: { done: boolean }) {
  return <View style={[styles.timelineLine, done && styles.timelineLineDone]} />;
}

function DeliveryActionConfirmationModal({ visible, title, description, confirmLabel, tone, loading, onCancel, onConfirm }: { visible: boolean; title: string; description: string; confirmLabel: string; tone: "success" | "warning" | "danger"; loading: boolean; onCancel: () => void; onConfirm: () => void }) {
  const color = tone === "danger" ? "#B4232D" : tone === "warning" ? "#9A6200" : "#176C52";
  const background = tone === "danger" ? "#FDEBEC" : tone === "warning" ? "#FEF6E2" : "#DDEFE7";
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}><View style={styles.actionOverlay}><Pressable style={StyleSheet.absoluteFill} onPress={onCancel} /><View style={styles.actionSheet}><View style={styles.actionHandle} /><View style={[styles.actionIcon, { backgroundColor: background }]}><MaterialIcons name={tone === "danger" ? "warning-amber" : tone === "warning" ? "pause-circle" : "play-circle"} size={24} color={color} /></View><Text style={styles.actionTitle}>{title}</Text><Text style={styles.actionDescription}>{description}</Text><TikisButton label={confirmLabel} variant={tone === "danger" ? "danger" : tone === "warning" ? "secondary" : "primary"} onPress={onConfirm} loading={loading} style={styles.actionConfirm} /><TikisButton label="Conserver la livraison" variant="ghost" onPress={onCancel} disabled={loading} style={styles.actionCancel} /></View></View></Modal>;
}

function DriverActions({ deliveryStatus, ownCandidateStatus, loading, onApply, onCounterOffer, onWithdraw, onConfirm, onComplete }: { deliveryStatus: string; ownCandidateStatus?: string; loading: boolean; onApply: () => void; onCounterOffer: () => void; onWithdraw: () => void; onConfirm: () => void; onComplete: () => void }) {
  if (deliveryStatus === "open") return <View style={styles.driverAction}>{ownCandidateStatus === "applied" ? <TikisButton label="Renoncer" variant="ghost" icon="undo" onPress={onWithdraw} loading={loading} disabled={loading} /> : <><TikisButton label="Se proposer" icon="add-circle" onPress={onApply} loading={loading} disabled={loading} /><TikisButton label="Faire une contre-proposition" variant="secondary" icon="price-change" onPress={onCounterOffer} disabled={loading} style={styles.secondaryDriverAction} /></>}<Text style={styles.driverHint}>{ownCandidateStatus === "applied" ? "Votre candidature est enregistrée. Vous pouvez la retirer tant que vous n’êtes pas sélectionné." : "Vous pouvez candidater au prix client ou proposer un montant différent."}</Text></View>;
  if (deliveryStatus === "pending_confirmation" && ownCandidateStatus === "selected") return <View style={styles.driverAction}><TikisButton label="Confirmer la course" icon="check-circle" onPress={onConfirm} loading={loading} disabled={loading} /><Text style={styles.driverHint}>Après confirmation, vos coordonnées seront partagées avec l’expéditeur.</Text></View>;
  if (deliveryStatus === "active" && ownCandidateStatus === "confirmed") return <View style={styles.driverAction}><TikisButton label="Marquer comme terminée" icon="task-alt" onPress={onComplete} loading={loading} disabled={loading} /><Text style={styles.driverHint}>À utiliser après remise et paiement direct avec l’expéditeur.</Text></View>;
  return null;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#EEEDF3" },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 10 },

  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 4 },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },

  heroMap: { height: 200, borderRadius: 12, backgroundColor: "#EEEDF3", position: "relative", overflow: "hidden", marginTop: 8 },
  heroMapInner: { ...StyleSheet.absoluteFillObject, backgroundColor: "#EEEDF3" },
  heroMapBlock: { position: "absolute", backgroundColor: "#DCDEE3", borderRadius: 5 },
  heroMapRoad: { position: "absolute", backgroundColor: "#FFFFFF", borderRadius: 99 },
  heroMapMarker: { position: "absolute", width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "#FFFFFF", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  heroMapMarkerStart: { top: "30%", left: "18%", backgroundColor: "#9A6201" },
  heroMapMarkerEnd: { top: "60%", right: "22%", backgroundColor: "#FFFFFF", borderColor: "#B4232D" },
  heroMapStatus: { position: "absolute", top: 12, left: 12, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: "rgba(255,255,255,0.95)", borderRadius: 7 },
  heroMapDot: { width: 7, height: 7, borderRadius: 4 },
  heroMapStatusText: { color: "#111111", fontSize: 10, fontWeight: "600" },

  eyebrow: { color: "#747474", fontSize: 10, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", marginTop: 4 },
  eyebrowSmall: { color: "#747474", fontSize: 9, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  title: { color: "#111111", fontSize: 22, fontWeight: "700", lineHeight: 1.2, marginTop: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  metaText: { color: "#666666", fontSize: 11 },
  metaDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: "#747474" },
  countdown: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6, paddingHorizontal: 9, paddingVertical: 6, backgroundColor: "#FEF6E2", borderRadius: 7 },
  countdownLabel: { color: "#6D4701", fontSize: 10, fontWeight: "600" },
  countdownValue: { color: "#9A6201", fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] },

  timelineCard: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 14, marginTop: 4 },
  timeline: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginTop: 10 },
  timelineStep: { alignItems: "center", width: 70 },
  timelineDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center" },
  timelineDotDone: { backgroundColor: "#9A6201" },
  timelineLine: { flex: 1, height: 1.5, backgroundColor: "#ECECEC", marginTop: 11 },
  timelineLineDone: { backgroundColor: "#9A6201" },
  timelineLabel: { color: "#747474", fontSize: 9, fontWeight: "600", textAlign: "center", marginTop: 6 },
  timelineLabelDone: { color: "#9A6201" },

  routeCard: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 14, flexDirection: "row", alignItems: "stretch", gap: 10 },
  routeCol: { alignItems: "center", width: 14 },
  routePin: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  routePinFrom: { backgroundColor: "#9A6201" },
  routePinTo: { backgroundColor: "#B4232D" },
  routeLine: { width: 1.5, flex: 1, backgroundColor: "#ECECEC", marginVertical: 4 },
  routeInfoWrap: { flex: 1, minWidth: 0 },
  routeInfo: { paddingVertical: 2 },
  routeLabel: { color: "#747474", fontSize: 9, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
  routeValue: { color: "#111111", fontSize: 12, fontWeight: "600", marginTop: 2 },
  routeMeta: { color: "#666666", fontSize: 10, marginTop: 1 },

  pricingCard: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 14 },
  pricingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pricingLabel: { color: "#111111", fontSize: 12, fontWeight: "600" },
  pricingValue: { color: "#111111", fontSize: 18, fontWeight: "700" },
  pricingRef: { color: "#747474", fontSize: 10, marginTop: 1 },
  pricingCounterRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#ECECEC" },
  pricingCounterLabel: { color: "#666666", fontSize: 11, fontWeight: "500" },
  pricingCounterValue: { color: "#9A6201", fontSize: 13, fontWeight: "700" },
  pricingNote: { color: "#747474", fontSize: 11, lineHeight: 16, marginTop: 8 },

  driverCard: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  driverAvatar: { width: 40, height: 40, borderRadius: 10, backgroundColor: "#F8F0E5", alignItems: "center", justifyContent: "center", position: "relative", flexShrink: 0 },
  driverAvatarText: { color: "#9A6201", fontSize: 13, fontWeight: "700" },
  driverVerifiedBadge: { position: "absolute", bottom: -2, right: -2, width: 14, height: 14, borderRadius: 7, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  driverInfo: { flex: 1, minWidth: 0 },
  driverNameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  driverName: { color: "#111111", fontSize: 13, fontWeight: "600", flexShrink: 1 },
  driverMeta: { color: "#666666", fontSize: 11, marginTop: 2 },
  driverActions: { flexDirection: "row", gap: 6 },
  driverActionBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center" },

  candidatesTrigger: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  candidatesTriggerActive: { borderWidth: 1, borderColor: "#9A6201", borderStyle: "dashed" },
  candidatesIcon: { width: 36, height: 36, borderRadius: 9, backgroundColor: "#F8F0E5", alignItems: "center", justifyContent: "center" },
  candidatesIconActive: { backgroundColor: "#FEF6E2" },
  candidatesBody: { flex: 1, minWidth: 0 },
  candidatesTitle: { color: "#111111", fontSize: 13, fontWeight: "600" },
  candidatesMeta: { color: "#666666", fontSize: 11, marginTop: 2 },
  candidatesCount: { backgroundColor: "#111111", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 99 },
  candidatesCountText: { color: "#FFFFFF", fontSize: 10, fontWeight: "700" },

  detailsCard: { backgroundColor: "#FFFFFF", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 2 },
  detailsRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 9, borderBottomWidth: 1, borderBottomColor: "#ECECEC" },
  detailsIcon: { width: 26, height: 26, borderRadius: 8, backgroundColor: "#F8F0E5", alignItems: "center", justifyContent: "center" },
  detailsLabel: { color: "#747474", fontSize: 11, flexShrink: 0 },
  detailsValue: { color: "#111111", fontSize: 12, fontWeight: "600", flex: 1, textAlign: "right" },
  detailsLast: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: "#ECECEC", marginTop: 2 },
  detailsDescription: { color: "#666666", fontSize: 12, lineHeight: 18 },

  trackButton: { backgroundColor: "#9A6201", borderRadius: 10, paddingVertical: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  trackButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },

  senderActions: { gap: 8, marginTop: 4 },
  senderActionBtn: { minHeight: 46 },
  cancelButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 46, borderRadius: 9, borderWidth: 1, borderColor: "#B4232D", backgroundColor: "#FFFFFF" },
  cancelButtonDisabled: { borderColor: "#D5D5DC" },
  cancelButtonText: { color: "#B4232D", fontSize: 13, fontWeight: "600" },
  cancelButtonTextDisabled: { color: "#A0A0A0" },

  driverAction: { marginTop: 16 },
  secondaryDriverAction: { marginTop: 8 },
  driverHint: { color: "#666666", fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 10, paddingHorizontal: 12 },

  actionOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.42)" },
  actionSheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 14, borderTopRightRadius: 14, padding: 16, paddingTop: 8, paddingBottom: 20 },
  actionHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#D5D5DC", alignSelf: "center", marginBottom: 14 },
  actionIcon: { width: 44, height: 44, borderRadius: 9, alignItems: "center", justifyContent: "center", marginBottom: 12, alignSelf: "center" },
  actionTitle: { color: "#111111", fontSize: 17, fontWeight: "600", textAlign: "center" },
  actionDescription: { color: "#666666", fontSize: 13, lineHeight: 19, marginTop: 6, textAlign: "center" },
  actionConfirm: { marginTop: 18 },
  actionCancel: { marginTop: 6 },

  counterOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.42)", alignItems: "center", justifyContent: "center", padding: 16 },
  counterDialog: { width: "100%", maxWidth: 400, backgroundColor: "#FFFFFF", borderRadius: 12, padding: 16 },
  counterIcon: { width: 44, height: 44, borderRadius: 9, backgroundColor: "#F8F0E5", alignSelf: "center", alignItems: "center", justifyContent: "center", marginBottom: 10 },
  counterTitle: { color: "#111111", fontSize: 16, fontWeight: "600", textAlign: "center" },
  counterText: { color: "#666666", fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 6 },
  counterInputWrap: { flexDirection: "row", alignItems: "center", minHeight: 48, backgroundColor: "#EEEDF3", borderRadius: 9, paddingHorizontal: 14, marginTop: 14 },
  counterInput: { flex: 1, color: "#111111", fontSize: 15, fontWeight: "500", minHeight: 42 },
  counterCurrency: { color: "#666666", fontSize: 11, fontWeight: "600", marginLeft: 8 },
  counterHint: { color: "#666666", fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 6 },
  counterError: { color: "#B4232D", fontSize: 11, fontWeight: "600", lineHeight: 16, textAlign: "center", marginTop: 6 },
  counterActions: { flexDirection: "row", gap: 8, marginTop: 16 },
  counterAction: { flex: 1, minHeight: 42 },

  message: { color: "#B4232D", textAlign: "center", fontSize: 13, fontWeight: "600", marginTop: 8 },

  reviewDone: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: "#FEF6E2", borderRadius: 10, padding: 12, marginTop: 14 },
  reviewDoneInfo: { flex: 1 },
  reviewDoneTitle: { color: "#9A6200", fontSize: 13, fontWeight: "600" },
  reviewDoneText: { color: "#9A6200", fontSize: 12, lineHeight: 17, marginTop: 2 },
  rateButton: { marginTop: 14 },

  notFound: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  notFoundTitle: { color: "#111111", fontSize: 16, fontWeight: "600" },

  pressed: { opacity: 0.7 },
});
