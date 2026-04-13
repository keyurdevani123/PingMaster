import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import AppLayout from "./components/AppLayout";
import PageLoader from "./components/PageLoader";

const Home = lazy(() => import("./pages/Home"));
const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const Workspaces = lazy(() => import("./pages/Team"));
const Billing = lazy(() => import("./pages/Billing"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Incidents = lazy(() => import("./pages/Incidents"));
const IncidentDetails = lazy(() => import("./pages/IncidentDetails"));
const MonitorDetails = lazy(() => import("./pages/MonitorDetails"));
const MonitorEndpoints = lazy(() => import("./pages/MonitorEndpoints"));
const StatusPages = lazy(() => import("./pages/StatusPages"));
const PublicStatusPage = lazy(() => import("./pages/PublicStatusPage"));

// Wraps protected routes with the shared AppLayout (persistent sidebar).
// The sidebar never unmounts between page navigations — true SPA feel.
function ProtectedLayout({ children }) {
  return (
    <ProtectedRoute>
      <AppLayout>{children}</AppLayout>
    </ProtectedRoute>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<PageLoader rows={5} />}>
          <Routes>
            {/* Public */}
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/status/:slug" element={<PublicStatusPage />} />

            {/* Protected — all share the persistent AppLayout sidebar */}
            <Route path="/dashboard"                      element={<ProtectedLayout><Dashboard /></ProtectedLayout>} />
            <Route path="/alerts"                         element={<ProtectedLayout><Alerts /></ProtectedLayout>} />
            <Route path="/incidents"                      element={<ProtectedLayout><Incidents /></ProtectedLayout>} />
            <Route path="/incidents/:incidentId"          element={<ProtectedLayout><IncidentDetails /></ProtectedLayout>} />
            <Route path="/monitors/:monitorId"            element={<ProtectedLayout><MonitorDetails /></ProtectedLayout>} />
            <Route path="/monitors/:monitorId/endpoints"  element={<ProtectedLayout><MonitorEndpoints /></ProtectedLayout>} />
            <Route path="/status-pages"                   element={<ProtectedLayout><StatusPages /></ProtectedLayout>} />
            <Route path="/billing"                        element={<ProtectedLayout><Billing /></ProtectedLayout>} />
            <Route path="/workspaces"                     element={<ProtectedLayout><Workspaces /></ProtectedLayout>} />
            <Route path="/team"                           element={<ProtectedLayout><Workspaces /></ProtectedLayout>} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
