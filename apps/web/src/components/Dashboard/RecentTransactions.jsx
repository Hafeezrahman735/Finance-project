import React from 'react'
import { LuArrowRight } from 'react-icons/lu'
import moment from 'moment'
import TransactionCardInfoCard from '../Cards/TransactionCardInfoCard'

const RecentTransactions = ({transactions, onSeeMore}) => {

  return (
    <div className='card-container dashboard-recent-transaction'>
        <div className='card-header'>
            <h5 className='card-title'>Recent Transactions</h5>

            <button className='card-btn' onClick={onSeeMore}>
                See All <LuArrowRight className=''/>
            </button>
        </div>
        <div className='card-content-2'>
            {transactions?.slice(0,5)?.map((item) => (
                <TransactionCardInfoCard
                    key={item._id}
                    title={item.type == "expense" ? item.category : item.source}
                    icon={item.icon}
                    date={moment(item.date).format("Do MMM YYYY")}
                    amount={item.amount}
                    type={item.type}
                    hideDeleteBtn
                />
            ))}
        </div>
    </div>
  )
}

export default RecentTransactions