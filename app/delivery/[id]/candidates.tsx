import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar, TikisButton } from "@/components/tikis/ui";
import { createStyles } from "@/lib/create-styles";
import { formatListRoute } from "@/lib/geo-rules";
import { haptic } from "@/lib/haptics";
import { useThemeColors, type ThemedColors } from "@/lib/use-theme-colors";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import {
  bestPlacedCandidate,
  candidatePrice,
  candidatePriceDelta,
  CANDIDATE_SORTS,
  DEFAULT_CANDIDATE_SORT,
  isCandidateInRunning,
  joinReasons,
  sortCandidates,
  type CandidateSort,
} from "@/shared/candidate-ranking";
import { formatMoney, type DriverCandidate } from "@/shared/tikis-domain";

const PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000000";

/**
 * Choisir un livreur parmi les candidats.
 *
 * Cet écran remplace la feuille glissante qui rendait ce choix depuis l'accueil et la
 * fiche de livraison. Une feuille ouverte à 45 % de la hauteur montrait deux candidats
 * sur quatre et ne défilait pas ; surtout, elle traitait comme un geste de passage une
 * décision qui bloque la commission d'un livreur et engage l'expéditeur sur un montant.
 *
 * La page dit donc trois choses qu'aucun écran ne disait :
 *  1. ce que chaque candidat coûte **par rapport au prix publié** (« votre prix »,
 *     « +1 500 FCFA »), là où une contre-offre s'affichait comme un prix accepté ;
 *  2. à quelle distance il se trouve réellement, ou « position inconnue » — l'ancienne
 *     carte affichait « 1,2 km » écrit en dur pour tout le monde ;
 *  3. au moment de confirmer, ce que l'expéditeur va payer. L'ancien écran de
 *     confirmation n'affichait que la commission prélevée **au livreur**.
 */
