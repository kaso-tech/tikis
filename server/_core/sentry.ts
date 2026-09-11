function logServer(level: "info" | "warn" | "error", scope: string, message: string, context?: unknown) {
  const output = context === undefined ? [`${scope} ${message}`] : [`${scope} ${message}`, context];
  console[level](...output);
}

const SENTRY_DSN = process.env.SENTRY_DSN;
const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";
const SENTRY_RELEASE = process.env.SENTRY_RELEASE ?? "tikis@unknown";

let initialized = false;
let captureException: ((error: unknown, context?: Record<string, unknown>) => void) | null = null;
let captureMessage: ((message: string, level?: "info" | "warning" | "error", context?: Record<string, unknown>) => void) | null = null;

type SentryModule = {
  init: (options: {
    dsn: string;
    environment: string;
    release: string;
    tracesSampleRate?: number;
    maxBreadcrumbs?: number;
    registerEsmLoaderHooks?: boolean;
  }) => void;
  captureException: (error: unknown) => string;
  captureMessage: (message: string, level?: { level: string }) => string;
  setContext: (key: string, value: Record<string, unknown>) => void;
};

export async function initSentry() {
  if (initialized) return;
  initialized = true;
  if (!SENTRY_DSN) {
    logServer("info", "[sentry]", "SENTRY_DSN absent, capture désactivée");
    return;
  }
  let sentryModule: SentryModule;
  try {
    sentryModule = (await import("@sentry/node")) as unknown as SentryModule;
    // `registerEsmLoaderHooks: false` désactive l'auto-instrumentation ESM d'import-in-the-middle : sous tsx
    // (dev:server, Node 22+), ce hook entre en conflit avec le loader de tsx et provoque un
    // ERR_INVALID_RETURN_PROPERTY_VALUE ("source" du load hook indéfini) sur le premier import() dynamique
    // qui suit — cassant en cascade tous les autres (sessions, loyalty, analytics, géographie…). On n'utilise
    // ici que la capture manuelle (captureException/captureMessage), donc l'instrumentation auto est inutile.
    sentryModule.init({ dsn: SENTRY_DSN, environment: SENTRY_ENVIRONMENT, release: SENTRY_RELEASE, tracesSampleRate: 0.1, maxBreadcrumbs: 50, registerEsmLoaderHooks: false });
    captureException = (error, context) => {
      if (context) sentryModule.setContext("extra", context);
      sentryModule.captureException(error);
    };
    captureMessage = (message, level, context) => {
      if (context) sentryModule.setContext("extra", context);
      sentryModule.captureMessage(message, { level: level === "error" ? "error" : level === "warning" ? "warning" : "info" });
    };
    logServer("info", "[sentry]", `Capture initialisée (env=${SENTRY_ENVIRONMENT}, release=${SENTRY_RELEASE})`);
  } catch (cause) {
    logServer("warn", "[sentry]", "Module @sentry/node indisponible, capture désactivée", cause);
  }
}

export function reportException(error: unknown, context?: Record<string, unknown>) {
  if (captureException) captureException(error, context);
  else logServer("error", "[sentry:fallback]", error instanceof Error ? error.message : String(error), context);
}

export function reportMessage(message: string, level: "info" | "warning" | "error" = "info", context?: Record<string, unknown>) {
  if (captureMessage) captureMessage(message, level, context);
  else logServer(level === "warning" ? "warn" : level, "[sentry:fallback]", message, context);
}
