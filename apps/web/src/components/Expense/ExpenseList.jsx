import React from 'react'
import { LuDownload } from 'react-icons/lu'
import TransactionCardInfoCard from '../Cards/TransactionCardInfoCard'
import moment from 'moment'

const ExpenseList = ({transactions, onDelete, onDownload, onUpdate}) => {


  return (

    <div className='card-container'>
            <div className='card-header'>
                <h5 className='card-title'>Expense Sources</h5>
    
                <button className='card-btn' onClick={onDownload}>
                    <LuDownload className=''>Download</LuDownload>
                </button>
            </div>
    
        
        <div>
            {transactions?.map((expense) => (
                <TransactionCardInfoCard
                key={expense._id}
                icon={expense.icon}
                title={expense.category}
                amount={expense.amount}
                date={moment(expense.date).format("Do MMM YYYY")}
                type="Expense"
                onDelete={() => onDelete(expense._id)}
                onUpdate={() => onUpdate(expense)}
            />
            ))}
        </div>


    </div>
  )
}

export default ExpenseList