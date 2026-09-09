import { useEffect, useRef, useState } from "react";
import { readGameInventory, readGameSkillDocument } from "./inventory-port";
import { mountToyWilds } from "./engine.js";
import sceneTemplate from "./scene.html?raw";
import "./GameShell.css";

export interface GameShellProps {
  sceneId: string | null;
  sceneName: string;
  onExit: () => void;
  onManageScene: (sceneId: string) => void;
}

/** This shell owns only its subtree. Providers, Router and workbench stay alive. */
export default function GameShell({ sceneId, sceneName, onExit, onManageScene }: GameShellProps) {
  const root = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const host = root.current;
    const surface = stage.current;
    if (!host || !surface) return;
    // This is a bundled, static template, never Skill text or a network response.
    surface.innerHTML = sceneTemplate;
    const canvas = surface.querySelector<HTMLCanvasElement>("#game");
    if (!canvas) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    try {
      const engine = mountToyWilds({ root: host, canvas, readInventory: readGameInventory, readDocument: readGameSkillDocument, onManageScene, sceneId, sceneName });
      cleanup = () => engine.dispose();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "当前窗口无法创建三维场景。";
      queueMicrotask(() => { if (!cancelled) setError(message); });
    }
    return () => {
      cancelled = true;
      cleanup?.();
      surface.replaceChildren();
    };
  }, [sceneId, sceneName, retry, onManageScene]);

  return (
    <section className="toy-wilds-root" data-testid="portal-game" ref={root} tabIndex={-1} aria-label={`${sceneName || "使用场景"} · 旷野预览`}>
      <div className="toy-wilds-portal-bar">
        <button type="button" className="toy-wilds-workbench-return" data-testid="portal-exit" onClick={onExit}>
          <span aria-hidden="true">←</span> 返回工作台
        </button>
        <span className="toy-wilds-scene-name">{sceneName || "使用场景"}<small>本地旷野预览</small></span>
      </div>
      <div className="toy-wilds-stage" ref={stage} />
      {error && (
        <div className="toy-wilds-error" role="alert">
          <span className="eyebrow">旷野暂时无法展开</span>
          <h2>你的工作台还在原处。</h2>
          <p>{error}</p>
          <button type="button" className="primary" onClick={() => { setError(null); setRetry(value => value + 1); }}>重新加载旷野</button>
          <button type="button" className="quiet" autoFocus onClick={onExit}>返回工作台</button>
        </div>
      )}
    </section>
  );
}
