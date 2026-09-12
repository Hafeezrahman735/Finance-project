import React, { useContext, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import "../../CSS/login.css"
import axiosInstance from '../../utils/axiosinstance'
import { API_PATHS } from '../../utils/apiPaths'
import { UserContext } from '../../context/userContent'
import { validateEmail } from '../../utils/helper';


const SignUp = () => {
    const [name, setName] = useState()
    const [email, setEmail] = useState()
    const [password, setPassword] = useState()

    const [error, setError] = useState();
    const {updateUser} = useContext(UserContext);
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
      e.preventDefault()

      if (!validateEmail(email)){
          setError("Please enter a valid email");
          return;
        }
      
      if(!password) {
        setError("please enter the correct password");
        return;
      }

      if (!name) {
        setError("please enter your Name");
      }
      
      setError("");

      try {
        const response = await axiosInstance.post(API_PATHS.AUTH.REGISTER, {
          fullName: name,
          email,
          password,
        });

        const {token, user} = response.data;

        if (token) {
          localStorage.setItem("token", token);
          updateUser(user);
          navigate('/dashboard');
        }
      } catch (error) {
        if (error.response && error.response.data.message) {
          setError(error.response.data.message);
        } else {
          setError("Something went wrong. fuck off");
        }
      }
    };

  return (
    <div className='auth-layout'>
      <div className='container'>
        <div className='header'>
          <h2 className='welcome'>Register</h2>
        </div>
        <form onSubmit={handleSubmit} className='login-form'>
          <div className='input-group'>
            <label htmlFor='Name' className='input-label'>
              <strong>Name</strong>
            </label>
            <input type="text" placeholder='Enter Name' autoComplete='off' name='name' className='input-field' onChange={(e) => setName(e.target.value)}/>
          </div>
          <div className='input-group'>
            <label htmlFor='email' className='input-label'>
              <strong>Email</strong>
            </label>
            <input type='email' placeholder='Enter Email' autoComplete='off' name="email" className='input-field' onChange={(e) => setEmail(e.target.value)}></input>
          </div>
          <div className='input-group'>
            <label htmlFor='email' className='input-label'>
              <strong>Password</strong>
            </label>
            <input type='password' placeholder='Enter Password' autoComplete='off' name="Password" className='input-field' onChange={(e) => setPassword(e.target.value)}></input>
          </div>
          <button type='submit' className='button'>Register</button>
        </form>
        <div className='link-login'>
          <p className='acc'>Already have an account?</p>
          <button className='button' onClick={()=> navigate("/login")}>Login</button>
        </div>
      </div>
    </div>
  )
}

export default SignUp;