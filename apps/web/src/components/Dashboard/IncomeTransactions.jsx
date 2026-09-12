import React from 'react'
import moment from 'moment'
import { LuArrowRight } from 'react-icons/lu'
import TranscationCardInfoCard from '../Cards/TransactionCardInfoCard'
const IncomeTransactions = ({transactions, onSeeMore}) => {
    
  return (
    <div className='card-container'>
        <div className='card-header'>
            <h5 className='card-title'>Income</h5>

            <button className='card-btn' onClick={onSeeMore}>
                See All <LuArrowRight className="text-base"/>
            </button>
        </div>

        <div className='card-content'>
            {transactions?.slice(0,5)?.map((income) => (
                <TranscationCardInfoCard 
                    key={income._id}
                    title={income.category}
                    icon={income.icon}
                    date={moment(income.date).format("Do MMM YYYY")}
                    amount={income.amount}
                    type="income"
                    hideDeleteBtn/>
            ))}
        </div>
    </div>
  )
}

export default IncomeTransactions