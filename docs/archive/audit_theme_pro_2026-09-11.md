# Audit thème Tikis vs standards apps pro

**Date** : 11 septembre 2026
**Périmètre** : couleurs de texte, icônes, polices, champs de saisie, bordures, border-radius, cartes, ombres
**Référence pro** : Uber, Glovo, Airbnb, Stripe, Vinted (design system modernes 2024-2026)

## Verdict global

**Note actuelle : 7,5/10** — la migration vers le thème brun est cohérente et lisible, mais plusieurs **écarts ponctuels** et un **gros bloc legacy** (`auth-flow.tsx`) empêchent l'app d'atteindre le niveau d'une vraie app pro.

### Ce qui est déjà pro ✅

| Élément | État | Commentaire |
|---|---|---|
| Palette brun/ambre `#9A6201` | ✅ | Original, distinctif, pas un clone teal/bleu générique |
| Tokens centralisés (`theme.config.js` + `useThemeColors()`) | ✅ | Architecture saine, dark mode géré |
| Fond `#F5F5F5` + surfaces `#FFFFFF` | ✅ | Bonne base, contraste propre |
| BorderRadius 8-14 (boutons 9, cards 10) | ✅ | Cohérent, moderne |
| Zéro ombre portée (`shadowOpacity > 0`) | ✅ | C'est le bon choix (style Stripe / Linear) |
| Letter-spacing négatif sur les titres | ✅ | `letterSpacing: -0.35` sur h1 |
| Hiérarchie typographique `400/500/600` | ✅ | La majorité du code respecte |
| `useNativeDriver` / animations | ✅ | PanResponder propre, sheets dragables |
| Material Icons (cohérent partout) | ✅ | Pas de mélange d'iconographie |
| Composants partagés (`TikisButton`, `SurfaceCard`, `StatusBadge`) | ✅ | Design system mini déjà en place |

### Les 7 écarts critiques 🔴

#### 1. **`auth-flow.tsx` n'utilise pas le thème brun — il utilise encore l'ancien thème teal** 🔴🔴🔴

**Impact** : le tout premier écran visible par chaque nouvel utilisateur (onboarding, OTP, choix rôle/véhicule, nom) est en **teal `#007B8B` / bleu nuit `#0B1F3A`** alors que tout le reste de l'app est en brun.

Preuve :
```js
// baseStyles dans auth-flow.tsx
brandChip: { backgroundColor: "#E5F6F7" }       // teal clair
brandChipText: { color: "#006572", fontWeight: "900" }
welcomeTitle: { color: "#0B1F3A", fontSize: 33, fontWeight: "900" }
welcomeSubtitle: { color: "#697386" }
languageActive: { backgroundColor: "#F7EFE5" }  // brun (mélangé)
phoneField: { backgroundColor: "#F7EFE5", borderColor: "#E5D2B9" }  // brun
otpInput: { backgroundColor: "#F7EFE5", borderColor: "#E5D2B9" }   // brun
phoneInput: { color: "#9A6201" }                                   // brun
fieldLabel: { color: "#8A96A8", fontWeight: "900" }                // legacy
heroIcon: { backgroundColor: "#E5F6F7" }                           // teal
vehicleCardActive: { backgroundColor: "#007B8B" }                  // teal legacy
lockedRole: { backgroundColor: "#FFF7E6" }                         // ambre legacy
```

Le `styles` ne fait qu'override 2 lignes (`safeArea.backgroundColor` et `scroll.padding`), donc visuellement **l'utilisateur voit du teal puis bascule brutalement en brun** dès qu'il arrive sur la home.

**Fix** : réécrire les `baseStyles` de `auth-flow.tsx` pour utiliser le thème brun cohérent. Lot dédié.

---

#### 2. **Couleurs de champs de saisie « teintées » (`#F7EFE5`) au lieu de blanc pur** 🟠

**Impact** : Les `<TextInput>` (OTP, téléphone, code parrainage, nom, avis, motif, etc.) ont un fond **beige/ambre clair** `#F7EFE5` qui fait très « 2019 Material ». Les apps pro 2024+ utilisent du **blanc pur `#FFFFFF`** avec border très subtile (`#E5E5E5` ou `#ECECEC`).

