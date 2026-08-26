import { createContext, useContext, useMemo, useState } from "react";

type TikisNavigationState = {
  isDrawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
};

const TikisNavigationContext = createContext<TikisNavigationState | null>(null);

export function TikisNavigationProvider({ children }: { children: React.ReactNode }) {
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const value = useMemo(() => ({
    isDrawerOpen,
    openDrawer: () => setDrawerOpen(true),
    closeDrawer: () => setDrawerOpen(false),
    toggleDrawer: () => setDrawerOpen((value) => !value),
  }), [isDrawerOpen]);

  return <TikisNavigationContext.Provider value={value}>{children}</TikisNavigationContext.Provider>;
}

export function useTikisNavigation() {
  const context = useContext(TikisNavigationContext);
  if (!context) throw new Error("useTikisNavigation must be used within TikisNavigationProvider");
  return context;
}

