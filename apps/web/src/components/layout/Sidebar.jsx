// Sidebar.jsx - FINAL CLEAN VERSION
import React, { useContext } from 'react'
import { SIDE_MENU_DATA } from '../../utils/data'
import { UserContext } from '../../context/userContent'
import { useNavigate } from 'react-router-dom';
import "../../CSS/bar.css";

const Sidebar = ({activeMenu, openSideMenu}) => {
    const {user, clearUser} = useContext(UserContext);
    const navigate = useNavigate();

    const handleClick = (route) => {
        if (route === "logout") {
            handleLogout();
            return;
        }
        navigate(route);
    };

    const handleLogout = () => {
        localStorage.clear();
        clearUser();
        navigate("/login");
    };

    return (
        <div className={`sidebar ${openSideMenu ? 'mobile-open' : ''}`}>
            <div className='sidebar-profile'>
                <h5 className='sidebar-profile-name'>
                    {user?.fullName || "User"}
                </h5>
                <p className='sidebar-profile-role'>Dashboard</p>
            </div>

            <div className='sidebar-menu'>
                {SIDE_MENU_DATA.map((item, index) => (
                    <button
                        key={`menu_${index}`}
                        className={`sidebar-menu-item ${
                            activeMenu === item.label ? "active" : ""
                        } ${item.label === 'Logout' ? 'logout' : ''}`}
                        onClick={() => handleClick(item.path)}
                    >
                        <item.icon className="sidebar-menu-icon"/>
                        {item.label}
                    </button>
                ))}
            </div>
        </div>
    )
};

export default Sidebar;