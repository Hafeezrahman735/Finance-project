import React from 'react'
import { LuDownload } from 'react-icons/lu'
import TransactionCardInfoCard from '../../components/Cards/TransactionCardInfoCard'
import moment from 'moment'

const IncomeList = ({transactions, onDelete, onDownload, onUpdate}) => {


  return (
    <div className='card-container'>
        <div className='card-header'>
            <h5 className='card-title'>Income Sources</h5>

            <button className='card-btn' onClick={onDownload}>
                <LuDownload className=''>Download</LuDownload>
            </button>
        </div>

        <div className='card-content-2'>
            {transactions?.map((income) => (
                <TransactionCardInfoCard 
                key={income._id}
                title={income.source}
                icon={income.icon}
                date={moment(income.date).format("Do MMM YYYY")}
                amount={income.amount}
                type="income"
                onDelete={() => onDelete(income._id)}
                onUpdate={() => onUpdate(income)}
                />
            ))}
        </div>
    </div>
  )
}

export default IncomeList