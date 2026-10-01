# Audit thème Tikis — 2026-09-12

## Symptôme rapporté
"Les indications sont absentes quand je teste"

L'utilisateur voit l'app sans indication après le merge `1a0d0f7` "Stabilise les correctifs fonctionnels de main" posé par l'autre agent à 00:10 UTC.

## Cause racine identifiée

L'agent tierce (`Manus`) a **reverté l'intégralité du travail P5/P6** sur 27 fichiers UI. Sa "stabilisation" consistait à :
1. Remplacer `createStyles(theme)` par `StyleSheet.create` statique
2. Remplacer `theme.*` par des **valeurs hardcodées** directement dans le StyleSheet
3. Inventer ~100 couleurs fantômes qui ne sont pas dans `theme.config.js`
4. Faire régresser `ui.tsx` vers l'ancien design beige/crème (avant P3)
5. Réintroduire l'ancien fond `#EEEDF3` (avant le commit `4831201` qui l'a remplacé par `#F5F5F5`)
6. Réintroduire l'ancien teal `#007B8B` (avant le commit `bba9e8b` qui l'a purgé)

**Résultat** : l'app **fonctionne** (les couleurs s'affichent), mais c'est un mélange incohérent d'ancien thème (gris-bleu, beige, teal) + nouveau thème (brun, creme) + couleurs inventées.

## Bilan chiffré

| Indicateur | Avant 1a0d0f7 (notre état) | Après 1a0d0f7 (état cassé) |
|---|---|---|
| Fichiers `createStyles` | 14 | **0** |
| Fichiers `StyleSheet.create` statique (UI) | 2 (ui.tsx + live-tracking) | **17** |
| Couleurs hardcoded dans 15 fichiers | 15 | **963** |
| Couleurs fantômes (hors theme.config.js) | 0 | **~100** |
| Fichiers avec fond `#EEEDF3` | 0 | **11** |
| Fichiers avec teal `#007B8B` | 0 | **7** (régression) |
| Fichiers avec `theme.primary` dynamique | 14 | **0** (régression) |

## Fichiers cassés par ordre de priorité

### Critiques (écrans principaux)
1. `components/tikis/ui.tsx` (92 lignes) — design system régressé en beige/crème
2. `components/tikis/app-chrome.tsx` (TikisHeader + TikisDrawer) — `StyleSheet.create` statique
3. `app/(tabs)/profile.tsx` (653 lignes) — 76 hardcoded, **CtaTile a disparu**, retour au MenuRow style 1
4. `app/(tabs)/wallet.tsx` — 51 hardcoded, StyleSheet statique
5. `app/(tabs)/earnings.tsx` — 25 hardcoded
6. `app/(tabs)/profile.tsx` — idem
7. `app/delivery/[id].tsx` — 106 hardcoded, StyleSheet statique
8. `app/create-delivery.tsx` — 107 hardcoded, StyleSheet statique

### Majeurs
9. `components/tikis/auth-flow.tsx` — 140 hardcoded, **0 `useThemeColors`** ! C'est catastrophique car on a passé P0 entier à le migrer
10. `components/tikis/screens/home-screen.native.tsx` — 131 hardcoded
11. `components/tikis/screens/home-screen.web.tsx` — 121 hardcoded
12. `app/report/[id].tsx` — 38 hardcoded
13. `app/review/[id].tsx` — 28 hardcoded
14. `app/reviews.tsx` — 21 hardcoded
15. `app/contact.tsx` — 20 hardcoded
16. `components/tikis/candidates-sheet.tsx` — 16 hardcoded
17. `components/tikis/live-tracking-screen.native.tsx` — 16 hardcoded

## Couleurs fantômes (top 20, les pires)

