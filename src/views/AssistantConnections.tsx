import { useCallback, useEffect, useState } from "react";
import { CircleAlert, Clipboard, Link2, Loader2, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { writeText as clipboardWriteText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import { ToggleSwitch } from "../components/ToggleSwitch";
import { getErrorMessage } from "../lib/error";
import * as publishing from "../lib/skillPublishing";
import { Link } from "react-router-dom";

async function copy(value: string) {
  try { await clipboardWriteText(value); }
  catch { await navigator.clipboard.writeText(value); }
}

export function AssistantConnections() {
  const [control, setControl] = useState<publishing.McpControlStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState<"codex" | "claude" | null>(null);

  const refreshControl = useCallback(async () => {
    setControl(await publishing.getMcpControlStatus());
    setLoadError(null);
  }, []);

  useEffect(() => {
    void refreshControl().catch((error) => {
      const message = getErrorMessage(error, "无法加载助手连接");
      setLoadError(message); toast.error(message);
    }).finally(() => setLoading(false));
  }, [refreshControl]);

  const refresh = async () => {
    try { await refreshControl(); }
    catch (error) { const message = getErrorMessage(error, "无法刷新助手连接"); setLoadError(message); toast.error(message); }
  };
  const copyConfiguration = async (value: string, label: string) => {
    try { await copy(value); toast.success(`${label}已复制`); }
    catch (error) { toast.error(getErrorMessage(error, "无法复制配置")); }
  };
  const saveControl = async (enabled: boolean, writes: boolean) => {
    setSaving(true);
    try { setControl(await publishing.setMcpControlSettings(enabled, writes)); }
    catch (error) { toast.error(getErrorMessage(error, "无法保存 MCP 权限")); }
    finally { setSaving(false); }
  };
  const connect = async (client: "codex" | "claude") => {
    setConnecting(client);
    try {
      const result = await publishing.connectMcpClient(client);
      if (result.connected) toast.success(result.message);
      else toast.error(result.message);
    }
    catch (error) { toast.error(getErrorMessage(error, "无法连接助手")); }
    finally { setConnecting(null); }
  };

  if (loading) return <div className="app-page flex min-h-[280px] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-accent" /></div>;
  return <div className="app-page">
    <header className="app-page-header flex flex-wrap items-start justify-between gap-4"><div><h1 className="app-page-title">连接助手</h1><p className="app-page-subtitle">连接 AI 助手并设置访问权限，让对话使用同一个本机技能库。</p></div><button type="button" className="app-button-secondary" onClick={() => void refresh()}><RefreshCw className="h-4 w-4" />刷新</button></header>

    {loadError && <div className="app-panel flex items-start justify-between gap-3 border-red-500/30 bg-red-500/5 p-3.5"><div className="flex items-start gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-500" /><p className="text-[12px] text-red-600 dark:text-red-300">{loadError}</p></div><button type="button" className="scm-button-tertiary" onClick={() => void refresh()}>重试</button></div>}

    {!control?.available && <div className="app-panel flex items-start gap-3 border-amber-500/30 bg-amber-500/5 p-3.5"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /><div><p className="text-[13px] font-medium text-primary">MCP server 不可用</p><p className="mt-1 text-[12px] text-muted">当前构建未找到本机 server。打开或更新 Skill Card Manager 后重试；不会写入任何助手配置。</p></div></div>}

    <section className="app-panel p-4"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-[13px] font-semibold text-primary">本机 MCP 权限</h2><p className="mt-1 text-[12px] text-muted">库路径：{control?.library_path ?? "不可用"}</p></div><ShieldCheck className="h-5 w-5 text-accent" /></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="app-panel-muted flex items-center justify-between gap-3 p-3"><span><span className="block text-[12px] font-medium text-primary">启用助手访问</span><span className="mt-0.5 block text-[11px] text-muted">允许查询、阅读和组织共享库。</span></span><ToggleSwitch checked={control?.enabled ?? false} disabled={saving || !control} onChange={() => void saveControl(!(control?.enabled ?? false), control?.allow_file_writes ?? false)} /></label><label className="app-panel-muted flex items-center justify-between gap-3 p-3"><span><span className="block text-[12px] font-medium text-primary">允许文件发布</span><span className="mt-0.5 block text-[11px] text-muted">允许 Agent 通过 Manager 创建和更新 Skill。</span></span><ToggleSwitch checked={control?.allow_file_writes ?? false} disabled={saving || !control?.enabled} onChange={() => void saveControl(control?.enabled ?? false, !(control?.allow_file_writes ?? false))} /></label></div>{!control?.enabled && <p className="mt-3 text-[11px] text-amber-600 dark:text-amber-400">先启用助手访问，才能连接 Codex 或 Claude。</p>}</section>

    <section className="grid gap-4 lg:grid-cols-2"><div className="app-panel p-4"><div className="flex items-center justify-between"><h2 className="text-[13px] font-semibold text-primary">Codex</h2><button type="button" title={!control?.enabled ? "请先启用助手访问" : undefined} className="app-button-primary h-9" disabled={!control?.available || !control?.enabled || connecting !== null} onClick={() => void connect("codex")}>{connecting === "codex" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}连接 Codex</button></div><p className="mt-2 break-all rounded-lg bg-bg-secondary p-2.5 font-mono text-[11px] text-muted">{control?.codex_command ?? "MCP server 不可用"}</p><button type="button" className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-accent hover:text-accent-light" onClick={() => control && void copyConfiguration(control.codex_command, "Codex 命令")}><Clipboard className="h-3 w-3" />复制命令</button></div><div className="app-panel p-4"><div className="flex items-center justify-between"><h2 className="text-[13px] font-semibold text-primary">Claude</h2><button type="button" title={!control?.enabled ? "请先启用助手访问" : undefined} className="app-button-primary h-9" disabled={!control?.available || !control?.enabled || connecting !== null} onClick={() => void connect("claude")}>{connecting === "claude" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}连接 Claude</button></div><p className="mt-2 break-all rounded-lg bg-bg-secondary p-2.5 font-mono text-[11px] text-muted">{control?.claude_command ?? "MCP server 不可用"}</p><button type="button" className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-accent hover:text-accent-light" onClick={() => control && void copyConfiguration(control.claude_command, "Claude 命令")}><Clipboard className="h-3 w-3" />复制命令</button></div></section>

    <section className="app-panel p-4"><div className="flex items-center justify-between gap-3"><div><h2 className="text-[13px] font-semibold text-primary">Desktop 配置</h2><p className="mt-1 text-[11px] text-muted">适用于支持标准 MCP JSON 配置的桌面客户端。</p></div><button type="button" className="app-button-secondary h-8" onClick={() => control && void copyConfiguration(JSON.stringify(control.desktop_config, null, 2), "配置")}><Clipboard className="h-3.5 w-3.5" />复制 JSON</button></div><pre className="mt-3 overflow-x-auto rounded-lg bg-bg-secondary p-3 text-[11px] text-muted">{JSON.stringify(control?.desktop_config ?? {}, null, 2)}</pre></section>

    <p className="text-[12px] text-muted">在<Link to="/my-skills" className="mx-1 text-accent hover:underline">技能库</Link>查看版本选择、实际部署和更新记录。</p>
  </div>;
}
