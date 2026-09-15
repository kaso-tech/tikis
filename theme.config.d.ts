export const themeColors: {
  primary: { light: string; dark: string };
  background: { light: string; dark: string };
  surface: { light: string; dark: string };
  foreground: { light: string; dark: string };
  muted: { light: string; dark: string };
  border: { light: string; dark: string };
  success: { light: string; dark: string };
  warning: { light: string; dark: string };
  error: { light: string; dark: string };
  // À tenir synchronisé avec theme.config.js : ces deux jetons y ont été ajoutés sans l'être ici, et
  // tout `theme.trendUp` / `theme.trendDown` échouait donc à la compilation (wallet, gains, accueil).
  trendUp: { light: string; dark: string };
  trendDown: { light: string; dark: string };
};

declare const themeConfig: {
  themeColors: typeof themeColors;
};

export default themeConfig;
