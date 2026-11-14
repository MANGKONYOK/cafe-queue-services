import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { homeFor, type Role } from "./api";
import { useAuth } from "./auth";
import { Loading } from "./components/States";
import { LoginPage } from "./pages/LoginPage";
import { QueuePage } from "./pages/QueuePage";
import { StaffPage } from "./pages/StaffPage";

/** Route guard for convenience only; the API enforces every permission (SDS 4). */
function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Checking your session…" />;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return <>{children}</>;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Checking your session…" />;
  return <Navigate to={user ? homeFor(user.role) : "/login"} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/queue" element={<RequireRole roles={["CUSTOMER"]}><QueuePage /></RequireRole>} />
      <Route path="/staff" element={<RequireRole roles={["STAFF", "ADMIN"]}><StaffPage /></RequireRole>} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
