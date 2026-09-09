import { Component, lazy, Suspense, useCallback, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useDragWindow } from "../../hooks/useDragWindow";
import { usePortal } from "./PortalContext";

const GameShell = lazy(() => import("../toy-wilds/GameShell"));

function PortalStatus({ failed, onExit }: { failed?: boolean; onExit: () => void }) {
  return <div className="flex h-full flex-col items-center justify-center gap-4 bg-[#eff4e9] px-8 text-center text-[#24372e]" role={failed ? "alert" : "status"}>
    <p className="text-xs tracking-[0.24em]">玩具旷野 · PORTAL</p>
    <h1 className="text-2xl font-semibold">{failed ? "旷野暂时没有打开" : "正在打开旷野…"}</h1>
    <p className="max-w-sm text-sm leading-6">{failed ? "场景加载失败。返回工作台后可以继续使用你的 Skill 库。" : "你的工作台已保留，随时可以回来。"}</p>
    <button autoFocus type="button" data-testid="portal-exit" onClick={onExit} className="rounded-full bg-[#263e32] px-5 py-2.5 text-sm text-white">返回工作台</button>
  </div>;
}

class GameBoundary extends Component<{ children: ReactNode; onExit: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <PortalStatus failed onExit={this.props.onExit} /> : this.props.children; }
}

export function PortalSurface() {
  const { active, entry, exit } = usePortal();
  const navigate = useNavigate();
  const manageScene = useCallback((sceneId: string) => {
    navigate(`/scenes?scene=${encodeURIComponent(sceneId)}`, { replace: true });
  }, [navigate]);
  const onDrag = useDragWindow();
  if (!active || !entry) return null;
  return <div className="absolute inset-0 z-[70] overflow-hidden" data-testid="portal-surface">
    <div onMouseDown={onDrag} className="absolute inset-x-0 top-0 z-[90] h-[28px]" aria-hidden="true" />
    <GameBoundary key={entry.id} onExit={exit}>
      <Suspense fallback={<PortalStatus onExit={exit} />}>
        <GameShell sceneId={entry.sceneId} sceneName={entry.sceneName} onExit={exit} onManageScene={manageScene} />
      </Suspense>
    </GameBoundary>
  </div>;
}
