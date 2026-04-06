/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "../firebase";
import { fetchSessionBootstrap, setApiWorkspaceId } from "../api";

// This context holds the current user so any component can access it
const AuthContext = createContext(null);

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

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);      // null = not logged in
  const [loading, setLoading] = useState(true); // true while Firebase checks session
  const [workspace, setWorkspace] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [featureFlags, setFeatureFlags] = useState({});
  const [bootstrapError, setBootstrapError] = useState("");
  const [currentMembershipRole, setCurrentMembershipRole] = useState("owner");

  async function loadBootstrap(firebaseUser, requestedWorkspaceId = "") {
    const bootstrap = await fetchSessionBootstrap(firebaseUser, requestedWorkspaceId);
    const fallbackWorkspace = buildFallbackWorkspace(firebaseUser);
    const defaultWorkspace = bootstrap?.defaultWorkspace || fallbackWorkspace;
    const bootstrapWorkspaces = Array.isArray(bootstrap?.workspaces) && bootstrap.workspaces.length > 0
      ? bootstrap.workspaces
      : [defaultWorkspace];
    const nextWorkspace = bootstrap?.currentWorkspace || defaultWorkspace;

    setWorkspace(nextWorkspace);
    setWorkspaces(bootstrapWorkspaces);
    setFeatureFlags(bootstrap?.featureFlags || {});
    setCurrentMembershipRole(bootstrap?.currentMembershipRole || nextWorkspace?.currentRole || "owner");
    setApiWorkspaceId(nextWorkspace?.id || "", { clear: true });
    try {
      localStorage.setItem(`pingmaster:workspace:${firebaseUser.uid}`, nextWorkspace?.id || "");
    } catch {
      // Ignore storage write errors.
    }
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
        setCurrentMembershipRole("owner");
        setLoading(false);
        return;
      }

      try {
        if (!active) return;
        let requestedWorkspaceId = "";
        try {
          requestedWorkspaceId = localStorage.getItem(`pingmaster:workspace:${firebaseUser.uid}`) || "";
        } catch {
          requestedWorkspaceId = "";
        }
        await loadBootstrap(firebaseUser, requestedWorkspaceId);
      } catch (err) {
        if (!active) return;
        const fallbackWorkspace = buildFallbackWorkspace(firebaseUser);
        setApiWorkspaceId(fallbackWorkspace.id, { clear: true });
        setWorkspace(fallbackWorkspace);
        setWorkspaces([fallbackWorkspace]);
        setFeatureFlags({});
        setCurrentMembershipRole("owner");
        setBootstrapError(err?.message || "Could not load workspace context.");
      } finally {
        if (active) setLoading(false);
      }
    });

    // Cleanup when the component unmounts
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const logout = () => signOut(auth);
  const selectWorkspace = async (workspaceId) => {
    if (!user || !workspaceId || workspaceId === workspace?.id) return;
    setLoading(true);
    setBootstrapError("");
    try {
      await loadBootstrap(user, workspaceId);
    } catch (err) {
      setBootstrapError(err?.message || "Could not switch workspace.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      logout,
      workspace,
      workspaces,
      featureFlags,
      bootstrapError,
      currentMembershipRole,
      selectWorkspace,
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
