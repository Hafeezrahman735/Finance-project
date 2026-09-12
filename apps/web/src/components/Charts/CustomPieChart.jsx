import React, { useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import CustomToolTip from './CustomToolTip';
import CustomLegend from './CustomLegend';

const CustomPieChart = ({ data, label, totalAmount, colors, showTextAnchor }) => {
  const [activeIndex, setActiveIndex] = useState(null);

  const onPieEnter = (_, index) => {
    setActiveIndex(index);
  };

  const onPieLeave = () => {
    setActiveIndex(null);
  };

  // Custom label component that renders in the center
  const renderCenterLabel = () => {
    return (
      <g>
        <text
          x="50%"
          y="35%"
          textAnchor="middle"
          dominantBaseline="middle"
          className="text-sm fill-gray-500"
          style={{ fontSize: '14px', fontWeight: '500' }}
        >
          {label}
        </text>
        <text
          x="50%"
          y="45%"
          textAnchor="middle"
          dominantBaseline="middle"
          className="text-2xl fill-gray-900 font-bold"
          style={{ fontSize: '28px', fontWeight: '700', color: '#ffffffff' }}
        >
          {totalAmount}
        </text>
      </g>
    );
  };

  return (
    <div className="pie-chart-container">
      <ResponsiveContainer width="100%" height={400}>
        <PieChart>
          <Pie
            data={data}
            dataKey="amount"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={activeIndex !== null ? 135 : 130}
            innerRadius={100}
            labelLine={false}
            onMouseEnter={onPieEnter}
            onMouseLeave={onPieLeave}
            animationBegin={0}
            animationDuration={800}
          >
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={colors[index % colors.length]}
                opacity={activeIndex === null || activeIndex === index ? 1 : 0.6}
                className="transition-opacity duration-300 cursor-pointer"
              />
            ))}
          </Pie>
          <Tooltip content={<CustomToolTip />} />
          <Legend content={<CustomLegend />} />
          {showTextAnchor && renderCenterLabel()}
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

export default CustomPieChart;