import React, { useEffect, useState } from 'react'
import { LuPlus } from 'react-icons/lu';
import { prepareIncomeBarChartData } from '../../utils/helper'
import '../../CSS/Income-page.css';
import CustomBarChart from '../Charts/CustomBarChart'

const IncomeOverview = ({transactions, onAddIncome}) => {

  const [charData, setChartData] = useState([])

  useEffect(() => {
    const result = prepareIncomeBarChartData(transactions);
    setChartData(result);

    return () => {};
  }, [transactions]);
  return (
    <div className='overview-main'>
      <div className='overview-all'>
        <div className='overview-text'>
          <h5 className='overview-title'>Income Overview</h5>
          <p className='overview-p'> Track your earning over time and analyze your income</p>
        </div>

        <button className='overview-button' onClick={onAddIncome}>
          <LuPlus className='overview-plus'/> 
          Add Income
        </button>
      </div>

      <div className='mt-10'>
        <CustomBarChart data={charData} />
      </div>
    </div>
  )
}

export default IncomeOverview;