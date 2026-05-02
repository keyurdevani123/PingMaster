/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "../firebase";
import { fetchSessionBootstrap, setApiWorkspaceId } from "../api";

// This context holds the current user so any component can access it
const AuthContext = createContext(null);

function getWorkspaceStorageKey(userId) {
  return `pingmaster:workspace:${userId}`;
}

function getBootstrapStorageKey(userId) {
  return `pingmaster:bootstrap:${userId}`;
}

function buildFallbackWorkspace(firebaseUser) {
  const suffix = String(firebaseUser?.uid || "default")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24) || "default";

  return {
    id: `ws_${suffix}`,
    slug: `workspace-${suffix.slice(0, 12)}`,
    name: "My Workspace",
    type: "personal",
    ownerUserId: firebaseUser?.uid || "",
  };
}

function readStoredValue(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return "";
  }
}

function writeStoredValue(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage write errors.
  }
}

function readBootstrapCache(userId) {
  const raw = readStoredValue(getBootstrapStorageKey(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);      // null = not logged in
  const [loading, setLoading] = useState(true); // true while Firebase checks session
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const [workspaceSwitching, setWorkspaceSwitching] = useState(false);
  const [workspace, setWorkspace] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [featureFlags, setFeatureFlags] = useState({});
  const [billing, setBilling] = useState(null);
  const [entitlements, setEntitlements] = useState({});
  const [bootstrapError, setBootstrapError] = useState("");
  const [currentMembershipRole, setCurrentMembershipRole] = useState("owner");

  function applyBootstrapState(firebaseUser, bootstrap, options = {}) {
    const fallbackWorkspace = buildFallbackWorkspace(firebaseUser);
    const defaultWorkspace = bootstrap?.defaultWorkspace || fallbackWorkspace;
    const bootstrapWorkspaces = Array.isArray(bootstrap?.workspaces) && bootstrap.workspaces.length > 0
      ? bootstrap.workspaces
      : [defaultWorkspace];
    const nextWorkspace = bootstrap?.currentWorkspace || defaultWorkspace;

    setWorkspace(nextWorkspace);
    setWorkspaces(bootstrapWorkspaces);
    setFeatureFlags(bootstrap?.featureFlags || {});
    setBilling(bootstrap?.billing || null);
    setEntitlements(bootstrap?.entitlements || bootstrap?.billing?.entitlements || {});
    setCurrentMembershipRole(bootstrap?.currentMembershipRole || nextWorkspace?.currentRole || "owner");
    setApiWorkspaceId(nextWorkspace?.id || "", { clear: true });
    writeStoredValue(getWorkspaceStorageKey(firebaseUser.uid), nextWorkspace?.id || "");
    if (options.persist !== false) {
      writeStoredValue(getBootstrapStorageKey(firebaseUser.uid), JSON.stringify(bootstrap || {}));
    }
  }

  async function loadBootstrap(firebaseUser, requestedWorkspaceId = "", options = {}) {
    const bootstrap = await fetchSessionBootstrap(firebaseUser, requestedWorkspaceId, options);
    applyBootstrapState(firebaseUser, bootstrap);
  }

  useEffect(() => {
    let active = true;

    // Firebase calls this every time the user logs in or out
    // onAuthStateChanged returns an unsubscribe function
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!active) return;

      setLoading(true);
      setUser(firebaseUser);
      setBootstrapError("");

      if (!firebaseUser) {
        setApiWorkspaceId("", { clear: true });
        setWorkspace(null);
        setWorkspaces([]);
        setFeatureFlags({});
        setBilling(null);
        setEntitlements({});
        setCurrentMembershipRole("owner");
        setBootstrapLoading(false);
        setWorkspaceSwitching(false);
        setLoading(false);
        return;
      }

      const requestedWorkspaceId = readStoredValue(getWorkspaceStorageKey(firebaseUser.uid)) || "";
      const cachedBootstrap = readBootstrapCache(firebaseUser.uid);
      if (cachedBootstrap) {
        applyBootstrapState(firebaseUser, cachedBootstrap, { persist: false });
        setLoading(false);
      } else {
        const fallbackWorkspace = buildFallbackWorkspace(firebaseUser);
        setApiWorkspaceId(fallbackWorkspace.id, { clear: true });
        setWorkspace(fallbackWorkspace);
        setWorkspaces([fallbackWorkspace]);
      }

      setBootstrapLoading(true);
      try {
        if (!active) return;
        await loadBootstrap(firebaseUser, requestedWorkspaceId, { force: true });
      } catch (err) {
        if (!active) return;
        if (!cachedBootstrap) {
          const fallbackWorkspace = buildFallbackWorkspace(firebaseUser);
          setApiWorkspaceId(fallbackWorkspace.id, { clear: true });
          setWorkspace(fallbackWorkspace);
          setWorkspaces([fallbackWorkspace]);
          setFeatureFlags({});
          setBilling(null);
          setEntitlements({});
          setCurrentMembershipRole("owner");
        }
        setBootstrapError(err?.message || "Could not load workspace context.");
      } finally {
        if (active) {
          setBootstrapLoading(false);
          setWorkspaceSwitching(false);
          setLoading(false);
        }
      }
    });

    // Cleanup when the component unmounts
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const logout = () => signOut(auth);
  const refreshSession = async () => {
    if (!user) return;
    await loadBootstrap(user, workspace?.id || "", { force: true });
  };
  const selectWorkspace = async (workspaceId) => {
    if (!user || !workspaceId || workspaceId === workspace?.id) return;
    setWorkspaceSwitching(true);
    setBootstrapError("");
    try {
      await loadBootstrap(user, workspaceId, { force: true });
    } catch (err) {
      setBootstrapError(err?.message || "Could not switch workspace.");
    } finally {
      setWorkspaceSwitching(false);
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      bootstrapLoading,
      workspaceSwitching,
      logout,
      workspace,
      workspaces,
      featureFlags,
      billing,
      entitlements,
      bootstrapError,
      currentMembershipRole,
      selectWorkspace,
      refreshSession,
    }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// Custom hook — any component can call useAuth() to get the current user
export function useAuth() {
  return useContext(AuthContext);
}
