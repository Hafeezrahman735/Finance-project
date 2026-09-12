
import React from 'react';
import '../../CSS/dashboard.css';

const CustomToolTip = ({ active, payload }) => {

  if (active && payload && payload.length) {
    return (
      <div className="custom-tooltip">
        <p className="tooltip-label">
          {payload[0].name}
        </p>
        <p className="tooltip-amount">
          Amount:{" "}
          <span className="tooltip-amount-value">
            ${payload[0].value}
          </span>
        </p>
      </div>
    );
  }
  
  return null;
};

export default CustomToolTip;