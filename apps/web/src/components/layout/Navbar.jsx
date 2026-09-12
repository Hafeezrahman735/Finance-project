import React from 'react';
import {HiOutlineMenu, HiOutlineX} from "react-icons/hi";
import Sidebar from './Sidebar';
import "../../CSS/bar.css";


const Navbar = ({openSideMenu, setOpenSideMenu}) => {


  return (
    <div className='navbar'>
        <button className='navbar-menu-btn' 
            onClick={() => {
                setOpenSideMenu(!openSideMenu);
            }}>

            {openSideMenu ? (
                <HiOutlineMenu className='navbar-menu-icon'/> 
            ) : (
                <HiOutlineMenu className='navbar-menu-icon'/>
            )}

        </button>

        <h2 className='navbar-title'> Expense Tracker</h2>
        {/*}
        {openSideMenu && (
            <>
                <div 
                className={`mobile-sidebar-overlay ${openSideMenu ? 'active' : ''}`}
                onClick={() => setOpenSideMenu(false)}/>

                <div className='sidebar mobile-open'>
                    <Sidebar activeMenu={activeMenu} />
                </div>
            </>
        )}*/}

    </div>
   )
};

export default Navbar;