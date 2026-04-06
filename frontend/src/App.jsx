import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";

const Home = lazy(() => import("./pages/Home"));
const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Incidents = lazy(() => import("./pages/Incidents"));
const IncidentDetails = lazy(() => import("./pages/IncidentDetails"));
const MonitorDetails = lazy(() => import("./pages/MonitorDetails"));
const MonitorEndpoints = lazy(() => import("./pages/MonitorEndpoints"));
const StatusPages = lazy(() => import("./pages/StatusPages"));
const PublicStatusPage = lazy(() => import("./pages/PublicStatusPage"));
const Team = lazy(() => import("./pages/Team"));

// App is the root of the application
// BrowserRouter  → enables URL-based navigation (/login, /dashboard)
// AuthProvider   → makes the logged-in user available to all pages
// Routes         → decides which page to show based on the URL
function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<RouteLoadingScreen />}>
          <Routes>
            {/* Public route — anyone can visit */}
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/status/:slug" element={<PublicStatusPage />} />

            {/* Protected route — only logged-in users can see this */}
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />

            <Route
              path="/alerts"
              element={
                <ProtectedRoute>
                  <Alerts />
                </ProtectedRoute>
              }
            />

            <Route
              path="/incidents"
              element={
                <ProtectedRoute>
                  <Incidents />
                </ProtectedRoute>
              }
            />

            <Route
              path="/incidents/:incidentId"
              element={
                <ProtectedRoute>
                  <IncidentDetails />
                </ProtectedRoute>
              }
            />

            <Route
              path="/monitors/:monitorId"
              element={
                <ProtectedRoute>
                  <MonitorDetails />
                </ProtectedRoute>
              }
            />

            <Route
              path="/monitors/:monitorId/endpoints"
              element={
                <ProtectedRoute>
                  <MonitorEndpoints />
                </ProtectedRoute>
              }
            />

            <Route
              path="/status-pages"
              element={
                <ProtectedRoute>
                  <StatusPages />
                </ProtectedRoute>
              }
            />

            <Route
              path="/team"
              element={
                <ProtectedRoute>
                  <Team />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}

function RouteLoadingScreen() {
  return (
    <div className="min-h-screen bg-[#0a0c10] flex items-center justify-center">
      <div className="text-[#69e7ba] text-sm animate-pulse">Loading...</div>
    </div>
  );
}

export default App;
