import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import React from 'react';
import SignUp from './pages/Auth/SignUp';
import Home from './pages/dashboard/Home';
import Login from "./pages/Auth/Login";
import Income from './pages/dashboard/Income';
import Expense from './pages/dashboard/Expense';
import UserProvider from './context/userContent';
import {Toaster} from "react-hot-toast";


import {
  BrowserRouter as Router,
  Route,
  Navigate,
  Routes,
} from "react-router-dom";

const App = () => {
  return (
    <UserProvider>
      <div>
        <Router>
          <Routes>
            <Route path="/" element={<Root />} />
            <Route path="/login" exact element={<Login />} />
            <Route path="/signUp" exact element={<SignUp />} />
            <Route path="/dashboard" exact element={<Home />} />
            <Route path="/income" exact element={<Income />} />
            <Route path="/expense" exact element={<Expense />} />
          </Routes>
        </Router>
      </div>

      <Toaster
        toastOptions={{
          className: "",
          style: {fontSize: '13px'},
        
        }}
      />
    </UserProvider>
  )
}


export default App

const Root = () => {
  // chec if token exist in loacalStorage
  const isAuthenticated = !!localStorage.getItem("token");

  //redirect to dashboard if authicated otherwise to login
  return isAuthenticated ? (
    <Navigate to="/dashboard" />
  ) : (
    <Navigate to="/login" />
  );
  
}