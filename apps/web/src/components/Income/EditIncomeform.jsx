import React, {useState, useEffect} from 'react'
import '../../CSS/Income-page.css'

const EditIncomeform = ({income, onEdit}) => {

  const [formdata, setformdata] = useState({
    _id: income._id || "",
    source: income.source || "",
    amount: income.amount || "",
    date: income.date || ""
  });

  const handleChange = (key, value) => setformdata({...formdata, [key]: value});

  useEffect(() => {
    if (income) {
      setformdata({
        _id: income._id,
        source: income.source,
        amount: income.amount,
        date: income.date?.split("T")[0]
      });
    }
  }, [income]);

  return (
    <div className='form-main'>
        <input
        value={formdata.source}
        onChange={({target}) => handleChange("source",target.value)}
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
              Update Income
            </button>
        </div>
    </div>
  )
}

export default EditIncomeform;