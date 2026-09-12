import React from 'react'
import {BarChart,Bar,XAxis,YAxis,CartesianGrid,Tooltip,Legend,ResponsiveContainer,Cell} from "recharts"


const CustomBarChart = ({data}) => {

    //function to alternate colors
    const getBarColor = (index) => {
        return index % 2 === 0 ? "#875cf5" : "#350e97"; 
    };

    const CustomToolTip = ({active, payload}) => {
        if (active && payload && payload.length) {
            return (
                <div className=''>
                    <p className=''>{payload[0].payload.category}</p>
                    <p className=''> 
                        Amount: <span className=''>${payload[0].payload.amount}</span>
                    </p>
                </div>
            );
        }
        return null;
    };

     
  return (
    <div>CustomBarChart
    <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
            <CartesianGrid stroke="none"/>
            <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#555"}}/>
            <YAxis tick={{ fontSize: 12, fill: "#555"}} stroke="none"/>

            <Tooltip content={CustomToolTip} />

            <Bar 
                dataKey="amount"
                radius={[10,10,0,0]}
                activeDot={{ r: 8, fill: "yellow"}}
                activeStyle={{ fill: "green"}} 
            >
                {data.map((entry, index) => (
                    <Cell key={index} fill={getBarColor(index)} />
                ))}
            </Bar>
        </BarChart>
    </ResponsiveContainer>
    </div>
  )
}

export default CustomBarChart