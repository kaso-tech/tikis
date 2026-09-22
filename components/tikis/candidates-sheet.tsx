import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Dimensions, Modal, PanResponder, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar, TikisButton } from "@/components/tikis/ui";
import { createStyles } from "@/lib/create-styles";
import { formatListRoute } from "@/lib/geo-rules";
import { haptic } from "@/lib/haptics";
import { nextSheetLevel, sheetDragOffset, type SheetLevel } from "@/lib/sheet-gesture";
import { useThemeColors, type ThemedColors } from "@/lib/use-theme-colors";
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

const SCREEN_HEIGHT = Dimensions.get("window").height;
const SHEET_MID_HEIGHT = Math.round(SCREEN_HEIGHT * 0.72);
const SHEET_FULL_HEIGHT = Math.round(SCREEN_HEIGHT * 0.92);

function sheetHeightFor(level: SheetLevel): number {
  return level === "full" ? SHEET_FULL_HEIGHT : SHEET_MID_HEIGHT;
}

type Props = {
  visible: boolean;
  deliveryId: string | null;
  onClose: () => void;
};

/**
 * Choisir un livreur parmi les candidats, dans une feuille glissante.
 *
 * La feuille précédente avait deux défauts de conteneur, tous deux structurels :
 *
 *  - elle ne défilait pas. `scrollEnabled` se lisait sur une `ref`, qui ne
 *    redéclenche aucun rendu : agrandir la feuille ne débloquait rien. Ici le
 *    palier vit dans un `state` — comme dans la feuille de suivi — et le
 *    défilement n'est de toute façon jamais coupé, le geste de glissement étant
 *    confiné à la poignée ;
 *  - sur Android elle passait *sous* la feuille d'accueil, `elevation` décidant
 *    seul de l'ordre de peinture entre frères. Elle est maintenant rendue dans
 *    un `Modal`, c'est-à-dire dans sa propre fenêtre : aucun frère ne peut
 *    passer devant.
 *
 * Elle s'ouvre à 72 % de la hauteur au lieu de 45 %, ce qui laisse voir quatre
 * candidats au lieu de deux, et se déplie à 92 %. Un geste franc vers le bas
 * depuis le palier bas la referme.
 *
 * Le contenu, lui, répond à la seule question posée : combien, par rapport au
 * prix publié. Une contre-offre de 4 500 FCFA sur une course à 3 000 s'affichait
 * exactement comme un prix accepté ; la distance « 1,2 km » était écrite en dur
 * pour tout le monde ; et l'écran de confirmation montrait la commission
 * prélevée *au livreur* comme s'il s'agissait du montant dû.
 */
