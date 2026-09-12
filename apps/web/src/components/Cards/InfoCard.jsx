import React from "react";
import '../../CSS/dashboard.css';


const InfoCard = ({ icon, label, value, color}) => {
    return <div>
        <div className={`card-info ${color}`}>
            {icon}
        </div>
        <div className="card">
            <h6 className="card-label">{label}</h6>
            <span className="card-value">${value}</span>
        </div>
    </div>
};

export default InfoCard;