export default function DeliveryCandidatesScreen() {
  const { colors: theme } = useThemeColors();
  const styles = useMemo(() => stylesFor(theme), [theme]);
  const params = useLocalSearchParams<{ id: string }>();
  const { role, profile } = useTikisStore();
  const utilities = trpc.useUtils();
  const deliveryId = params.id ?? PLACEHOLDER_ID;
  const enabled = Boolean(params.id && profile?.phone);

  const deliveryQuery = trpc.deliveries.get.useQuery({ id: deliveryId }, { enabled });
  const candidatesQuery = trpc.deliveries.candidates.useQuery({ deliveryId }, { enabled });
  const selectMutation = trpc.deliveries.selectCandidate.useMutation();

  const [sort, setSort] = useState<CandidateSort>(DEFAULT_CANDIDATE_SORT);
  const [sortOpen, setSortOpen] = useState(false);
  const [certifiedOnly, setCertifiedOnly] = useState(false);
  const [pending, setPending] = useState<DriverCandidate | null>(null);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");

  const delivery = deliveryQuery.data;
  const deliveryPrice = delivery ? (delivery.offeredPrice ?? delivery.estimatedPrice) : 0;
  const candidates = useMemo(() => candidatesQuery.data ?? [], [candidatesQuery.data]);
  const chosen = useMemo(() => candidates.find((candidate) => candidate.status === "selected" || candidate.status === "confirmed") ?? null, [candidates]);
  const running = useMemo(() => candidates.filter(isCandidateInRunning), [candidates]);

  // Le bandeau ne s'affiche que tant que personne n'est retenu : une fois le choix fait,
  // c'est le livreur retenu qui occupe le haut de l'écran, pas une suggestion périmée.
  const best = useMemo(() => (chosen ? null : bestPlacedCandidate(candidates, deliveryPrice)), [candidates, chosen, deliveryPrice]);

  // Le vivier de la liste : les candidats encore en lice, moins celui déjà mis en avant.
  const pool = useMemo(() => running.filter((candidate) => candidate.id !== best?.candidate.id), [running, best]);
  // Le compteur du filtre se lit sur ce vivier, pas sur l'ensemble : compter le
  // candidat du bandeau promettrait un certifié que le filtre ne montrerait jamais.
  const certifiedCount = useMemo(() => pool.filter((candidate) => candidate.isCertified).length, [pool]);

  const listed = useMemo(
    () => sortCandidates(certifiedOnly ? pool.filter((candidate) => candidate.isCertified) : pool, deliveryPrice, sort),
    [pool, certifiedOnly, deliveryPrice, sort],
  );

  async function confirmChoice() {
    if (!pending) return;
    setProcessing(true);
    try {
      await selectMutation.mutateAsync({ deliveryId, candidateId: pending.id });
      await Promise.all([
        utilities.deliveries.get.invalidate({ id: deliveryId }),
        utilities.deliveries.candidates.invalidate({ deliveryId }),
        utilities.deliveries.list.invalidate(),
        utilities.wallet.snapshot.invalidate(),
        utilities.notifications.list.invalidate(),
      ]);
      setPending(null);
      haptic.success();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Ce choix n’a pas pu être enregistré.");
    } finally {
      setProcessing(false);
    }
  }

  if (candidatesQuery.isLoading || deliveryQuery.isLoading) {
    return <SafeAreaView style={styles.safe} edges={["top"]}>
      <TopBar count={null} />
      <View style={styles.centered}><ActivityIndicator color={theme.primary} /><Text style={styles.centeredTitle}>Chargement des candidatures…</Text></View>
    </SafeAreaView>;
  }

  // Un expéditeur qui n'est pas propriétaire n'arrive jamais ici : le serveur refuse la
  // requête. Un livreur, lui, ne reçoit que sa propre candidature — cet écran ne le
  // concerne pas, et le lui montrer amputé serait plus déroutant que de le renvoyer.
  if (!delivery || role !== "sender") {
    return <SafeAreaView style={styles.safe} edges={["top"]}>
      <TopBar count={null} />
      <View style={styles.centered}>
        <Text style={styles.centeredTitle}>{delivery ? "Réservé à l’expéditeur" : "Livraison introuvable"}</Text>
        <Text style={styles.centeredText}>{delivery ? "Seul l’expéditeur de cette course voit la liste de ses candidats." : "Cette livraison n’existe plus ou ne vous appartient pas."}</Text>
        <TikisButton label="Retour" icon="arrow-back" variant="secondary" onPress={() => router.back()} style={styles.centeredButton} />
      </View>
    </SafeAreaView>;
  }

  const error = candidatesQuery.error?.message ?? null;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <TopBar count={running.length} chosenName={chosen?.name ?? null} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <View style={styles.recap}>
          <Text style={styles.recapTitle} numberOfLines={1}>{delivery.title}</Text>
          {/* `formatListRoute` et non les villes brutes : deux points de la même ville
              donnaient « Ouagadougou → Ouagadougou », qui n'apprend rien. */}
          <Text style={styles.recapRoute} numberOfLines={1}>{formatListRoute(delivery.pickup, delivery.dropoff)} · {delivery.distanceKm.toLocaleString("fr-FR")} km</Text>
          <View style={styles.recapBottom}>
            <Text style={styles.recapLabel}>Votre prix</Text>
            <Text style={styles.recapPrice}>{formatMoney(deliveryPrice)}</Text>
            <View style={styles.recapSpacer} />
            {delivery.vehicleTypes.map((vehicle) => <View key={vehicle} style={styles.vehicleChip}><Text style={styles.vehicleChipText}>{vehicle}</Text></View>)}
          </View>
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <MaterialIcons name="cloud-off" size={20} color={theme.error} />
            <View style={styles.errorBody}>
              <Text style={styles.errorTitle}>Liste des candidatures indisponible</Text>
              <Text style={styles.errorText}>{error}</Text>
            </View>
            <Pressable onPress={() => void candidatesQuery.refetch()} accessibilityRole="button" style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
              <MaterialIcons name="refresh" size={16} color={theme.foreground} />
              <Text style={styles.retryText}>Réessayer</Text>
            </Pressable>
          </View>
        ) : null}

        {chosen ? (
          <ChosenCard candidate={chosen} deliveryPrice={deliveryPrice} theme={theme} onUnselect={() => router.push(`/delivery/${deliveryId}` as any)} />
        ) : null}

        {best ? (
          <View style={styles.bestCard}>
            <Text style={styles.bestEyebrow}>LE MIEUX PLACÉ</Text>
            <CandidateIdentity candidate={best.candidate} deliveryPrice={deliveryPrice} theme={theme} />
            <Text style={styles.bestReason}>{capitalize(joinReasons(best.reasons))}</Text>
            <TikisButton
              label={`Choisir ${firstName(best.candidate.name)} · ${formatMoney(candidatePrice(best.candidate, deliveryPrice))}`}
              onPress={() => setPending(best.candidate)}
              style={styles.bestCta}
            />
          </View>
        ) : null}

        {running.length === 0 && !error ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><MaterialIcons name="schedule" size={26} color={theme.muted} /></View>
            <Text style={styles.emptyTitle}>En attente de candidatures</Text>
            <Text style={styles.emptyText}>Votre livraison est publiée. Les livreurs compatibles apparaîtront ici dès qu’ils proposeront leur service.</Text>
          </View>
        ) : null}

        {listed.length > 0 ? (
          <>
            <View style={styles.listHeader}>
              <Text style={styles.listHeaderTitle}>{best || chosen ? `LES ${listed.length} AUTRE${listed.length > 1 ? "S" : ""}` : `${listed.length} CANDIDAT${listed.length > 1 ? "S" : ""}`}</Text>
              <View style={styles.listSpacer} />
              {certifiedCount > 0 ? (
                <Pressable
                  onPress={() => setCertifiedOnly((current) => !current)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: certifiedOnly }}
                  style={({ pressed }) => [styles.control, certifiedOnly && styles.controlActive, pressed && styles.pressed]}
                >
                  <Text style={[styles.controlText, certifiedOnly && styles.controlTextActive]}>Certifiés</Text>
                  <Text style={[styles.controlCount, certifiedOnly && styles.controlTextActive]}>{certifiedCount}</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => setSortOpen(true)} accessibilityRole="button" style={({ pressed }) => [styles.control, pressed && styles.pressed]}>
                <Text style={styles.controlText}>{CANDIDATE_SORTS.find((entry) => entry.key === sort)?.label}</Text>
                <MaterialIcons name="expand-more" size={15} color={theme.muted} />
              </Pressable>
            </View>

            {listed.map((candidate) => (
              <CandidateRow
                key={candidate.id}
                candidate={candidate}
                deliveryPrice={deliveryPrice}
                replacing={Boolean(chosen)}
                theme={theme}
                onChoose={() => setPending(candidate)}
              />
            ))}
          </>
        ) : null}

        {certifiedOnly && listed.length === 0 && pool.length > 0 ? (
          <Text style={styles.filterEmpty}>Aucun candidat certifié pour l’instant.</Text>
        ) : null}

        {message ? <Text style={styles.message}>{message}</Text> : null}
      </ScrollView>

      <SortSheet
        visible={sortOpen}
        selected={sort}
        theme={theme}
        onSelect={(next) => { setSort(next); setSortOpen(false); }}
        onClose={() => setSortOpen(false)}
      />

      {pending ? (
        <ChoiceModal
          candidate={pending}
          deliveryPrice={deliveryPrice}
          replacing={Boolean(chosen)}
          loading={processing}
          theme={theme}
          onCancel={() => !processing && setPending(null)}
          onConfirm={() => void confirmChoice()}
        />
      ) : null}
    </SafeAreaView>
  );
}

