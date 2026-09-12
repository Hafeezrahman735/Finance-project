import React, {useState} from 'react'
import '../../CSS/Income-page.css'

const AddIncomeForm = ({onAddIncome}) => {

    const [income, setIncome] = useState({
        source: "",
        amount: "",
        date: "",
        icon: "",
    });

    const handleChange = (key, value) => setIncome({...income, [key]: value});
  return (
    <div className='form-main'>
        <input
        value={income.source}
        onChange={({target}) => handleChange("source",target.value)}
        label="Income Source"
        placeholder="Freelance, Salary, etc"
        type="text"/>

        <input
        value={income.amount}
        onChange={({target}) => handleChange("amount",target.value)}
        label="Income Amount"
        placeholder=""
        type="number"/>

        <input
        value={income.date}
        onChange={({target}) => handleChange("date", target.value)}
        placeholder=""
        type="date"
        />

        <div className='form-addbutton'>
          <button
            type='button'
            className='form-button'
            onClick={()=> onAddIncome(income)}>
              Add Income
            </button>
        </div>
    </div>
  )
}

export default AddIncomeForm