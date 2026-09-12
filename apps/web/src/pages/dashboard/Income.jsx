import React, { useEffect, useState } from 'react'
import DashboardLayout from '../../components/layout/DashboardLayout';
import IncomeOverview from '../../components/Income/IncomeOverview';
import axiosInstance from '../../utils/axiosinstance';
import { API_PATHS } from '../../utils/apiPaths';
import Modal from '../../components/Modal';
import AddIncomeForm from '../../components/Income/AddIncomeForm';
import { toast } from 'react-hot-toast';
import IncomeList from '../../components/Income/IncomeList';
import DeleteAlert from '../../components/DeleteAlert';
import '../../CSS/Income-page.css';
import EditIncomeform from '../../components/Income/EditIncomeform';

const Income = () => {

  const [incomeData, setIncomeData] = useState([]);
  const [loading, setloading] = useState(false);
  const [openDeleteAlert, setOpenDeleteAlert] = useState({
    show: false,
    data: null,
  });
  const [openAddIncomeModal, setOpenAddIncomeModal] = useState(false);
  const [openEditIncomeModal, setEditIncomeModal] = useState(false);
  const [selectedIncome, setSelectedIncome] = useState(null);

  // get all income details 
  const fetchIncomeDetails = async () => {
    if (loading) return;

    setloading(true);

    try {
      const response = await axiosInstance.get(
        `${API_PATHS.INCOME.GET_ALL_INCOME}`
      );

      if (response.data) {
        setIncomeData(response.data);
      }
    }catch (error) {
      console.log("Something went wrong. Please try again", error)
    } finally {
      setloading(false);
    }
  };

  // handle add income 
  const handleAddIncome = async (income) => {
    const {source, amount,date,icon} = income;

    if (!source.trim()){
      toast.error("Source is required");
      return; 
    }

    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      toast.error("Amount should be valid");
      return;
    }

    if (!date) {
      toast.error("Date is required");
      return;
    }

    try {
      await axiosInstance.post(API_PATHS.INCOME.ADD_INCOME, {
        source,
        amount,
        date,
        icon
      });
      setOpenAddIncomeModal(false);
      toast.success("Income added succesfully");
      fetchIncomeDetails();
    } catch (error) {
      console.error("Error adding income", error.response?.data?.message || error.message);
    }
  };

  //delete a income 
  const deleteIncome = async (id) => {
    try {
      await axiosInstance.delete(API_PATHS.INCOME.DELETE_INCOME(id));

      setOpenDeleteAlert({ show: false, data: null});
      toast.success("Income deatils deleted successfully");
      fetchIncomeDetails();
    } catch (error) {
      console.error(
        "Error delete income: ",
        error.response?.data?.message || error.message
      );
    }
  };

  const editIncome = async (income) => {
    try {
      await axiosInstance.patch(API_PATHS.INCOME.EDIT_INCOME(income._id), income);
      setEditIncomeModal(false);
      toast.success("Income details updated successfully");
      fetchIncomeDetails();
    } catch (error) {
      console.error(
        "error edit income: ",
        error.response?.data?.message || error.message
      );
    }
  }

  const handleDownloadIncomeDetails = async () => {};

  useEffect(() => {
    fetchIncomeDetails()

    return () => {};
  }, []);

  return (
    <DashboardLayout activeMenu="Income">
      <div className='dashboard-main-layout'>
        <div className='income-main'>
          <div className='income-overview'>
            <IncomeOverview 
            transactions={incomeData}
            onAddIncome={() => setOpenAddIncomeModal(true)}
            />
          </div>
          <IncomeList 
            transactions={incomeData}
            onDelete={(id) => {
              setOpenDeleteAlert({show: true, data: id})
            }}
            onDownload={handleDownloadIncomeDetails}
            onUpdate={(income) => {
              setSelectedIncome(income);
              setEditIncomeModal(true)
            }}
            />
        </div>

        <Modal 
         isOpen={openAddIncomeModal}
         
         onClose={() => setOpenAddIncomeModal(false)}
         title="Add Income">
          <AddIncomeForm onAddIncome={handleAddIncome}/>
         </Modal>
          
        <Modal isOpen={openEditIncomeModal}
        onClose={() => setEditIncomeModal(false)}
        title="Update income">
          <EditIncomeform 
            income={selectedIncome}
            onEdit={editIncome}/>
        </Modal>
        
         <Modal
          isOpen={openDeleteAlert.show}
          onClose={() => setOpenDeleteAlert({show: false, data: null })}
          title="Delete Income">
          <DeleteAlert 
              content="Are you sure you want to delete this income"
              onDelete={() => deleteIncome(openDeleteAlert.data)}
            />
         </Modal>

      </div>
    </DashboardLayout>
  );
};

export default Income