import { useCallback, useEffect, useRef, useState } from "react";
import { Image, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
  type WithTimingConfig,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop, Circle } from "react-native-svg";
import { useAppReady } from "@/lib/app-ready";

/**
 * Écran de démarrage animé (maquette validée le 29/09/2026).
 *
 * Il prend le relais de l'écran natif d'expo-splash-screen sans saut : même fond uni
 * (SPLASH_BACKGROUND, repris dans app.config.ts), même logo, même taille, même position. Puis :
 * halo chaud, lignes de vitesse, impulsion du scooter, nom de la marque, signature. Il s'efface quand
 * l'application est prête (lib/app-ready.ts), jamais avant la fin de la séquence, jamais plus tard
 * qu'un plafond de sécurité. « Réduire les animations » : un simple fondu.
 */
export const SPLASH_BACKGROUND = "#401000";
export const SPLASH_LOGO_SIZE = 128;

const AMBER = "#F8A008";
const AMBER_SOFT = "#F6B83C";
const CREAM = "#FFF7ED";
const WORD = "Tikisse";

// Durées (ms). Voir la maquette : la séquence complète dure 1,9 s avant la sortie.
const SEQUENCE_END = 1900;
const REDUCED_SEQUENCE_END = 900;
// L'application n'a jamais signalé qu'elle était prête (lien profond vers un écran qui ne le fait
// pas, erreur au démarrage) : on sort quand même, l'écran en dessous a ses propres états de chargement.
const MAX_WAIT = 5000;
const STAGE_LIFT = -44;
const LETTER_STAGGER = 45;
const LETTER_DURATION = 480;
const WORD_DURATION = LETTER_DURATION + (WORD.length - 1) * LETTER_STAGGER;

const easeOut = Easing.bezier(0.22, 1, 0.36, 1);