| Couleur | Occurrences | Devrait être |
|---|---|---|
| `#EEEDF3` | 12 | `theme.background` (`#F5F5F5`) |
| `#F7EFE5` | 10 | `theme.surface` (`#FFFFFF`) |
| `#E5D2B9` | 10 | `theme.border` (`#E3E3E3`) |
| `#B48753` | 9 | `theme.primary` (`#9A6201`) ou variante brun doré |
| `#747474` | 9 | `theme.muted` (`#667085`) |
| `#B4232D` | 8 | `theme.error` (`#A43740`) |
| `#007B8B` | 7 | (teal Tikis supprimé en P3) |
| `#F8F0E5` | 7 | `theme.surface` (`#FFFFFF`) ou variante |
| `#167A55` | 7 | `theme.success` (`#176C52`) |
| `#666666` | 7 | `theme.muted` (`#667085`) |
| `#D5D5DC` | 6 | `theme.border` (`#E3E3E3`) |
| `#9A6200` | 6 | `theme.primary` (`#9A6201`) — nuance légèrement différente |
| `#8A96A8` | 4 | (inconnue au bataillon) |
| `#ECECEC` | 4 | `theme.border` (`#E3E3E3`) |
| `#78869A` | 3 | (inconnue) |
| `#8A5A0E` | 3 | (brun approximatif) |
| `#C23B45` | 3 | `theme.error` (`#A43740`) |
| `#E5F6F7` | 3 | (teal pastel supprimé) |
| `#697386` | 3 | `theme.muted` (`#667085`) |
| `#E2F3F4` | 3 | (teal pastel supprimé) |

## Régressions de tokens (avant/après)

| Token | Avant 1a0d0f7 | Après 1a0d0f7 |
|---|---|---|
| Background | `#F5F5F5` (theme.background) | `#EEEDF3` (11 fichiers) ou autres |
| Primary | `#9A6201` (theme.primary) | `#9A6200` ou `#9A6201` ou `#B48753` ou `#8A5A0E` (6 nuances différentes) |
| Success | `#176C52` (theme.success) | `#167A55` ou `#147A58` ou `#4F7A6C` ou `#5FC497` |
| Error | `#A43740` (theme.error) | `#B4232D` ou `#C23B45` ou `#A43740` |
| Surface | `#FFFFFF` (theme.surface) | `#FFFFFF` ou `#F7EFE5` ou `#F8F0E5` |
| Muted | `#667085` (theme.muted) | `#666666` ou `#747474` ou `#697386` ou `#78869A` |

## Plan de correction (à valider avec l'utilisateur)

### Option A : Refaire P5/P6 (gros chantier, ~2-3h)
- Re-migrer les 14 fichiers en `createStyles(theme)`
- Remplacer toutes les couleurs hardcoded par `theme.*`
- Re-blanchir `ui.tsx` (primary = blanc)
- Re-replacer `#EEEDF3` par `theme.background`
- Pousser en branche `mavis/fix-theme-regression`

### Option B : Hotfix ciblé (rapide, ~30min)
- Re-blanchir `ui.tsx` (primary = blanc comme en P3)
- Re-replacer les `#EEEDF3` par `#F5F5F5` (search/replace)
- Re-replacer `#007B8B` par `#9A6201`
- Re-replacer `#167A55` par `#176C52`
- Re-replacer `#F7EFE5` par `#FFFFFF` dans les surfaces
- Re-replacer `#9A6200` par `#9A6201`
- Re-replacer `#B4232D` par `#A43740`
- Re-replacer `#666666`/`#747474` par `#667085`

### Recommandation
**Option B d'abord** pour débloquer les tests visuels, **puis Option A** pour finir la migration.

## Note sur la gouvernance

L'autre agent et moi travaillons sur le même dépôt sans coordination explicite. Ses commits sur `claude/bonjour-0yo56s` ont été mergés sur `main` (via PR ou rebase manuel) mais ils **écrasent systématiquement** mon travail de migration thème. C'est un conflit d'objectifs :
- L'autre agent : stabilise les correctifs **fonctionnels** (bug fixes Phase 1-5)
- Moi : harmonise le **thème visuel** (P0-P6)

Les deux sont légitimes mais s'annulent mutuellement. **Solution de gouvernance** :
1. À l'avenir, **ne pas merger la branche tierce sans relecture manuelle des diffs de thème**
2. **Mes commits doivent passer par des branches `mavis/<name>`** puis PR
3. L'autre agent doit **respecter l'architecture `createStyles(theme)`** pour le style

## Fichiers de référence encore valides
- `theme.config.js` (intact, brun + dark variants)
- `lib/_core/theme.ts` (intact, génère palette + Fonts)
- `lib/theme-provider.tsx` (intact, applique via NativeWind)
- `lib/create-styles.ts` (intact, helper `createStyles(theme)`)
- `lib/use-theme-colors.ts` (intact, hook `useThemeColors()`)

→ **L'infrastructure thème est OK.** Le problème est uniquement que les composants ne l'utilisent plus.
