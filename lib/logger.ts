import { Platform } from "react-native";

const isDev = __DEV__;

type LogMeta = Record<string, unknown>;

function formatMeta(meta?: LogMeta | unknown) {
  if (!meta) return "";
  if (meta instanceof Error) return ` ${meta.stack ?? meta.message}`;
  if (typeof meta === "object") {
    try {
      return ` ${JSON.stringify(meta, errorCircularReplacer)}`;
    } catch {
      return " [objet non sérialisable]";
    }
  }
  return ` ${String(meta)}`;
}

function errorCircularReplacer(_key: string, value: unknown) {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function emit(level: "info" | "warn" | "error", scope: string, message: string, meta?: LogMeta | unknown) {
  const line = `[${level.toUpperCase()}] [${scope}] ${message}${formatMeta(meta)}`;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
  if (!isDev && level === "error" && Platform.OS === "web") {
    const w = typeof window !== "undefined" ? window : null;
    if (w && typeof (w as { Sentry?: { captureException: (e: Error) => void } }).Sentry?.captureException === "function") {
      (w as { Sentry: { captureException: (e: Error) => void } }).Sentry.captureException(meta instanceof Error ? meta : new Error(message));
    }
  }
}

export const logger = {
  info: (scope: string, message: string, meta?: LogMeta | unknown) => emit("info", scope, message, meta),
  warn: (scope: string, message: string, meta?: LogMeta | unknown) => emit("warn", scope, message, meta),
  error: (scope: string, message: string, meta?: LogMeta | unknown) => emit("error", scope, message, meta),
};