export function AnimatedSplash() {
  const reduceMotion = useReducedMotion();
  const appReady = useAppReady();
  const [sequenceDone, setSequenceDone] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [visible, setVisible] = useState(true);
  const nativeHidden = useRef(false);
  const exiting = useRef(false);

  const glow = useSharedValue(0);
  const speed = useSharedValue(0);
  const kick = useSharedValue(0);
  const ring = useSharedValue(0);
  const halo = useSharedValue(0);
  const stage = useSharedValue(0);
  const word = useSharedValue(0);
  const rule = useSharedValue(0);
  const tagline = useSharedValue(0);
  const loader = useSharedValue(0);
  const loaderSweep = useSharedValue(0);
  const exit = useSharedValue(0);

  // L'écran natif ne disparaît qu'une fois ce composant dessiné : c'est lui qui prend sa place.
  const onLayout = useCallback((_event: LayoutChangeEvent) => {
    if (nativeHidden.current) return;
    nativeHidden.current = true;
    void SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    const t = (value: number, duration: number, delay = 0, easing: WithTimingConfig["easing"] = easeOut) => withDelay(delay, withTiming(value, { duration, easing }));
    if (reduceMotion) {
      glow.set(t(1, 300));
      stage.set(1);
      word.set(t(1, 300, 0, Easing.linear));
      rule.set(1);
      tagline.set(t(1, 300));
    } else {
      glow.set(t(1, 700, 150));
      speed.set(t(1, 640, 200, Easing.linear));
      kick.set(t(1, 460, 560, Easing.inOut(Easing.ease)));
      halo.set(t(1, 900, 640));
      ring.set(t(1, 700, 700));
      stage.set(t(1, 620, 900));
      word.set(t(1, WORD_DURATION, 980, Easing.linear));
      rule.set(t(1, 380, 1300));
      tagline.set(t(1, 520, 1420));
    }
    const sequence = setTimeout(() => setSequenceDone(true), reduceMotion ? REDUCED_SEQUENCE_END : SEQUENCE_END);
    const safety = setTimeout(() => setTimedOut(true), MAX_WAIT);
    return () => { clearTimeout(sequence); clearTimeout(safety); };
  }, [reduceMotion, glow, speed, kick, halo, ring, stage, word, rule, tagline]);

  const ready = appReady || timedOut;

  // Séquence terminée mais application pas encore prête : fine barre de chargement.
  useEffect(() => {
    if (!sequenceDone || ready) return;
    loader.set(withTiming(1, { duration: 300, easing: easeOut }));
    loaderSweep.set(withRepeat(withTiming(1, { duration: 1100, easing: Easing.bezier(0.6, 0, 0.4, 1) }), -1, false));
  }, [sequenceDone, ready, loader, loaderSweep]);

  useEffect(() => {
    if (!sequenceDone || !ready || exiting.current) return;
    exiting.current = true;
    loader.set(withTiming(0, { duration: 160 }));
    const finish = () => setVisible(false);
    exit.set(withDelay(reduceMotion ? 0 : 60, withTiming(1, { duration: reduceMotion ? 250 : 420, easing: Easing.in(Easing.ease) }, (finished) => {
      if (finished) runOnJS(finish)();
    })));
  }, [sequenceDone, ready, reduceMotion, exit, loader]);

  const rootStyle = useAnimatedStyle(() => ({ opacity: 1 - exit.value }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));
  const stageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: stage.value * STAGE_LIFT - (reduceMotion ? 0 : exit.value * 6) },
      { scale: reduceMotion ? 1 : 1 + exit.value * 0.06 },
    ],
  }));
  const logoStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(kick.value, [0, 0.3, 0.65, 1], [0, -7, 5, 0]) },
      { scale: interpolate(kick.value, [0, 0.3, 0.65, 1], [1, 0.97, 1.06, 1]) },
      { rotate: `${interpolate(kick.value, [0, 0.3, 0.65, 1], [0, -2, 1, 0])}deg` },
    ],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: ring.value === 0 ? 0 : interpolate(ring.value, [0, 1], [0.9, 0]),
    transform: [{ scale: interpolate(ring.value, [0, 1], [0.92, 1.55]) }],
  }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: interpolate(halo.value, [0, 0.35, 1], [0, 1, 0.55]),
    transform: [{ scale: interpolate(halo.value, [0, 0.35, 1], [0.6, 1, 1.1]) }],
  }));
  const ruleStyle = useAnimatedStyle(() => ({ width: rule.value * 28 }));
  const taglineStyle = useAnimatedStyle(() => ({
    opacity: tagline.value * 0.9,
    transform: [{ translateY: (1 - tagline.value) * 6 }],
  }));
  const loaderStyle = useAnimatedStyle(() => ({ opacity: loader.value }));
  const loaderBarStyle = useAnimatedStyle(() => ({ transform: [{ translateX: interpolate(loaderSweep.value, [0, 1], [-32, 92]) }] }));

  if (!visible) return null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, rootStyle]} onLayout={onLayout} pointerEvents="none" accessibilityLabel="Chargement de Tikisse">
      <StatusBar style="light" />
      <Animated.View style={[StyleSheet.absoluteFill, glowStyle]}>
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="splash-glow" cx="50%" cy="43%" rx="75%" ry="60%" fx="50%" fy="43%">
              <Stop offset="0" stopColor="#7A3000" />
              <Stop offset="0.42" stopColor="#4C1604" />
              <Stop offset="1" stopColor="#240900" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#splash-glow)" />
        </Svg>
      </Animated.View>

      <Animated.View style={[styles.stage, stageStyle]}>
        <View style={styles.logoBox}>
          <Animated.View style={[styles.halo, haloStyle]}>
            <Svg width={HALO_SIZE} height={HALO_SIZE}>
              <Defs>
                <RadialGradient id="splash-halo" cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor={AMBER} stopOpacity={0.38} />
                  <Stop offset="0.65" stopColor={AMBER} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Circle cx={HALO_SIZE / 2} cy={HALO_SIZE / 2} r={HALO_SIZE / 2} fill="url(#splash-halo)" />
            </Svg>
          </Animated.View>
          <Animated.View style={[styles.ring, ringStyle]} />
          {reduceMotion ? null : (
            <View style={styles.speed}>
              {SPEED_LINES.map((width, index) => <SpeedLine key={index} index={index} width={width} progress={speed} />)}
            </View>
          )}
          <Animated.View style={logoStyle}>
            <View style={styles.logoShadow} />
            <Image source={require("../../assets/images/icon.png")} style={styles.logo} accessibilityLabel="Logo Tikisse" />
          </Animated.View>
        </View>

        <View style={styles.wordmark}>
          <View style={styles.word} accessible accessibilityLabel={WORD}>
            {WORD.split("").map((letter, index) => <Letter key={index} letter={letter} index={index} progress={word} reduceMotion={reduceMotion} />)}
          </View>
          <Animated.View style={[styles.rule, ruleStyle]} />
          <Animated.Text style={[styles.tagline, taglineStyle]}>PLATEFORME DE LIVRAISON</Animated.Text>
        </View>
      </Animated.View>

      <Animated.View style={[styles.loader, loaderStyle]}>
        <Animated.View style={[styles.loaderBar, loaderBarStyle]} />
      </Animated.View>
    </Animated.View>
  );
}

