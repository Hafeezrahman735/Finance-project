import React from 'react'
import moment from 'moment'
import { LuArrowRight } from 'react-icons/lu'
import TranscationCardInfoCard from '../Cards/TransactionCardInfoCard'

const ExpenseTransactions = ({transactions, onSeeMore}) => {

  return (
    <div className='card-container'>
        <div className='card-header'>
            <h5 className='card-title'>expense</h5>

            <button className='card-btn' onClick={onSeeMore}>
                See All <LuArrowRight className="text-base"/>
            </button>
        </div>

        <div className='card-content'>
            {transactions?.slice(0,5)?.map((expense) => (
                <TranscationCardInfoCard 
                 key={expense._id}
                 title={expense.category}
                 icon={expense.icon}
                 date={moment(expense.date).format("Do MMM YYYY")}
                 amount={expense.amount}
                 type="expense"
                 hideDeleteBtn/>
            ))}
        </div>
    </div>
  )
}

export default ExpenseTransactions