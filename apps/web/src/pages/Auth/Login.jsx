import React, { useState, useContext } from 'react';
import AuthLayout from '../../components/layout/AuthLayout';
import { validateEmail } from '../../utils/helper';
import { Navigate, useNavigate } from 'react-router-dom';
import "../../CSS/login.css";
import axiosInstance from '../../utils/axiosinstance';
import { API_PATHS } from '../../utils/apiPaths';
import { UserContext } from '../../context/userContent';

const Login = () => {

  const [email, loginEmail] = useState("");
  const [password, loginPassword] = useState("");
  const navigate = useNavigate();

  const {updateUser} = useContext(UserContext);

  const [error, setError] = useState(null);

  const handleLogin = async (e) => {
    e.preventDefault();

    if (!validateEmail(email)) {
      setError("Please enter a valid Email Address");
      return
    }

    if (!password) {
      setError("please enter the password");
      return;
    }

    setError("")

    try {
      const response = await axiosInstance.post(API_PATHS.AUTH.LOGIN, {
        email,
        password,
      });
      const {token, user} = response.data;
      updateUser(user);

      if (token) {
        localStorage.setItem("token", token);
        navigate('/dashboard');
      }
    } catch (error) {
      if (error.response && error.response.data.message) {
        setError(error.response.data.message);
      } else {
        setError("Something went wrong fuck off");
      }
    }
  }

  return (
    <div className='auth-layout'>
      <div className='container'>
        <div className='header'>
          <h3 className="welcome">Welcome Back</h3>
          <p className="subtitle">Please Enter Your Details</p>
        </div>

        <form onSubmit={handleLogin} className='form'>

          <div className='input-group'>
            <label htmlFor='email' className='input-label'>
              <strong>Email</strong>
            </label>
            <input type='email' placeholder='Enter Email' autoComplete='off' name="email" id="email" className='input-field' onChange={(e) => loginEmail(e.target.value)}></input>
          </div>

          {error && <div className='error-message'>{error}</div>}

          <div className='input-group'>
            <label htmlFor='password' className='input-label'>
              <strong>Password</strong>
            </label>
            <input type='password' placeholder='Enter Password' autoComplete='off' name="password" id="password" className='input-field' onChange={(e) => loginPassword(e.target.value)}></input>
          </div>
          <button type='submit' className='button'>Login</button>
        </form>

      </div>
    </div>
  )
}

export default Login;