Preuve :
```js
// auth-flow.tsx
phoneField: { backgroundColor: "#F7EFE5", borderColor: "#E5D2B9" }
otpInput: { backgroundColor: "#F7EFE5", borderColor: "#E5D2B9" }
nameInput: { backgroundColor: "#F7EFE5", borderColor: "#E5D2B9" }

// report/[id].tsx
textarea: { backgroundColor: "#F7EFE5", borderColor: "#E5D2B9" }

// review/[id].tsx
comment: { backgroundColor: "#F7EFE5", borderColor: "#E5D2B9" }
```

**Fix** : remplacer `backgroundColor: "#F7EFE5"` → `backgroundColor: "#FFFFFF"` (ou `theme.surface`) sur tous les TextInput. Garder le brun uniquement pour l'état **focused** (border `theme.primary`).

---

#### 3. **`fontWeight: "800"` et `"900"` encore présents** 🟠

**Impact** : Beaucoup de composants utilisent du gras lourd qui rend l'app « criarde » et non pro. Les apps pro modernes (Stripe, Linear, Vercel) restent en `400/500/600`.

Fichiers concernés (8) : `auth-flow.tsx`, `account-status-screens.tsx`, `profile.tsx` (1 occurrence), `history.tsx`, `report/[id].tsx`, `delivery-drafts.tsx`, `delivery/[id]/map.tsx`.

Exemples :
```js
welcomeTitle: { fontWeight: "900" }      // -> "700" max
fieldLabel: { fontWeight: "900" }        // -> "600"
brandChipText: { fontWeight: "900" }     // -> "700"
countryName: { fontWeight: "900" }       // -> "600"
```

**Fix** : règle `fontWeight: max("700")` dans le `design.md` + script de remplacement `800→700, 900→700` (avec revue manuelle pour les titres où on veut vraiment gras).

---

#### 4. **13 fichiers avec tokens legacy hardcodés** 🟠

**Impact** : quand un nouveau développeur arrive, il voit deux jeux de couleurs dans le même projet, et finit par copier la mauvaise. Le risque de régression augmente.

Fichiers concernés :
```
app/(tabs)/profile.tsx                 (1 occurrence: avatarSender)
app/(tabs)/wallet.tsx                  (2: TONE_COLOR.primary, balanceCardSender)
app/delivery/[id]/map.tsx              (5: ETA banner #0B1F3A, timeline #007B8B, etc.)
app/report/[id].tsx                    (2: icon #007B8B, attach bg)
app/review/[id].tsx                    (2: avatar #007B8B, star #9AA5B6)
app/reviews.tsx                        (2: avatar #007B8B)
components/tikis/account-status-screens.tsx   (3: legacy)
components/tikis/auth-flow.tsx                (~15: legacy teal/bleu)
components/tikis/candidates-sheet.tsx         (1)
components/tikis/delivery-route-map.native.tsx   (1)
components/tikis/delivery-route-map.web.tsx       (1)
components/tikis/map-preview.web.tsx             (1)
components/tikis/place-sheets.tsx                (legacy)
```

**Fix** : remplacer toutes les valeurs par les tokens du thème :
- `#007B8B` → `theme.primary` (ou supprimer si on harmonise sur brun)
- `#0B1F3A` → `theme.foreground`
- `#F6F8FC` → `theme.background`
- `#167A55` → `theme.success`
- `#A43740` → `theme.error`

**Question design** : garder une **seconde couleur d'accent teal** pour différencier sender vs driver (wallet), ou harmoniser tout en brun ? Je recommande : **harmoniser** — un seul accent est plus pro.

---

#### 5. **Wallet : balance sender en teal `#007B8B` casse l'harmonie** 🟠

Preuve :
```js
balanceCardDriver: { backgroundColor: "#9A6201" }      // brun ✅
balanceCardSender: { backgroundColor: "#007B8B" }      // teal ❌
```