export function CandidatesSheet({ visible, deliveryId, onClose }: Props) {
  const { colors: theme } = useThemeColors();
  const styles = useMemo(() => stylesFor(theme), [theme]);
  const insets = useSafeAreaInsets();
  const utilities = trpc.useUtils();

  const queryId = deliveryId ?? "00000000-0000-4000-8000-000000000000";
  const enabled = visible && Boolean(deliveryId);
  const deliveryQuery = trpc.deliveries.get.useQuery({ id: queryId }, { enabled });
  const candidatesQuery = trpc.deliveries.candidates.useQuery({ deliveryId: queryId }, { enabled });
  const selectMutation = trpc.deliveries.selectCandidate.useMutation();

  const [level, setLevel] = useState<SheetLevel>("mid");
  const [sort, setSort] = useState<CandidateSort>(DEFAULT_CANDIDATE_SORT);
  const [sortOpen, setSortOpen] = useState(false);
  const [certifiedOnly, setCertifiedOnly] = useState(false);
  const [pending, setPending] = useState<DriverCandidate | null>(null);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");

  // useState plutôt que useRef(...).current : une valeur Animated stable, créée une seule fois, lue
  // pendant le rendu (styles ci-dessous) — ce que le React Compiler interdit à un ref
  // (react-hooks/refs), pas à un state dont on n'appelle jamais le setter.
  const [baseHeight] = useState(() => new Animated.Value(SHEET_MID_HEIGHT));
  const [panY] = useState(() => new Animated.Value(0));
  const [enter] = useState(() => new Animated.Value(0));
  const levelRef = useRef<SheetLevel>("mid");
  // Écrit hors du rendu : affecter `.current` directement dans le corps du composant est aussi
  // interdit par le compilateur qu'une lecture — seul un effet ou un gestionnaire le peut.
  useEffect(() => { levelRef.current = level; });
  // Fermer depuis le PanResponder, créé une seule fois : sans cette indirection il
  // capturerait le `onClose` du premier rendu.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  // Chaque ouverture repart du palier bas et de l'état neutre : une feuille rouverte sur le filtre
  // « Certifiés » d'une autre course serait incompréhensible. Ajustement pendant le rendu (state
  // React) plutôt que dans un effet : le compilateur interdit un setState synchrone dans le corps
  // d'un effet (react-hooks/set-state-in-effect), et ce motif — comparer au rendu précédent — est le
  // remplacement documenté (https://react.dev/reference/react/useState#storing-information-from-previous-renders).
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setLevel("mid");
      setSort(DEFAULT_CANDIDATE_SORT);
      setCertifiedOnly(false);
      setPending(null);
      setSortOpen(false);
      setMessage("");
    }
  }

  // Ce qui reste dans un effet : uniquement l'animation elle-même, un appel impératif à un système
  // externe (Animated) — pas du state React, donc rien que le compilateur n'interdise ici.
  useEffect(() => {
    if (!visible) return;
    baseHeight.setValue(SHEET_MID_HEIGHT);
    panY.setValue(0);
    enter.setValue(0);
    // Pilote JS, pas natif : `enter` anime le `translateY` de la feuille, dont le
    // même nœud de style porte aussi la `height`. Un seul nœud ne peut pas être
    // à cheval sur les deux pilotes — rendre `enter` natif force tout le style à
    // passer en natif, et le module natif ne sait pas animer `height`.
    Animated.spring(enter, { toValue: 1, useNativeDriver: false, bounciness: 0, speed: 14 }).start();
  }, [visible, baseHeight, panY, enter]);

  useEffect(() => {
    Animated.timing(baseHeight, { toValue: sheetHeightFor(level), duration: 220, useNativeDriver: false }).start();
    panY.setValue(0);
  }, [level, baseHeight, panY]);

  // useState (initialiseur paresseux) plutôt que useRef(...).current : PanResponder.create est appelé
  // une seule fois, sa référence reste stable sur toute la vie de la feuille — un recalcul à chaque
  // rendu casserait un glissement en cours au prochain rafraîchissement de données. Les callbacks lisent
  // levelRef.current / closeRef.current : sûr, puisqu'ils ne sont jamais appelés pendant le rendu,
  // seulement à l'événement — mais le compilateur ne peut pas le prouver statiquement, d'où la
  // désactivation ciblée ci-dessous.
  // eslint-disable-next-line react-hooks/refs -- lecture différée à l'événement, jamais pendant le rendu (cf. commentaire au-dessus)
  const [panResponder] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
    onPanResponderMove: (_, gesture) => { panY.setValue(sheetDragOffset(gesture.dy)); },
    onPanResponderRelease: (_, gesture) => {
      const next = nextSheetLevel(levelRef.current, gesture.dy, gesture.vy);
      Animated.timing(panY, { toValue: 0, duration: 200, useNativeDriver: false }).start();
      // Une liste n'a pas de palier replié utile : le geste qui y mènerait ferme.
      if (next === "mini") closeRef.current();
      else setLevel(next);
    },
    onPanResponderTerminate: () => { Animated.timing(panY, { toValue: 0, duration: 200, useNativeDriver: false }).start(); },
  }));

  const delivery = deliveryQuery.data;
  const deliveryPrice = delivery ? (delivery.offeredPrice ?? delivery.estimatedPrice) : 0;
  const candidates = useMemo(() => candidatesQuery.data ?? [], [candidatesQuery.data]);
  const chosen = useMemo(() => candidates.find((candidate) => candidate.status === "selected" || candidate.status === "confirmed") ?? null, [candidates]);
  const running = useMemo(() => candidates.filter(isCandidateInRunning), [candidates]);

  // Le bandeau ne s'affiche que tant que personne n'est retenu : une fois le choix fait,
  // c'est le livreur retenu qui occupe le haut de la feuille, pas une suggestion périmée.
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
    if (!pending || !deliveryId) return;
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

  if (!visible) return null;

  const loading = candidatesQuery.isLoading || deliveryQuery.isLoading;
  const error = candidatesQuery.error?.message ?? null;
  const height = Animated.add(baseHeight, panY);
  const slide = enter.interpolate({ inputRange: [0, 1], outputRange: [SHEET_FULL_HEIGHT, 0] });

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[styles.backdrop, { opacity: enter }]} pointerEvents="auto">
        <Pressable style={styles.backdropFill} onPress={onClose} accessibilityLabel="Fermer la liste des candidats" />
      </Animated.View>

      <Animated.View style={[styles.sheet, { height, transform: [{ translateY: slide }] }]}>
        <View {...panResponder.panHandlers} accessibilityRole="adjustable" accessibilityLabel="Glisser pour déplier la liste">
          <View style={styles.grip} />
          <View style={styles.headerRow}>
            <View style={styles.headerText}>
              <Text style={styles.headerEyebrow}>CANDIDATURES</Text>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {chosen
                  ? `${chosen.name} est retenu`
                  : loading
                    ? "Chargement des candidatures…"
                    : running.length === 0
                      ? "Aucun candidat pour l’instant"
                      : running.length === 1
                        ? "1 livreur, à confirmer"
                        : `${running.length} livreurs, un seul à choisir`}
              </Text>
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Fermer" style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}>
              <MaterialIcons name="close" size={18} color={theme.foreground} />
            </Pressable>
          </View>

          {delivery ? (
            <View style={styles.recap}>
              <View style={styles.recapLine}>
                <Text style={styles.recapLabel}>Votre prix</Text>
                <Text style={styles.recapPrice}>{formatMoney(deliveryPrice)}</Text>
                <View style={styles.listSpacer} />
                {/* Les engins demandés restent sous les yeux : sans eux, la ligne
                    « Moto · à 1,2 km » d'un candidat ne se juge pas. */}
                {delivery.vehicleTypes.map((vehicle) => <View key={vehicle} style={styles.vehicleChip}><Text style={styles.vehicleChipText}>{vehicle}</Text></View>)}
              </View>
              {/* `formatListRoute` et non les villes brutes : deux points de la même
                  ville donnaient « Ouagadougou → Ouagadougou », qui n'apprend rien. */}
              <Text style={styles.recapRoute} numberOfLines={1}>{formatListRoute(delivery.pickup, delivery.dropoff)} · {delivery.distanceKm.toLocaleString("fr-FR")} km</Text>
            </View>
          ) : null}
        </View>

        {/* Jamais conditionnel : c'est précisément sa désactivation au palier bas,
            lue sur une `ref`, qui rendait l'ancienne liste impossible à parcourir. */}
        <ScrollView style={styles.list} contentContainerStyle={[styles.content, { paddingBottom: 28 + insets.bottom }]} showsVerticalScrollIndicator={false}>
          {loading ? (
            <View style={styles.centered}><ActivityIndicator color={theme.primary} /><Text style={styles.centeredTitle}>Chargement des candidatures…</Text></View>
          ) : null}

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
            <ChosenCard
              candidate={chosen}
              deliveryPrice={deliveryPrice}
              theme={theme}
              onUnselect={() => { onClose(); if (deliveryId) router.push(`/delivery/${deliveryId}` as any); }}
            />
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

          {!loading && !error && running.length === 0 ? (
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
      </Animated.View>

      {/* Le tri et la confirmation sont posés dans la même fenêtre que la feuille,
          et non dans des `Modal` imbriqués : sur Android, un modal dans un modal
          se ferme par paires imprévisibles. */}
      {sortOpen ? (
        <View style={styles.layer}>
          <Pressable style={styles.backdropFill} onPress={() => setSortOpen(false)} accessibilityLabel="Fermer le tri" />
          <View style={[styles.sortSheet, { bottom: Math.max(26, insets.bottom + 14) }]}>
            <Text style={styles.sortTitle}>Trier les candidats</Text>
            {CANDIDATE_SORTS.map((entry) => (
              <Pressable
                key={entry.key}
                onPress={() => { setSort(entry.key); setSortOpen(false); }}
                accessibilityRole="button"
                accessibilityState={{ selected: entry.key === sort }}
                style={({ pressed }) => [styles.sortOption, entry.key === sort && styles.sortOptionActive, pressed && styles.pressed]}
              >
                <Text style={[styles.sortOptionText, entry.key === sort && styles.sortOptionTextActive]}>{entry.label}</Text>
                {entry.key === sort ? <MaterialIcons name="check" size={18} color={theme.primary} /> : null}
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {pending ? (
        <View style={styles.layer}>
          <Pressable style={styles.backdropFill} onPress={() => !processing && setPending(null)} accessibilityLabel="Fermer" />
          <ChoicePanel
            candidate={pending}
            deliveryPrice={deliveryPrice}
            replacing={Boolean(chosen)}
            loading={processing}
            theme={theme}
            bottomInset={insets.bottom}
            onCancel={() => !processing && setPending(null)}
            onConfirm={() => void confirmChoice()}
          />
        </View>
      ) : null}
    </Modal>
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

/**
 * Ce que choisir engage, en chiffres.
 *
 * L'ancienne confirmation réutilisait le modal financier générique, dont le montant est
 * la commission — prélevée **au livreur**. Un expéditeur acceptant une contre-offre de
 * 4 500 FCFA lisait donc « 300 FCFA », le seul montant de l'écran qui ne le concernait
 * pas. Ici, les trois lignes sont les siennes.
 */
function ChoicePanel({ candidate, deliveryPrice, replacing, loading, theme, bottomInset, onCancel, onConfirm }: {
  candidate: DriverCandidate;
  deliveryPrice: number;
  replacing: boolean;
  loading: boolean;
  theme: ThemedColors;
  bottomInset: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const styles = useMemo(() => stylesFor(theme), [theme]);
  const total = candidatePrice(candidate, deliveryPrice);
  const delta = candidatePriceDelta(candidate, deliveryPrice);
  return (
      <View style={[styles.choiceSheet, { paddingBottom: Math.max(26, bottomInset + 14) }]}>
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
          <Text style={styles.noteText}>Réglé directement au livreur à la remise ; la commission Tikis reste à sa charge.</Text>
        </View>
        <View style={styles.noteRow}>
          <MaterialIcons name="check-circle-outline" size={15} color={theme.success} />
          <Text style={styles.noteText}>
            {replacing
              ? "Le livreur actuel est libéré et sa commission compensée : une seule commission Tikis pour cette course."
              : "Annulable sans frais tant qu’il n’a pas confirmé sa disponibilité."}
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
  pressed: { opacity: 0.6 },

  backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: theme.overlay },
  backdropFill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  // Le voile appartient à la couche, pas seulement au fond de la feuille : sans
  // lui, le panneau de confirmation se posait sur une liste restée lisible et
  // tranchait le milieu d'une ligne.
  layer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, justifyContent: "flex-end", backgroundColor: theme.overlay },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: theme.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: "hidden" },
  grip: { width: 40, height: 4, borderRadius: 2, backgroundColor: theme.border, alignSelf: "center", marginTop: 9, marginBottom: 11 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
  headerText: { flex: 1, minWidth: 0 },
  headerEyebrow: { fontSize: 10, fontWeight: "700", letterSpacing: 0.7, color: theme.primary },
  headerTitle: { fontSize: 18, fontWeight: "700", letterSpacing: -0.4, color: theme.foreground, marginTop: 2 },
  iconBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" },

  recap: { marginTop: 12, paddingHorizontal: 16, paddingVertical: 9, gap: 3, backgroundColor: theme.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.border },
  recapLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  recapLabel: { fontSize: 11.5, fontWeight: "600", color: theme.muted },
  recapPrice: { fontSize: 13.5, fontWeight: "700", color: theme.foreground, fontVariant: ["tabular-nums"] },
  recapRoute: { fontSize: 11.5, fontWeight: "500", color: theme.muted },
  vehicleChip: { height: 21, paddingHorizontal: 7, borderRadius: 6, backgroundColor: theme.background, alignItems: "center", justifyContent: "center" },
  vehicleChipText: { fontSize: 10.5, fontWeight: "600", color: theme.foreground },

  list: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },

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

  centered: { alignItems: "center", justifyContent: "center", paddingVertical: 54, gap: 6 },
  centeredTitle: { fontSize: 14, fontWeight: "600", color: theme.muted, marginTop: 10 },

  empty: { alignItems: "center", paddingVertical: 44, paddingHorizontal: 26 },
  emptyIcon: { width: 64, height: 64, borderRadius: 16, backgroundColor: theme.surface, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: theme.foreground },
  emptyText: { fontSize: 12, lineHeight: 18, textAlign: "center", color: theme.muted, marginTop: 4 },
  filterEmpty: { fontSize: 12, textAlign: "center", color: theme.muted, paddingVertical: 24 },
  message: { fontSize: 12, textAlign: "center", color: theme.error, marginTop: 12 },

  sortSheet: { position: "absolute", left: 16, right: 16, bottom: 26, backgroundColor: theme.surface, borderRadius: 18, padding: 8 },
  sortTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, color: theme.muted, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6 },
  sortOption: { flexDirection: "row", alignItems: "center", height: 46, paddingHorizontal: 10, borderRadius: 12 },
  sortOptionActive: { backgroundColor: theme.background },
  sortOptionText: { flex: 1, fontSize: 13.5, fontWeight: "600", color: theme.foreground },
  sortOptionTextActive: { fontWeight: "700" },

  choiceSheet: { backgroundColor: theme.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 26 },
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
