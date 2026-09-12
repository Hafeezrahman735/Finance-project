import React from 'react'
import "../../CSS/login.css"

//not being used
const AuthLayout = ({children}) => {
  return (
    <div className='auth-layout'>
        <h2 className='title'>Expense Tracker</h2>
        {children}
    </div>

    
  )
}

export default AuthLayout