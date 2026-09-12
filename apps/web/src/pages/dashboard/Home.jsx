import React, {useEffect, useState } from 'react';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { useUserAuth } from '../../hooks/useUserAuth';
import { useNavigate } from 'react-router-dom';
import { API_PATHS } from '../../utils/apiPaths';
import axiosInstance from '../../utils/axiosinstance';
import InfoCard from '../../components/Cards/InfoCard';
import { LuHandCoins, LuWalletMinimal } from 'react-icons/lu';
import {IoMdCard} from 'react-icons/io';
import { addThousandsSeparator } from '../../utils/helper';
import RecentTransactions from '../../components/Dashboard/RecentTransactions'
import FinanceOverview from '../../components/Dashboard/FinanceOverview';
import ExpenseTransactions from '../../components/Dashboard/ExpenseTransactions';
import IncomeTransactions from '../../components/Dashboard/IncomeTransactions';
import '../../CSS/dashboard.css';

const Home = () => {
  useUserAuth();

  const navigate = useNavigate();
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchDashboardData = async () => {
    if (loading) return;

    setLoading(true);

    try {
      const response = await axiosInstance.get(
        `${API_PATHS.DASHBOARD.GET_DATA}`
      );

      if (response.data) {
        setDashboardData(response.data);
      }
    } catch (error) {
      console.log("Something went wrong. please try again", error)
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
    return () => {
    }
  }, [])
  

  return (
    <DashboardLayout activeMenu="Dashboard">
      <div className='dashboard-main-layout'>
        <div className="dashboard-card">
          <InfoCard 
            icon={<IoMdCard/>}
            label="Total Balance"
            value={addThousandsSeparator(dashboardData?.totalBalance)}
            color="bg-primary-50"
            />

            <InfoCard 
            icon={<LuWalletMinimal/>}
            label="Total Income"
            value={addThousandsSeparator(dashboardData?.totalIncome)}
            color="bg-green-500"
            />

            <InfoCard 
            icon={<LuHandCoins/>}
            label="Total Expense"
            value={addThousandsSeparator(dashboardData?.totalExpense)}
            color="bg-red-500"
            />
        </div>
        <div className='dashboard-grid'>
          <RecentTransactions 
          transactions={dashboardData?.recentTransactions} 
          onSeeMore={() => navigate("/expense")} 
          />
        
          <FinanceOverview 
          totalBalance={dashboardData?.totalBalance || 0}
          totalIncome={dashboardData?.totalIncome || 0}
          totalExpense={dashboardData?.totalExpense || 0} 
          />
        

          <ExpenseTransactions 
          transactions={dashboardData?.last30DaysExpense?.transaction || []}
          onSeeMore={() => navigate("/expense")}
          />

          <IncomeTransactions 
            transactions={dashboardData?.last60DaysIncome?.transaction || []}
            
            onSeeMore={() => navigate("/income")}
          />
        </div>
      </div>
    </DashboardLayout>
  )
}

export default Home