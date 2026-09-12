import React, { Children, useContext, useState, useEffect } from 'react';
import { UserContext } from '../../context/userContent';
import Navbar from '../../components/layout/Navbar';
import Sidebar from '../../components/layout/Sidebar';
import "../../CSS/bar.css";



const DashboardLayout = ({children, activeMenu}) => {

    const {user} = useContext(UserContext);
    const [openSideMenu, setOpenSideMenu] = useState(null);
    

    return (
        <div className='dashboard-layout'>
            <Navbar activeMenu={activeMenu} openSideMenu={openSideMenu} setOpenSideMenu={setOpenSideMenu}/>
            {user && (
                <div className='dashboard-content'>
                    <Sidebar activeMenu={activeMenu} openSideMenu={openSideMenu}/>
                    <div className='dashboard-main'>{children}</div>

                    {openSideMenu && (
                        <div className='mobile-sidebar-overlay active' onClick={() => setOpenSideMenu(false)}/>
                    )}
                </div>
            )}
        </div>
    )
}

export default DashboardLayout;