import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { AppProvider } from "./context/AppContext";
import { ThemeProvider, useThemeContext } from "./context/ThemeContext";
import { HelpDialog } from "./components/HelpDialog";
import { CloseActionGuard } from "./components/CloseActionGuard";
import { FirstRunRestoreDialog } from "./components/FirstRunRestoreDialog";
import { Layout } from "./components/Layout";
import { Dashboard } from "./views/Dashboard";
import { MySkills } from "./views/MySkills";
import { WorkspaceView } from "./views/WorkspaceView";
import { CODING_WORKSPACE_CONFIG, LOBSTER_WORKSPACE_CONFIG } from "./views/workspaceConfigs";
import { InstallSkills } from "./views/InstallSkills";
import { Settings } from "./views/Settings";
import { ProjectDetail } from "./views/ProjectDetail";
import { Backup } from "./views/Backup";
import { CARD_MASTER_PRODUCT_SURFACE } from "./lib/productSurface";
import { Scenes } from "./views/Scenes";
import { SceneAutoClassifier } from "./components/SceneAutoClassifier";
import { AssistantConnections } from "./views/AssistantConnections";
import { PortalProvider, PORTAL_PATH, usePortal } from "./features/portal/PortalContext";
import { PortalSurface } from "./features/portal/PortalSurface";

function ThemedToaster() {
  const { resolvedTheme } = useThemeContext();
  return (
    <Toaster
      theme={resolvedTheme}
      position="bottom-right"
      toastOptions={{
        style: {
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text-primary)",
        },
      }}
    />
  );
}

function AppSurfaces() {
  const location = useLocation();
  const { active, entry } = usePortal();
  const coldPortal = location.pathname === PORTAL_PATH && !active;
  const background = active && entry ? entry.backgroundLocation : coldPortal ? { ...location, pathname: "/scenes", search: "", hash: "" } : location;
  return <>
    <div id="saas-surface" hidden={active} inert={active} aria-hidden={active || undefined} className="h-full w-full">
      <Routes location={background}>
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/my-skills" element={<MySkills />} />
              <Route path="/decks" element={<Navigate replace to="/scenes" />} />
              <Route path="/scenes" element={<Scenes />} />
              <Route path="/assistants" element={<AssistantConnections />} />
              <Route path="/global-workspace" element={<WorkspaceView config={CODING_WORKSPACE_CONFIG} />} />
              <Route path="/global-workspace/:agentKey" element={<WorkspaceView config={CODING_WORKSPACE_CONFIG} />} />
              <Route path="/lobster-workspace" element={<WorkspaceView config={LOBSTER_WORKSPACE_CONFIG} />} />
              <Route path="/lobster-workspace/:agentKey" element={<WorkspaceView config={LOBSTER_WORKSPACE_CONFIG} />} />
              <Route path="/install" element={<InstallSkills />} />
              <Route path="/backup" element={<Backup />} />
              <Route
                path="/project/:id"
                element={CARD_MASTER_PRODUCT_SURFACE.projects ? <ProjectDetail /> : <Navigate replace to="/my-skills" />}
              />
              <Route path="/settings" element={<Settings />} />
            </Route>

      </Routes>
      <HelpDialog />
      <FirstRunRestoreDialog />
    </div>
    <PortalSurface />
    {coldPortal && <Navigate replace to="/scenes" />}
    <CloseActionGuard />
  </>;
}

function App() {
  return (
    <ThemeProvider>
      <AppProvider>
        <SceneAutoClassifier />
        <BrowserRouter>
          <PortalProvider>
            <AppSurfaces />
          </PortalProvider>
        </BrowserRouter>
        <ThemedToaster />
      </AppProvider>
    </ThemeProvider>
  );
}

export default App;