function TopBar({ count, chosenName }: { count: number | null; chosenName?: string | null }) {
  const { colors: theme } = useThemeColors();
  const styles = useMemo(() => stylesFor(theme), [theme]);
  return (
    <View style={styles.topBar}>
      <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Retour" style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}>
        <MaterialIcons name="arrow-back" size={20} color={theme.foreground} />
      </Pressable>
      <View style={styles.topBarText}>
        <Text style={styles.topBarEyebrow}>CANDIDATURES</Text>
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {chosenName
            ? `${chosenName} est retenu`
            : count === null
              ? "Choisir un livreur"
              : count === 0
                ? "Aucun candidat pour l’instant"
                : count === 1
                  ? "1 livreur, à confirmer"
                  : `${count} livreurs, un seul à choisir`}
        </Text>
      </View>
    </View>
  );
}

/** Identité, note, expérience, engins, distance et prix : tout ce qui sert à trancher. */
function CandidateIdentity({ candidate, deliveryPrice, theme }: { candidate: DriverCandidate; deliveryPrice: number; theme: ThemedColors }) {
  const styles = useMemo(() => stylesFor(theme), [theme]);
  return (
    <View style={styles.identityRow}>
      <Avatar initials={candidate.initials} color={candidate.isCertified ? theme.foreground : theme.muted} size={44} />
      <View style={styles.identityBody}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{candidate.name}</Text>
          {candidate.isCertified ? <View style={styles.certPill}><Text style={styles.certPillText}>CERTIFIÉ</Text></View> : null}
        </View>
        <Text style={styles.meta} numberOfLines={1}>{describeReputation(candidate)}</Text>
        <Text style={styles.subMeta} numberOfLines={1}>{describeReach(candidate)}</Text>
      </View>
      <PriceBlock candidate={candidate} deliveryPrice={deliveryPrice} theme={theme} />
    </View>
  );
}

