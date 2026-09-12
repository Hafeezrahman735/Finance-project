import React from 'react'
import CustomPieChart from '../Charts/CustomPieChart';

const COLORS = ['#875CF5', "#FA2C37", "#FF6900"]

const FinanceOverview = ({totalBalance, totalIncome, totalExpense}) => {

    const balanceData = [
        {name: "Total Balance", amount: totalBalance},
        {name: "Total Income" , amount: totalIncome},
        {name: "Total Expense", amount: totalExpense},
    ];

  return (
    <div className='card-container finance-overview-container'>
        <div className='card-header'>
            <h5 className='card-title'>Financial Overview</h5>
        </div>

        
        <CustomPieChart 
          data={balanceData}
          label="Total Balance"
          totalAmount={`$${totalBalance}`}
          colors={COLORS}
          showTextAnchor 
        />
    </div>
  )
}

export default FinanceOverview