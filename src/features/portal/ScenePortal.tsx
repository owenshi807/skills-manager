import { ArrowUpRight, Orbit } from "lucide-react";
import { usePortal } from "./PortalContext";

export function ScenePortal({ sceneId, sceneName }: { sceneId: string | null; sceneName: string }) {
  const { enter } = usePortal();
  return <button
    type="button"
    data-testid="scene-portal"
    onClick={(event) => enter({ sceneId, sceneName }, event.currentTarget)}
    className="group mb-6 flex w-full items-center gap-4 rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-accent/40 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
  >
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-bg text-accent"><Orbit className="h-7 w-7" strokeWidth={1.3} /></span>
    <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-primary">进入玩具旷野 <span className="ml-2 text-[10px] font-normal tracking-widest text-muted">PORTAL</span></span><span className="mt-1 block text-[12px] leading-5 text-muted">去地图里把玩卡牌，打开角色装备袋，浏览你的 Skill 库。</span></span>
    <ArrowUpRight className="h-5 w-5 shrink-0 text-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
  </button>;
}
