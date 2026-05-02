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
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeWorkspaceRecord(value, fallbackWorkspace) {
  if (!isRecord(value)) return fallbackWorkspace;

  const nextId = typeof value.id === "string" && value.id.trim() ? value.id.trim() : fallbackWorkspace.id;
  return {
    ...fallbackWorkspace,
    ...value,
    id: nextId,
    slug: typeof value.slug === "string" && value.slug.trim() ? value.slug.trim() : fallbackWorkspace.slug,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : fallbackWorkspace.name,
    type: value.type === "team" ? "team" : "personal",
    ownerUserId: typeof value.ownerUserId === "string" && value.ownerUserId.trim()
      ? value.ownerUserId.trim()
      : fallbackWorkspace.ownerUserId,
  };
}

function normalizeBillingSummary(value) {
  if (!isRecord(value)) return null;
  return {
    ...value,
    entitlements: isRecord(value.entitlements) ? value.entitlements : {},
    availablePlans: Array.isArray(value.availablePlans) ? value.availablePlans : [],
    checkoutSession: isRecord(value.checkoutSession) ? value.checkoutSession : null,
    planLabel: typeof value.planLabel === "string" && value.planLabel.trim() ? value.planLabel.trim() : "Free",
    plan: typeof value.plan === "string" && value.plan.trim() ? value.plan.trim().toLowerCase() : "free",
  };
}

function normalizeBootstrapPayload(firebaseUser, bootstrap) {
  const fallbackWorkspace = buildFallbackWorkspace(firebaseUser);
  if (!isRecord(bootstrap)) {
    return {
      defaultWorkspace: fallbackWorkspace,
      currentWorkspace: fallbackWorkspace,
      workspaces: [fallbackWorkspace],
      featureFlags: {},
      billing: null,
      entitlements: {},
      currentMembershipRole: "owner",
    };
  }

  const defaultWorkspace = normalizeWorkspaceRecord(bootstrap.defaultWorkspace, fallbackWorkspace);
  const currentWorkspace = normalizeWorkspaceRecord(bootstrap.currentWorkspace, defaultWorkspace);
  const workspaceList = Array.isArray(bootstrap.workspaces) && bootstrap.workspaces.length > 0
    ? bootstrap.workspaces
      .filter((item) => isRecord(item))
      .map((item) => normalizeWorkspaceRecord(item, fallbackWorkspace))
    : [defaultWorkspace];
  const workspaces = workspaceList.some((item) => item.id === currentWorkspace.id)
    ? workspaceList
    : [currentWorkspace, ...workspaceList.filter((item) => item.id !== currentWorkspace.id)];
  const billing = normalizeBillingSummary(bootstrap.billing);

  return {
    defaultWorkspace,
    currentWorkspace,
    workspaces,
    featureFlags: isRecord(bootstrap.featureFlags) ? bootstrap.featureFlags : {},
    billing,
    entitlements: isRecord(bootstrap.entitlements)
      ? bootstrap.entitlements
      : (billing?.entitlements || {}),
    currentMembershipRole: typeof bootstrap.currentMembershipRole === "string" && bootstrap.currentMembershipRole.trim()
      ? bootstrap.currentMembershipRole.trim()
      : (typeof currentWorkspace.currentRole === "string" && currentWorkspace.currentRole.trim()
        ? currentWorkspace.currentRole.trim()
        : "owner"),
  };
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
    const normalized = normalizeBootstrapPayload(firebaseUser, bootstrap);
    const defaultWorkspace = normalized.defaultWorkspace;
    const bootstrapWorkspaces = normalized.workspaces;
    const nextWorkspace = normalized.currentWorkspace;

    setWorkspace(nextWorkspace);
    setWorkspaces(bootstrapWorkspaces);
    setFeatureFlags(normalized.featureFlags);
    setBilling(normalized.billing);
    setEntitlements(normalized.entitlements);
    setCurrentMembershipRole(normalized.currentMembershipRole);
    setApiWorkspaceId(nextWorkspace?.id || "", { clear: true });
    writeStoredValue(getWorkspaceStorageKey(firebaseUser.uid), nextWorkspace?.id || "");
    if (options.persist !== false) {
      writeStoredValue(getBootstrapStorageKey(firebaseUser.uid), JSON.stringify({
        ...normalized,
        defaultWorkspace,
        currentWorkspace: nextWorkspace,
        workspaces: bootstrapWorkspaces,
      }));
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