/**
 * Le prix, et surtout son écart au prix publié.
 *
 * C'est la correction centrale de cet écran : `offerPrice ?? deliveryPrice` affichait
 * une contre-offre de 4 500 FCFA exactement comme un prix accepté de 3 000, dans la
 * même taille et la même couleur.
 */
function PriceBlock({ candidate, deliveryPrice, theme }: { candidate: DriverCandidate; deliveryPrice: number; theme: ThemedColors }) {
  const styles = useMemo(() => stylesFor(theme), [theme]);
  const delta = candidatePriceDelta(candidate, deliveryPrice);
  return (
    <View style={styles.priceBlock}>
      <Text style={styles.price}>{formatMoney(candidatePrice(candidate, deliveryPrice))}</Text>
      {delta === 0
        ? <Text style={styles.priceNeutral}>votre prix</Text>
        : <Text style={[styles.priceDelta, { color: delta > 0 ? theme.warning : theme.success }]}>{delta > 0 ? "+" : "−"}{Math.abs(delta).toLocaleString("fr-FR")} FCFA</Text>}
    </View>
  );
}

function CandidateRow({ candidate, deliveryPrice, replacing, theme, onChoose }: { candidate: DriverCandidate; deliveryPrice: number; replacing: boolean; theme: ThemedColors; onChoose: () => void }) {
  const styles = useMemo(() => stylesFor(theme), [theme]);
  return (
    <View style={styles.row}>
      <CandidateIdentity candidate={candidate} deliveryPrice={deliveryPrice} theme={theme} />
      <View style={styles.rowFooter}>
        <Text style={styles.postedAt}>{shortRelative(candidate.createdAt)}</Text>
        <View style={styles.listSpacer} />
        <Pressable onPress={() => { haptic.light(); onChoose(); }} accessibilityRole="button" style={({ pressed }) => [styles.rowCta, pressed && styles.pressed]}>
          <Text style={styles.rowCtaText}>{replacing ? "Remplacer" : "Choisir"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ChosenCard({ candidate, deliveryPrice, theme, onUnselect }: { candidate: DriverCandidate; deliveryPrice: number; theme: ThemedColors; onUnselect: () => void }) {
  const styles = useMemo(() => stylesFor(theme), [theme]);
  const confirmed = candidate.status === "confirmed";
  return (
    <View style={styles.chosenCard}>
      <Text style={styles.chosenEyebrow}>{confirmed ? "VOTRE LIVREUR" : "LIVREUR RETENU"}</Text>
      <CandidateIdentity candidate={candidate} deliveryPrice={deliveryPrice} theme={theme} />
      <View style={styles.chosenFooter}>
        <MaterialIcons name={confirmed ? "check-circle" : "schedule"} size={15} color={confirmed ? theme.success : theme.warning} />
        <Text style={[styles.chosenStatus, { color: confirmed ? theme.success : theme.warning }]}>
          {confirmed ? "Il a confirmé sa disponibilité" : "En attente de sa confirmation"}
        </Text>
        <View style={styles.listSpacer} />
        {confirmed ? null : (
          <Pressable onPress={onUnselect} accessibilityRole="button" style={({ pressed }) => [styles.chosenUndo, pressed && styles.pressed]}>
            <Text style={styles.chosenUndoText}>Annuler le choix</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function SortSheet({ visible, selected, theme, onSelect, onClose }: { visible: boolean; selected: CandidateSort; theme: ThemedColors; onSelect: (sort: CandidateSort) => void; onClose: () => void }) {
  const styles = useMemo(() => stylesFor(theme), [theme]);
  // Rendue dans un `Modal`, donc hors du `SafeAreaView` : elle dégage
  // l'indicateur d'accueil elle-même, sinon la dernière option passe dessous.
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} accessibilityLabel="Fermer le tri" />
      <View style={[styles.sortSheet, { bottom: Math.max(26, insets.bottom + 14) }]}>
        <Text style={styles.sortTitle}>Trier les candidats</Text>
        {CANDIDATE_SORTS.map((entry) => (
          <Pressable
            key={entry.key}
            onPress={() => onSelect(entry.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: entry.key === selected }}
            style={({ pressed }) => [styles.sortOption, entry.key === selected && styles.sortOptionActive, pressed && styles.pressed]}
          >
            <Text style={[styles.sortOptionText, entry.key === selected && styles.sortOptionTextActive]}>{entry.label}</Text>
            {entry.key === selected ? <MaterialIcons name="check" size={18} color={theme.primary} /> : null}
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

/**
 * Ce que choisir engage, en chiffres.
 *
 * L'ancienne confirmation réutilisait le modal financier générique, dont le montant est
 * la commission — prélevée **au livreur**. Un expéditeur acceptant une contre-offre de
 * 4 500 FCFA lisait donc « 300 FCFA », le seul montant de l'écran qui ne le concernait
 * pas. Ici, les trois lignes sont les siennes.
 */
function ChoiceModal({ candidate, deliveryPrice, replacing, loading, theme, onCancel, onConfirm }: {
  candidate: DriverCandidate;
  deliveryPrice: number;
  replacing: boolean;
  loading: boolean;
  theme: ThemedColors;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const styles = useMemo(() => stylesFor(theme), [theme]);
  const insets = useSafeAreaInsets();
  const total = candidatePrice(candidate, deliveryPrice);
  const delta = candidatePriceDelta(candidate, deliveryPrice);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.modalBackdrop} onPress={onCancel} accessibilityLabel="Fermer" />
      <View style={[styles.choiceSheet, { paddingBottom: Math.max(26, insets.bottom + 14) }]}>
        <View style={styles.choiceHead}>
          <Avatar initials={candidate.initials} color={candidate.isCertified ? theme.foreground : theme.muted} size={46} />
          <View style={styles.choiceHeadBody}>
            <Text style={styles.choiceName} numberOfLines={1}>{candidate.name}</Text>
            <Text style={styles.meta} numberOfLines={1}>{describeReputation(candidate)} · {describeReach(candidate)}</Text>
          </View>
        </View>

        <View style={styles.ledger}>
          <View style={styles.ledgerRow}>
            <Text style={styles.ledgerLabel}>Votre prix publié</Text>
            <Text style={styles.ledgerValue}>{formatMoney(deliveryPrice)}</Text>
          </View>
          {delta !== 0 ? (
            <View style={[styles.ledgerRow, styles.ledgerRowBordered]}>
              <Text style={styles.ledgerLabel}>Sa contre-offre</Text>
              <Text style={[styles.ledgerValueStrong, { color: delta > 0 ? theme.warning : theme.success }]}>{delta > 0 ? "+" : "−"}{Math.abs(delta).toLocaleString("fr-FR")} FCFA</Text>
            </View>
          ) : null}
          <View style={[styles.ledgerRow, styles.ledgerTotal]}>
            <Text style={styles.ledgerTotalLabel}>Vous paierez</Text>
            <Text style={styles.ledgerTotalValue}>{formatMoney(total)}</Text>
          </View>
        </View>

        <View style={styles.noteRow}>
          <MaterialIcons name="info-outline" size={15} color={theme.muted} />
          <Text style={styles.noteText}>Vous réglez ce montant directement au livreur à la remise. La commission Tikis est retenue sur le compte du livreur, pas sur le vôtre.</Text>
        </View>
        <View style={styles.noteRow}>
          <MaterialIcons name="check-circle-outline" size={15} color={theme.success} />
          <Text style={styles.noteText}>
            {replacing
              ? "Le livreur actuellement retenu sera libéré et sa commission compensée : Tikis n’en conserve qu’une seule pour cette course."
              : "Tant qu’il n’a pas confirmé sa disponibilité, vous pouvez annuler ce choix sans aucun frais."}
          </Text>
        </View>

        <TikisButton
          label={`${replacing ? "Remplacer par" : "Choisir"} ${firstName(candidate.name)} · ${formatMoney(total)}`}
          onPress={onConfirm}
          loading={loading}
          loadingLabel="Enregistrement…"
          style={styles.choiceCta}
        />
        <TikisButton label="Revenir à la liste" variant="ghost" onPress={onCancel} disabled={loading} style={styles.choiceCancel} />
      </View>
    </Modal>
  );
}

/** « ★ 4,9 · 168 courses » : ce que vaut le livreur. */
function describeReputation(candidate: DriverCandidate): string {
  return `★ ${candidate.rating.toLocaleString("fr-FR")} · ${candidate.completedDeliveries} course${candidate.completedDeliveries > 1 ? "s" : ""}`;
}

/** « Moto · Tricycle · à 1,2 km » : ce avec quoi il vient, et d'où.
 *
 *  La distance n'est jamais approchée : faute de position récente, la ligne le dit.
 *  L'écran précédent affichait « 1,2 km » écrit en dur pour tous les candidats. */
function describeReach(candidate: DriverCandidate): string {
  const distance = typeof candidate.distanceFromPickupKm === "number"
    ? `à ${candidate.distanceFromPickupKm.toLocaleString("fr-FR")} km`
    : "position inconnue";
  return [...candidate.vehicles, distance].join(" · ");
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function shortRelative(iso: string, now = Date.now()): string {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "—";
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

const stylesFor = createStyles((theme: ThemedColors) => ({
  safe: { flex: 1, backgroundColor: theme.background },
  content: { paddingHorizontal: 16, paddingBottom: 40, gap: 8 },
  pressed: { opacity: 0.6 },

  topBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12 },
  iconBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" },
  topBarText: { flex: 1, minWidth: 0 },
  topBarEyebrow: { fontSize: 10, fontWeight: "700", letterSpacing: 0.7, color: theme.primary },
  topBarTitle: { fontSize: 18, fontWeight: "700", letterSpacing: -0.4, color: theme.foreground, marginTop: 2 },

  recap: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  recapTitle: { fontSize: 13, fontWeight: "700", color: theme.foreground },
  recapRoute: { fontSize: 11.5, fontWeight: "500", color: theme.muted, marginTop: 3 },
  recapBottom: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 9, paddingTop: 9, borderTopWidth: 1, borderTopColor: theme.border },
  recapLabel: { fontSize: 11.5, fontWeight: "600", color: theme.muted },
  recapPrice: { fontSize: 14, fontWeight: "700", color: theme.foreground, fontVariant: ["tabular-nums"] },
  recapSpacer: { flex: 1 },
  vehicleChip: { height: 22, paddingHorizontal: 8, borderRadius: 6, backgroundColor: theme.background, alignItems: "center", justifyContent: "center" },
  vehicleChipText: { fontSize: 10.5, fontWeight: "600", color: theme.foreground },

  errorCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 14, padding: 13 },
  errorBody: { flex: 1, minWidth: 0 },
  errorTitle: { fontSize: 13, fontWeight: "700", color: theme.foreground },
  errorText: { fontSize: 11.5, color: theme.muted, marginTop: 2 },
  retry: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 9, borderWidth: 1, borderColor: theme.border },
  retryText: { fontSize: 11.5, fontWeight: "700", color: theme.foreground },

  bestCard: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.foreground, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 13, marginTop: 4 },
  bestEyebrow: { fontSize: 10, fontWeight: "700", letterSpacing: 0.7, color: theme.primary, marginBottom: 9 },
  bestReason: { fontSize: 12, lineHeight: 17, color: theme.muted, marginTop: 10 },
  bestCta: { marginTop: 11 },

  chosenCard: { backgroundColor: theme.surface, borderWidth: 2, borderColor: theme.foreground, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 12, marginTop: 4 },
  chosenEyebrow: { fontSize: 10, fontWeight: "700", letterSpacing: 0.7, color: theme.primary, marginBottom: 9 },
  chosenFooter: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 11, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.border },
  chosenStatus: { fontSize: 11.5, fontWeight: "600" },
  chosenUndo: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, borderWidth: 1, borderColor: theme.border },
  chosenUndoText: { fontSize: 11.5, fontWeight: "700", color: theme.foreground },

  listHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, marginBottom: 2 },
  listHeaderTitle: { fontSize: 10, fontWeight: "700", letterSpacing: 0.7, color: theme.muted },
  listSpacer: { flex: 1 },
  control: { flexDirection: "row", alignItems: "center", gap: 5, height: 30, paddingHorizontal: 11, borderRadius: 9, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
  controlActive: { backgroundColor: theme.foreground, borderColor: theme.foreground },
  controlText: { fontSize: 11.5, fontWeight: "600", color: theme.muted },
  controlTextActive: { color: theme.background },
  controlCount: { fontSize: 10, fontWeight: "700", color: theme.muted },

  row: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 14, paddingHorizontal: 13, paddingVertical: 12 },
  rowFooter: { flexDirection: "row", alignItems: "center", marginTop: 11, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.border },
  postedAt: { fontSize: 11, fontWeight: "500", color: theme.muted },
  rowCta: { height: 34, paddingHorizontal: 18, borderRadius: 10, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" },
  rowCtaText: { fontSize: 12.5, fontWeight: "700", color: theme.primary },

  identityRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  identityBody: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { fontSize: 14.5, fontWeight: "700", color: theme.foreground, flexShrink: 1 },
  certPill: { borderRadius: 5, paddingHorizontal: 4, paddingVertical: 2, backgroundColor: theme.background, flexShrink: 0 },
  certPillText: { fontSize: 7.5, fontWeight: "700", letterSpacing: 0.3, color: theme.success },
  meta: { fontSize: 11.5, fontWeight: "500", color: theme.muted, marginTop: 2 },
  subMeta: { fontSize: 11, fontWeight: "500", color: theme.muted, marginTop: 2, opacity: 0.8 },

  priceBlock: { alignItems: "flex-end" },
  price: { fontSize: 16, fontWeight: "700", color: theme.foreground, letterSpacing: -0.3, fontVariant: ["tabular-nums"] },
  priceNeutral: { fontSize: 11, fontWeight: "600", color: theme.muted, marginTop: 1 },
  priceDelta: { fontSize: 11, fontWeight: "700", marginTop: 1, fontVariant: ["tabular-nums"] },

  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 34, gap: 6 },
  centeredTitle: { fontSize: 15, fontWeight: "700", color: theme.foreground, marginTop: 10 },
  centeredText: { fontSize: 12, lineHeight: 18, textAlign: "center", color: theme.muted },
  centeredButton: { marginTop: 14, alignSelf: "stretch" },

  empty: { alignItems: "center", paddingVertical: 44, paddingHorizontal: 26 },
  emptyIcon: { width: 64, height: 64, borderRadius: 16, backgroundColor: theme.surface, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: theme.foreground },
  emptyText: { fontSize: 12, lineHeight: 18, textAlign: "center", color: theme.muted, marginTop: 4 },
  filterEmpty: { fontSize: 12, textAlign: "center", color: theme.muted, paddingVertical: 24 },
  message: { fontSize: 12, textAlign: "center", color: theme.error, marginTop: 12 },

  modalBackdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: theme.overlay },
  sortSheet: { position: "absolute", left: 16, right: 16, bottom: 26, backgroundColor: theme.surface, borderRadius: 18, padding: 8 },
  sortTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, color: theme.muted, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6 },
  sortOption: { flexDirection: "row", alignItems: "center", height: 46, paddingHorizontal: 10, borderRadius: 12 },
  sortOptionActive: { backgroundColor: theme.background },
  sortOptionText: { flex: 1, fontSize: 13.5, fontWeight: "600", color: theme.foreground },
  sortOptionTextActive: { fontWeight: "700" },

  choiceSheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: theme.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 26 },
  choiceHead: { flexDirection: "row", alignItems: "center", gap: 11 },
  choiceHeadBody: { flex: 1, minWidth: 0 },
  choiceName: { fontSize: 17, fontWeight: "700", letterSpacing: -0.3, color: theme.foreground },
  ledger: { marginTop: 16, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 14, overflow: "hidden" },
  ledgerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12 },
  ledgerRowBordered: { borderTopWidth: 1, borderTopColor: theme.border },
  ledgerLabel: { fontSize: 12.5, fontWeight: "500", color: theme.muted },
  ledgerValue: { fontSize: 13, fontWeight: "600", color: theme.muted, fontVariant: ["tabular-nums"] },
  ledgerValueStrong: { fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
  ledgerTotal: { borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.background, paddingVertical: 14, alignItems: "baseline" },
  ledgerTotalLabel: { fontSize: 12.5, fontWeight: "700", color: theme.foreground },
  ledgerTotalValue: { fontSize: 22, fontWeight: "700", letterSpacing: -0.5, color: theme.foreground, fontVariant: ["tabular-nums"] },
  noteRow: { flexDirection: "row", gap: 9, marginTop: 12 },
  noteText: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 17, color: theme.muted },
  choiceCta: { marginTop: 18 },
  choiceCancel: { marginTop: 9 },
}));