const HALO_SIZE = SPLASH_LOGO_SIZE + 80;
const SPEED_LINES = [46, 70, 38];
// Chaque ligne démarre 60 ms après la précédente, sur 520 ms : 640 ms au total (durée de `speed`).
const SPEED_TOTAL = 640;
const SPEED_LINE = 520;

function SpeedLine({ index, width, progress }: { index: number; width: number; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const local = interpolate(progress.value * SPEED_TOTAL, [index * 60, index * 60 + SPEED_LINE], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: interpolate(local, [0, 0.6, 1], [0, 1, 0]),
      transform: [
        { translateX: interpolate(local, [0, 0.6, 1], [-90, -10, 18]) },
        { scaleX: interpolate(local, [0, 0.6, 1], [0.4, 1, 0.6]) },
      ],
    };
  });
  return (
    <Animated.View style={[{ width, height: 5, alignSelf: "flex-end" }, style]}>
      <Svg width={width} height={5}>
        <Defs>
          <LinearGradient id={`splash-speed-${index}`} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={AMBER} stopOpacity={0} />
            <Stop offset="1" stopColor={AMBER} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={width} height={5} rx={2.5} fill={`url(#splash-speed-${index})`} />
      </Svg>
    </Animated.View>
  );
}

function Letter({ letter, index, progress, reduceMotion }: { letter: string; index: number; progress: SharedValue<number>; reduceMotion: boolean }) {
  const style = useAnimatedStyle(() => {
    if (reduceMotion) return { opacity: progress.value };
    const local = interpolate(progress.value * WORD_DURATION, [index * LETTER_STAGGER, index * LETTER_STAGGER + LETTER_DURATION], [0, 1], Extrapolation.CLAMP);
    // Légère sortie en « rebond » (easeOutBack), comme dans la maquette.
    const c1 = 1.70158;
    const eased = 1 + (c1 + 1) * Math.pow(local - 1, 3) + c1 * Math.pow(local - 1, 2);
    return { opacity: local, transform: [{ translateY: (1 - eased) * 16 }] };
  });
  return <Animated.Text style={[styles.letter, style]}>{letter}</Animated.Text>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: SPLASH_BACKGROUND, alignItems: "center", justifyContent: "center", zIndex: 1000, elevation: 1000 },
  stage: { alignItems: "center" },
  logoBox: { width: SPLASH_LOGO_SIZE, height: SPLASH_LOGO_SIZE, alignItems: "center", justifyContent: "center" },
  halo: { position: "absolute", width: HALO_SIZE, height: HALO_SIZE, left: -40, top: -40 },
  ring: { position: "absolute", top: 10, left: 10, right: 10, bottom: 10, borderRadius: 30, borderWidth: 2, borderColor: AMBER },
  speed: { position: "absolute", right: SPLASH_LOGO_SIZE - 8, top: SPLASH_LOGO_SIZE / 2 - 16, gap: 9 },
  logoShadow: {
    position: "absolute", top: 10, left: 10, right: 10, bottom: 10, borderRadius: 26, backgroundColor: "#481300",
    shadowColor: "#1A0702", shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 16 }, elevation: 14,
  },
  logo: { width: SPLASH_LOGO_SIZE, height: SPLASH_LOGO_SIZE },
  wordmark: { position: "absolute", top: SPLASH_LOGO_SIZE + 22, width: 280, alignItems: "center" },
  word: { flexDirection: "row" },
  letter: { color: CREAM, fontSize: 36, fontWeight: "800", letterSpacing: -0.7 },
  rule: { height: 2, borderRadius: 1, backgroundColor: AMBER, marginTop: 14, marginBottom: 12 },
  tagline: { color: AMBER_SOFT, fontSize: 10.5, fontWeight: "800", letterSpacing: 2.5 },
  loader: { position: "absolute", bottom: 64, width: 92, height: 3, borderRadius: 2, backgroundColor: "rgba(251,243,230,0.12)", overflow: "hidden" },
  loaderBar: { width: 32, height: 3, borderRadius: 2, backgroundColor: AMBER },
});
