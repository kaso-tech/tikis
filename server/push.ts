/**
 * Notifications push Expo (device-to-device).
 *
 * Si le package `expo-server-sdk` n'est pas installé, on bascule en mode no-op
 * (les in-app notifications Tikis restent fonctionnelles, seul le push distant
 * est désactivé). Le code n'importe le SDK qu'à l'init, pas au top-level, pour
 * ne pas crasher si la dep manque.
 *
 * Env : aucune obligatoire. La lib utilise l'API publique d'Expo (pas de clé).
 */

function logPush(level: "info" | "warn" | "error", message: string, cause?: unknown) {
  const output = cause === undefined ? [message] : [message, cause];
  console[level](...output);
}

type ExpoPushClient = {
  sendPushNotificationsAsync: (messages: Array<{
    to: string;
    title?: string;
    body?: string;
    sound?: "default" | null;
    data?: Record<string, unknown>;
    priority?: "default" | "normal" | "high";
    channelId?: string;
  }>) => Promise<Array<{ status: "ok" | "error"; data?: { status?: string; message?: string }; message?: string }>>;
};

let client: ExpoPushClient | null = null;
let initTried = false;

async function getClient(): Promise<ExpoPushClient | null> {
  if (client) return client;
  if (initTried) return null;
  initTried = true;
  try {
    const mod = (await import("expo-server-sdk")) as unknown as { Expo: new () => ExpoPushClient };
    client = new mod.Expo();
    logPush("info", "[push] expo-server-sdk chargé, push activé");
    return client;
  } catch (cause) {
    logPush("warn", "[push] expo-server-sdk indisponible, push désactivé", cause);
    return null;
  }
}

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channelId?: string;
  priority?: "default" | "normal" | "high";
};

function isExpoPushToken(token: string): boolean {
  return token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[") || /^[A-Za-z0-9_-]{20,}$/.test(token);
}

export async function sendPushToTokens(messages: PushMessage[]): Promise<{ sent: number; failed: number; errors: string[] }> {
  if (messages.length === 0) return { sent: 0, failed: 0, errors: [] };
  const expo = await getClient();
  if (!expo) {
    return { sent: 0, failed: messages.length, errors: ["expo-server-sdk indisponible"] };
  }
  const validMessages = messages.filter((m) => isExpoPushToken(m.to));
  if (validMessages.length === 0) {
    return { sent: 0, failed: messages.length, errors: ["Aucun token Expo valide"] };
  }
  try {
    const tickets = await expo.sendPushNotificationsAsync(
      validMessages.map((m) => ({
        to: m.to,
        title: m.title,
        body: m.body,
        sound: "default",
        data: m.data,
        priority: m.priority ?? "high",
        channelId: m.channelId,
      })),
    );
    const errors: string[] = [];
    let sent = 0;
    let failed = 0;
    for (const ticket of tickets) {
      if (ticket.status === "ok") {
        sent += 1;
      } else {
        failed += 1;
        errors.push(ticket.message ?? ticket.data?.message ?? "erreur inconnue");
      }
    }
    return { sent, failed, errors };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Erreur inconnue";
    logPush("error", "[push] sendPushNotificationsAsync failed", cause);
    return { sent: 0, failed: validMessages.length, errors: [message] };
  }
}
