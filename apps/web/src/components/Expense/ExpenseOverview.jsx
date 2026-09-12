import React, { useEffect, useState } from 'react'
import { LuPlus } from 'react-icons/lu';
import { prepareExpenseBarChartData } from '../../utils/helper'
import '../../CSS/Income-page.css';
import CustomBarChart from '../Charts/CustomBarChart'

const ExpenseOverview = ({transactions, onAddExpense}) => {
    
  const [charData, setChartData] = useState([])

  useEffect(() => {
    const result = prepareExpenseBarChartData(transactions);
    setChartData(result);

    return () => {};
  }, [transactions]);
  return (
    <div className='overview-main'>
      <div className='overview-all'>
        <div className='overview-text'>
          <h5 className='overview-title'>Expense Overview</h5>
          <p className='overview-p'> Track your spending over time and analyze your expenses</p>
        </div>

        <button className='overview-button' onClick={onAddExpense}>
          <LuPlus className='overview-plus'/> 
          Add Expense
        </button>
      </div>

      <div className='mt-10'>
        <CustomBarChart data={charData} />
      </div>
    </div>
  )
}

export default ExpenseOverview;


