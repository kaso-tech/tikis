import { createContext, useContext, useMemo, useState } from "react";

type TikisseNavigationState = {
  isDrawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
};

const TikisseNavigationContext = createContext<TikisseNavigationState | null>(null);

export function TikisseNavigationProvider({ children }: { children: React.ReactNode }) {
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const value = useMemo(() => ({
    isDrawerOpen,
    openDrawer: () => setDrawerOpen(true),
    closeDrawer: () => setDrawerOpen(false),
    toggleDrawer: () => setDrawerOpen((value) => !value),
  }), [isDrawerOpen]);

  return <TikisseNavigationContext.Provider value={value}>{children}</TikisseNavigationContext.Provider>;
}

export function useTikisseNavigation() {
  const context = useContext(TikisseNavigationContext);
  if (!context) throw new Error("useTikisseNavigation must be used within TikisseNavigationProvider");
  return context;
}

