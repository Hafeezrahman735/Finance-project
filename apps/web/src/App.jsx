import React from "react";
import { Toaster } from "react-hot-toast";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import UserProvider from "./context/UserProvider";
import Login from "./pages/Auth/Login";
import SignUp from "./pages/Auth/SignUp";
import ForgotPassword from "./pages/Auth/ForgotPassword";
import ResetPassword from "./pages/Auth/ResetPassword";
import VerifyEmail from "./pages/Auth/VerifyEmail";
import Overview from "./pages/Overview";
import Brief from "./pages/Brief";
import Transactions from "./pages/Transactions";
import Import from "./pages/Import";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <UserProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Root />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/signUp" element={<Navigate to="/signup" replace />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="/dashboard" element={<Navigate to="/overview" replace />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/brief" element={<Brief />} />
          <Route path="/import" element={<Import />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/income" element={<Navigate to="/transactions" replace />} />
          <Route path="/expense" element={<Navigate to="/transactions" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster
        position="bottom-center"
        toastOptions={{ style: { border: "1px solid #e5e2db", boxShadow: "none", background: "#ffffff", color: "#1c1b18", fontSize: "15px" } }}
      />
    </UserProvider>
  );
}

function Root() {
  return localStorage.getItem("token") ? <Navigate to="/overview" replace /> : <Navigate to="/login" replace />;
}
