type ExpoPushClient = {
  sendPushNotificationsAsync: (messages: Array<{
    to: string;
    title?: string;
    body?: string;
    sound?: "default" | null;
    data?: Record<string, unknown>;
    priority?: "default" | "normal" | "high";
    channelId?: string;
  }>) => Promise<ExpoPushTicket[]>;
};

type ExpoPushTicket = {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
  data?: { status?: string; message?: string; error?: string };
};

let client: ExpoPushClient | null = null;
let initTried = false;

function logPush(level: "info" | "warn" | "error", message: string, cause?: unknown) {
  const output = cause === undefined ? [message] : [message, cause];
  console[level](...output);
}

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

export type PushSendResult = {
  sent: number;
  failed: number;
  errors: string[];
  invalidTokens: string[];
};

function isExpoPushToken(token: string): boolean {
  return token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[");
}

const chunksOf = <T,>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
};

export async function sendPushToTokens(messages: PushMessage[]): Promise<PushSendResult> {
  if (messages.length === 0) return { sent: 0, failed: 0, errors: [], invalidTokens: [] };
  const expo = await getClient();
  if (!expo) return { sent: 0, failed: messages.length, errors: ["expo-server-sdk indisponible"], invalidTokens: [] };

  const validMessages = messages.filter((message) => isExpoPushToken(message.to));
  const invalidInputCount = messages.length - validMessages.length;
  if (validMessages.length === 0) {
    return { sent: 0, failed: messages.length, errors: ["Aucun token Expo valide"], invalidTokens: messages.map((message) => message.to) };
  }

  let sent = 0;
  let failed = invalidInputCount;
  const errors: string[] = invalidInputCount > 0 ? [`${invalidInputCount} token(s) ignoré(s) car non-Expo`] : [];
  const invalidTokens: string[] = messages.filter((message) => !isExpoPushToken(message.to)).map((message) => message.to);

  for (const batch of chunksOf(validMessages, 100)) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(batch.map((message) => ({
        to: message.to,
        title: message.title,
        body: message.body,
        sound: "default",
        data: message.data,
        priority: message.priority ?? "high",
        channelId: message.channelId,
      })));
      for (let index = 0; index < tickets.length; index += 1) {
        const ticket = tickets[index]!;
        if (ticket.status === "ok") {
          sent += 1;
          continue;
        }
        failed += 1;
        const code = ticket.details?.error ?? ticket.data?.error;
        const detail = ticket.message ?? ticket.data?.message ?? code ?? "erreur inconnue";
        errors.push(code ? `${code}: ${detail}` : detail);
        if (code === "DeviceNotRegistered" || code === "InvalidCredentials") invalidTokens.push(batch[index]!.to);
      }
    } catch (cause) {
      failed += batch.length;
      const message = cause instanceof Error ? cause.message : "Erreur inconnue";
      errors.push(message);
      logPush("error", "[push] Envoi Expo impossible", cause);
    }
  }

  return { sent, failed, errors, invalidTokens };
}
