import React from 'react'
import { LuUtensils, LuTrendingUp, LuTrendingDown, LuTrash2  } from 'react-icons/lu'
import '../../CSS/dashboard.css';


const TransactionCardInfoCard = ({title, icon, date, amount, type, hideDeleteBtn, onDelete, onUpdate}) => {

    const getAmountStyles = () => 
        type === 'income' ? "bg-green-50 text-green-500" : 'bg-red-50 text-red-500';

  return (
    <div className='transaction-card'>
        <div className='transaction-icon'>
            {icon ? (
                <img src={icon} alt={title} className='transcation-image'/>
            ) : (
                <LuUtensils/>
            )}
        </div>

        <div  onClick={onUpdate} className={`transaction-detail ${getAmountStyles()}`}>
            <div>
                <p className='transaction-title'>{title}</p>
                <p className='transaction-date'>{date}</p>
            </div>

            <div className='transaction-main'>
                {!hideDeleteBtn && (
                    <button className='transaction-delete' 
                        onClick={(e) => {
                            e.stopPropagation(); 
                            onDelete();}}>
                        <LuTrash2 size={18}/>
                    </button>
                )}

                <div className='transcation-card-amount'>
                    <h6 className='transcation-amount'>{type === 'income' ? "+" : "-"} ${amount}</h6>
                    {type === 'income' ? <LuTrendingUp/> : <LuTrendingDown/>}
                </div>
            </div>
        </div>
    </div>
  )
}

export default TransactionCardInfoCard