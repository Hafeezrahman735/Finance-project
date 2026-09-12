import React, { useEffect, useState } from 'react'
import DashboardLayout from '../../components/layout/DashboardLayout';
import { createTransaction, deleteTransaction, downloadExport, listTransactions, updateTransaction } from '../../utils/api';
import toast from 'react-hot-toast';
import ExpenseOverview from '../../components/Expense/ExpenseOverview';
import Modal from '../../components/Modal';
import ExpenseList from '../../components/Expense/ExpenseList';
import AddExpenseForm from '../../components/Expense/AddExpenseForm';
import EditExpenseform from '../../components/Expense/EditExpenseform';
import DeleteAlert from '../../components/DeleteAlert';

const Expense = () => {

  const [expenseData, setExpenseData] = useState([]);
  const [loading, setloading] = useState(false);
  const [openDeleteAlert, setOpenDeleteAlert] = useState({
    show:false,
    data:null,
  });
  const [openAddExpenseModal, setOpenAddExpenseModal] = useState(false);
  const [openEditExpenseModal, setEditExpenseModal] = useState(false);
  const [selectedExpense, setSelectedExpesne] = useState(null);

  // get all expense information
  const fetchExpenseDetails = async () => {
    if (loading) return;

    setloading(true);

    try {
      setExpenseData(await listTransactions("out"));
    }catch (error) {
      console.log("Something went wrong. Please try again", error)
    } finally {
      setloading(false);
    }
    };

  const handleAddExpense = async (Expense) => {
    const {category, amount, date} = Expense

    if (!category.trim()) {
      toast.error("Category not working");
      return;
    }

    if (!amount || isNaN(amount) || Number(amount) <= 0){
      toast.error("Number is not valid");
      return;
    }

    if (!date) {
      toast.error("Date wrong");
      return;
    }

    try {
      await createTransaction({ direction: "out", amount, date, category });
      setOpenAddExpenseModal(false);
      toast.success("Expense Added");
      fetchExpenseDetails();
    } catch (error) {
      console.error("Error adding Expense", error.response?.data?.message || error.message);
    }
  };

  const deleteExpense = async (id) => {
    try {
      await deleteTransaction(id)
      setOpenDeleteAlert({show:false, data: null});
      toast.success("Expense information deleted successfully");
      fetchExpenseDetails();
    } catch (error) {
      console.error(
        "Error deleting expense: ",
        error.response?.data?.message || error.message
      );
    }
  };

  const editExpense = async (expense) => {
    try{
      await updateTransaction(expense._id, expense.version, { amount: expense.amount, date: expense.date, memo: expense.category });
      setEditExpenseModal(false);
      toast.success("Updated Expense")
      fetchExpenseDetails();
    } catch (error) {
      console.error(
        "error edit expense" ,
        error.response?.data?.message || error.message
      );
    }

  };

  const handleDownloadExpenseDetails = async () => {
    try {
      await downloadExport("out");
    } catch (error) {
      toast.error(error.response?.data?.message || "Download failed");
    }
  };


  useEffect(() => {
    fetchExpenseDetails()
  }, []);

  return (
    <DashboardLayout activeMenu="Expense">
      <div className='dashboard-main-layout'>
        <div className='expense-main'>
          <ExpenseOverview className=""
            transactions={expenseData}
            onAddExpense={() => setOpenAddExpenseModal(true)}
          />
        </div>
        <ExpenseList
          transactions={expenseData}
          onDelete={(id) => {
            setOpenDeleteAlert({show: true, data: id})
          }}
          onDownload={handleDownloadExpenseDetails}
          onUpdate={(expense) => {
            setSelectedExpesne(expense);
            setEditExpenseModal(true)
          }}

        />
      </div>
      <Modal 
        isOpen={openAddExpenseModal}
        onClose={() => setOpenAddExpenseModal(false)}
        title="Add Expense">
          <AddExpenseForm onAddExpense={handleAddExpense}/>
      </Modal>
      <Modal
        isOpen={openEditExpenseModal}
        onClose={() => setEditExpenseModal(false)}
        title="Edit Expense">
          <EditExpenseform
          expense={selectedExpense}
          onEdit={editExpense}
          />
      </Modal>
      <Modal
        isOpen={openDeleteAlert.show}
        onClose={() => setOpenDeleteAlert({show: false, data: null})}
        title="Delete Expense">
         <DeleteAlert 
            content="Are you sure you want to delete this income"
            onDelete={() => deleteExpense(openDeleteAlert.data)}
          />
        </Modal>


      


    </DashboardLayout>
  )
}

export default Expense