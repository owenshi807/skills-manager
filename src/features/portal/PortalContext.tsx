import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, type Location } from "react-router-dom";

export const PORTAL_PATH = "/play/toy-wilds";

interface PortalScene { sceneId: string | null; sceneName: string }
interface PortalEntry extends PortalScene {
  id: string;
  backgroundLocation: Location;
  trigger: HTMLElement | null;
  scroll: Array<{ element: HTMLElement; top: number; left: number }>;
}
interface PortalContextValue {
  active: boolean;
  entry: PortalEntry | null;
  enter: (scene: PortalScene, trigger?: HTMLElement) => void;
  exit: () => void;
}

const PortalContext = createContext<PortalContextValue | null>(null);

export function PortalProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [entry, setEntry] = useState<PortalEntry | null>(null);
  const previousActive = useRef(false);
  const active = !!entry && location.pathname === PORTAL_PATH && location.state?.portalEntry === entry.id;

  const enter = useCallback((scene: PortalScene, trigger?: HTMLElement) => {
    if (active || location.pathname === PORTAL_PATH) return;
    const id = crypto.randomUUID();
    const focused = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setEntry({
      ...scene, id, backgroundLocation: location, trigger: focused,
      scroll: [...document.querySelectorAll<HTMLElement>("#saas-surface [data-portal-scroll]")]
        .map((element) => ({ element, top: element.scrollTop, left: element.scrollLeft })),
    });
    focused?.blur();
    navigate(PORTAL_PATH, { state: { portalEntry: id } });
  }, [active, location, navigate]);

  const exit = useCallback(() => {
    // Only an in-memory entry created by this provider is allowed to go Back.
    if (active) navigate(-1);
    else navigate("/scenes", { replace: true });
  }, [active, navigate]);

  useLayoutEffect(() => {
    if (previousActive.current && !active && entry) {
      const background = entry.backgroundLocation;
      if (location.key === background.key) {
        for (const { element, top, left } of entry.scroll) {
          if (element.isConnected) element.scrollTo({ top, left, behavior: "instant" });
        }
        if (entry.trigger?.isConnected) entry.trigger.focus({ preventScroll: true });
      }
      // Forget a closed session: browser Forward must not reopen a game automatically.
      // Router POP is external history state; expire the entry before the next paint.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntry(null);
    }
    previousActive.current = active;
  }, [active, entry, location.key]);

  return <PortalContext.Provider value={{ active, entry, enter, exit }}>{children}</PortalContext.Provider>;
}

// Shared provider/hook module follows the existing app context convention.
// eslint-disable-next-line react-refresh/only-export-components
export function usePortal() {
  const value = useContext(PortalContext);
  if (!value) throw new Error("PortalProvider is missing");
  return value;
}
