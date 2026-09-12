import React, {useEffect, useState} from 'react'
import '../../CSS/Income-page.css'

const EditExpenseform = ({expense, onEdit}) => {

  const [formdata,setformdata] = useState({
    _id: expense._id || "",
    category: expense.category || "",
    amount: expense.amount || "",
    date: expense.date || ""
  });

  const handleChange = (key,value) => setformdata({...formdata, [key]: value});

  useEffect(() => {
    if (expense) {
      setformdata({
        _id: expense._id,
        category: expense.category,
        amount: expense.amount,
        date: expense.date?.split("T")[0]
      });
    }
  },[expense] );

  return (
    <div className='form-main'>
        <input
        value={formdata.category}
        onChange={({target}) => handleChange("category",target.value)}
        type="text"/>

        <input
        value={formdata.amount}
        onChange={({target}) => handleChange("amount",target.value)}
        type="number"/>

        <input
        value={formdata.date}
        onChange={({target}) => handleChange("date", target.value)}
        type="date"
        />

        <div className='form-addbutton'>
            <button
            type='button'
            className='form-button'
            onClick={()=> onEdit(formdata)}>
                Update Expense
            </button>
        </div>
    </div>
  )
}

export default EditExpenseform