import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `subscribeToWalletChannel` doit partager un seul canal Supabase par `supabaseUserId` entre tous
// les abonnés (comme `subscribeToDeliveryChannel` le fait déjà pour les livraisons) et ne le
// fermer que lorsque plus personne n'écoute — sans mock, ce test exigerait un vrai projet Supabase.
const channelMock = vi.hoisted(() => {
  const on = vi.fn();
  const subscribe = vi.fn();
  const unsubscribe = vi.fn();
  const channel = { on, subscribe, unsubscribe };
  on.mockReturnValue(channel);
  subscribe.mockReturnValue(channel);
  return { channel, on, subscribe, unsubscribe };
});

const createClientMock = vi.hoisted(() => vi.fn(() => ({ channel: vi.fn(() => channelMock.channel) })));

vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  vi.resetModules();
  channelMock.on.mockClear();
  channelMock.subscribe.mockClear();
  channelMock.unsubscribe.mockClear();
  createClientMock.mockClear();
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("canal Realtime du Wallet", () => {
  it("n'ouvre rien quand Supabase n'est pas configuré côté client", async () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    const { subscribeToWalletChannel } = await import("../lib/supabase-tracking");
    const listener = vi.fn();
    const unsubscribe = subscribeToWalletChannel("user-123", listener);
    expect(createClientMock).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("partage un seul canal entre deux abonnés du même utilisateur, et ne le ferme qu'au dernier départ", async () => {
    const { subscribeToWalletChannel } = await import("../lib/supabase-tracking");
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeToWalletChannel("user-123", first);
    const unsubscribeSecond = subscribeToWalletChannel("user-123", second);

    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(channelMock.subscribe).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    expect(channelMock.unsubscribe).not.toHaveBeenCalled();

    unsubscribeSecond();
    expect(channelMock.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("relaie l'événement 'changed' du canal à tous les abonnés actifs", async () => {
    const { subscribeToWalletChannel } = await import("../lib/supabase-tracking");
    const listener = vi.fn();
    subscribeToWalletChannel("user-456", listener);

    const call = channelMock.on.mock.calls.find(([, filter]) => filter.event === "changed");
    const handler = call?.[2];
    expect(handler).toBeTypeOf("function");
    handler?.({ payload: { at: new Date().toISOString() } });

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
