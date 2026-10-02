/**
 * LigdiCash — paiement Mobile Money sans redirection (« payin straight »).
 *
 * Formats repris de la bibliothèque officielle (github.com/Ligdicash/ligdicash-php) et de la documentation
 * (developers.ligdicash.com/api-paiement/payin-sans-redirect) :
 *  - création : POST {base}straight/checkout-invoice/create, en-têtes `Apikey` et `Authorization: Bearer` ;
 *    corps `{ commande: { invoice, store, actions, custom_data } }`, numéro du client dans `invoice.customer`
 *    (format 226XXXXXXXX, sans « + »), code de l'opérateur dans `invoice.otp` (vide s'il n'y en a pas) ;
 *    réponse `{ response_code: "00", token, response_text, description }` quand la demande est acceptée ;
 *  - vérification : GET {base}redirect/checkout-invoice/confirm/?invoiceToken={token} ; `status` vaut
 *    `completed` (payé), `pending` (en cours) ou autre chose (échec).
 *
 * Seule la vérification fait foi : ni la réponse à la création (« en cours de traitement »), ni le rappel
 * envoyé par LigdiCash ne suffisent à créditer un Wallet.
 */

export type LigdicashMode = "sandbox" | "live";

export type LigdicashConfig = {
  apiKey: string | null;
  authToken: string | null;
  mode: LigdicashMode;
  baseUrl: string;
  /** Adresse publique du serveur, pour l'URL de rappel. */
  publicApiUrl: string;
};

export function readLigdicashConfig(env: Record<string, string | undefined> = process.env): LigdicashConfig {
  const mode: LigdicashMode = env.LIGDICASH_MODE === "live" ? "live" : "sandbox";
  return {
    apiKey: env.LIGDICASH_API_KEY?.trim() || null,
    authToken: env.LIGDICASH_AUTH_TOKEN?.trim() || null,
    mode,
    baseUrl: env.LIGDICASH_BASE_URL?.trim() || (mode === "live" ? "https://app.ligdicash.com/pay/v01/" : "https://test.ligdicash.com/pay/v01/"),
    publicApiUrl: (env.TIKISSE_PUBLIC_API_URL ?? env.EXPO_PUBLIC_API_BASE_URL ?? "https://api.tikisse.com").replace(/\/$/, ""),
  };
}

export function isLigdicashConfigured(config: LigdicashConfig) {
  return Boolean(config.apiKey && config.authToken);
}

export class LigdicashError extends Error {
  constructor(message: string, readonly responseCode?: string) {
    super(message);
    this.name = "LigdicashError";
  }
}

type LigdicashResponse = Record<string, unknown> & {
  response_code?: unknown;
  response_text?: unknown;
  description?: unknown;
  token?: unknown;
  status?: unknown;
  amount?: unknown;
  montant?: unknown;
  operator_name?: unknown;
  transaction_id?: unknown;
};

async function call(config: LigdicashConfig, method: "GET" | "POST", path: string, body?: unknown): Promise<LigdicashResponse> {
  if (!isLigdicashConfigured(config)) throw new LigdicashError("Le paiement Mobile Money n'est pas encore configuré. Réessayez plus tard.");
  const response = await fetch(`${config.baseUrl.replace(/\/?$/, "/")}${path}`, {
    method,
    headers: {
      Apikey: config.apiKey!,
      Authorization: `Bearer ${config.authToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text().catch(() => "");
  let data: LigdicashResponse = {};
  try { data = text ? JSON.parse(text) as LigdicashResponse : {}; } catch { data = {}; }
  if (!response.ok) {
    console.error(`[ligdicash] ${method} ${path.split("?")[0]} → HTTP ${response.status} : ${text.slice(0, 300)}`);
    throw new LigdicashError("LigdiCash est momentanément indisponible. Réessayez dans un instant.");
  }
  return data;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

/** Message lisible d'une demande refusée (`response_code` différent de « 00 »). */
function refusalMessage(data: LigdicashResponse) {
  const detail = text(data.description) || text(data.response_text);
  return detail ? `Paiement refusé par LigdiCash : ${detail}` : "Le paiement a été refusé par LigdiCash.";
}

export type LigdicashPayinRequest = {
  transactionId: string;
  amount: number;
  /** Numéro au format E.164 (+226…) ; envoyé sans « + ». */
  phone: string;
  /** Code donné par l'opérateur (Orange) ; vide quand le client valide sur son téléphone (Moov). */
  otp: string;
  description: string;
};

export function ligdicashPayinBody(config: LigdicashConfig, input: LigdicashPayinRequest) {
  const customer = input.phone.replace(/\D/g, "");
  return {
    commande: {
      invoice: {
        items: [{ name: "Rechargement Wallet Tikisse", description: input.description, quantity: 1, unit_price: input.amount, total_price: input.amount }],
        total_amount: input.amount,
        devise: "XOF",
        description: input.description,
        customer,
        customer_firstname: "",
        customer_lastname: "",
        customer_email: "",
        external_id: input.transactionId,
        otp: input.otp,
      },
      store: { name: "Tikisse", website_url: "https://tikisse.com" },
      actions: {
        cancel_url: "",
        return_url: "",
        // L'identifiant de la transaction voyage dans l'adresse : le rappel retrouve la transaction sans
        // dépendre du format de son corps, puis vérifie le statut auprès de LigdiCash.
        callback_url: `${config.publicApiUrl}/api/webhooks/ligdicash?transaction=${encodeURIComponent(input.transactionId)}`,
      },
      custom_data: { transaction_id: input.transactionId },
    },
  };
}

/** Envoie la demande de paiement ; renvoie le jeton LigdiCash de la transaction. */
export async function createLigdicashPayin(input: LigdicashPayinRequest, config = readLigdicashConfig()): Promise<string> {
  const data = await call(config, "POST", "straight/checkout-invoice/create", ligdicashPayinBody(config, input));
  if (text(data.response_code) !== "00") throw new LigdicashError(refusalMessage(data), text(data.response_code));
  const token = text(data.token);
  if (!token) throw new LigdicashError("LigdiCash n'a pas renvoyé de référence pour ce paiement.");
  return token;
}

export type LigdicashPayinStatus = { status: "succeeded" | "pending" | "failed"; amount: number | null; operatorTransactionId: string | null };

export function ligdicashStatus(value: unknown): LigdicashPayinStatus["status"] {
  const status = text(value).toLowerCase();
  if (status === "completed") return "succeeded";
  if (status === "pending" || status === "") return "pending";
  return "failed";
}

/** Statut d'une transaction, demandé à LigdiCash — la seule source qui fait foi. */
export async function getLigdicashPayinStatus(token: string, config = readLigdicashConfig()): Promise<LigdicashPayinStatus> {
  const data = await call(config, "GET", `redirect/checkout-invoice/confirm/?invoiceToken=${encodeURIComponent(token)}`);
  // Une vérification refusée (jeton inconnu, panne) ne dit rien du paiement : on reste « en cours ».
  if (text(data.response_code) !== "00") return { status: "pending", amount: null, operatorTransactionId: null };
  const amount = Number(data.amount ?? data.montant);
  return {
    status: ligdicashStatus(data.status),
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    operatorTransactionId: text(data.transaction_id) || null,
  };
}
