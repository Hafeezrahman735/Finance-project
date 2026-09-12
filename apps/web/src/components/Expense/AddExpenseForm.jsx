import React, {useState} from 'react'
import '../../CSS/Income-page.css'

const AddExpenseForm = ({onAddExpense}) => {

    const [expense, setExpense] = useState({
        category: "",
        amount: "",
        date: "",
        icon: "",
    });

    const handleChange = (key, value) => setExpense({...expense, [key]: value});
  return (
    <div className='form-main'>
        <input
        value={expense.category}
        onChange={({target}) => handleChange("category",target.value)}
        label="Expense category"
        placeholder="Freelance, Salary, etc"
        type="text"/>

        <input
        value={expense.amount}
        onChange={({target}) => handleChange("amount",target.value)}
        label="Expense Amount"
        placeholder=""
        type="number"/>

        <input
        value={expense.date}
        onChange={({target}) => handleChange("date", target.value)}
        placeholder=""
        type="date"
        />

        <div className='form-addbutton'>
          <button
            type='button'
            className='form-button'
            onClick={()=> onAddExpense(expense)}>
              Add Expense
            </button>
        </div>
    </div>
  )
}

export default AddExpenseForm;