**Fix** : remplacer `#007B8B` par une variante brun plus claire (ex `#C2891F` ou un dégradé `9A6201 → D7A447`) pour différencier sender/driver sans introduire une 2e couleur d'accent.

---

#### 6. **Composants `account-status-screens.tsx` (banni, suspendu, supprimé)** 🟠

Écrans entiers en ancien thème (`#007B8B`, `#0B1F3A`, `#F6F8FC`). Pas critiques (rarement visités) mais visibles si un compte se fait bannir.

**Fix** : réécrire en thème brun.

---

#### 7. **`map-preview.web.tsx` (version web du preview de carte)** 🟡

Écran de preview utilisé par le web fallback. Pas critique, mais mélange les couleurs legacy.

**Fix** : harmoniser en `theme.primary` pour les markers, `theme.surface` pour le fond.

---

### Les éléments déjà très pro 💎

| Élément | Pourquoi c'est pro |
|---|---|
| `StatusBadge` (badge avec dot + label) | Pattern Linear/Stripe, très lisible |
| `Avatar` arrondi + initiales | Cohérent partout (home, sessions, profile) |
| Cards `borderWidth: 0` sur fond gris | Style Stripe — fond blanc sans border, le contraste avec le bg suffit |
| `letterSpacing: -0.35` sur h1 | Approche Linear/Vercel — titres compacts |
| `fontWeight: "600"` pour les boutons | Juste ce qu'il faut, pas criard |
| Dragger sheets (`Animated.spring`) | UX fluide, comparable à Google Maps |
| Haptic feedback sur les boutons | Détail pro souvent oublié |
| `accessibilityLabel` partout | Pro et conforme a11y |

---

### Plan de corrections par priorité

| Priorité | Lot | Effort | Impact |
|---|---|---|---|
| 🔴 P0 | Réécrire `auth-flow.tsx` en thème brun (1-2 fichiers, ~250 lignes) | 1/2 journée | **Énorme** — premier contact utilisateur |
| 🔴 P1 | Remplacer `bg #F7EFE5` → `#FFFFFF` sur tous les TextInput (~30 occurrences, 6 fichiers) | 1h | Élevé — fini le côté « daté » |
| 🟠 P2 | Réduire tous les `fontWeight: "800"/"900"` → `"700"` max (~30 occurrences, 8 fichiers) | 1h | Moyen — homogénéité typographique |
| 🟠 P3 | Remplacer tokens legacy hardcodés → `theme.*` (~40 occurrences, 13 fichiers) | 2h | Élevé en robustesse, visuel faible |
| 🟡 P4 | Wallet : balance sender → variante brun au lieu de teal | 30 min | Moyen — un seul accent dans l'app |
| 🟡 P5 | Réécrire `account-status-screens.tsx` | 1h | Faible (rarement visité) mais cohérence |
| 🟢 P6 | `map-preview.web.tsx` + `place-sheets.tsx` harmonisation | 30 min | Faible (web fallback) |

**Effort total estimé** : ~7h réparties en 1-2 PRs pour un saut de qualité visible.

### Inspiration design recommandée

- **Stripe** (Dashboard, Checkout) : le plus proche du style Tikis actuel — fond gris très clair, cards blanches sans border, accents sobres, **0 ombre**.
- **Uber** (Driver app) : plus coloré mais très lisible — sheets dragables, CTAs contrastés.
- **Linear** : la référence pour la sobriété pro — typographie fine, letter-spacing négatif, 0 ombre, hover subtils.
- **Vinted** (Recherche) : excellent pour les marketplaces 2-sided (sender + driver) — différenciation par icônes pas par couleurs criardes.

### Recommandation finale

**Avant de merger la suite** : faire au minimum les lots P0 + P1 + P2 (~3h). Ils transforment immédiatement l'app de « sympa mais daté » à « pro et moderne ».

Les lots P3-P6 peuvent être batchés en une grosse PR « Harmonis tokens legacy » pour fermer ce chapitre une bonne fois pour toutes.
