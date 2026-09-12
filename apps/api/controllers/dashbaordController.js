const Income = require("../models/Income");
const Expense= require("../models/Expense");
const {isValidObjectId, Types} = require("mongoose");


//gets Total income and Expense
exports.getDashboard = async (req,res) => {
    try {
        const userId = req.user.id;
        const userObjectId = new Types.ObjectId(String(userId));
        
        const totalIncome = await Income.aggregate([
            { $match: {userId: userObjectId}},
            { $group: {_id: null, total: {$sum: "$amount"}}},
        ]);


        const totalExpense = await Expense.aggregate([
            { $match: {userId: userObjectId}},
            { $group: {_id: null, total: {$sum: "$amount"}}},
        ]);


        // get the income transaction in the last 60 days
        const last60DaysIncome = await Income.find({
            userId: userObjectId,
            date: {$gte: new Date(Date.now() - 60 *24* 60* 60 * 1000)},
        }).sort({ date: -1});

        //get total income for the last 30 days 
        const incomeLast60Days = last60DaysIncome.reduce(
            (sum, transaction) => sum + transaction.amount,
            0
        );

        //get expense transaction last 30 days
        const last30DaysExpense = await Expense.find({
            userId: userObjectId,
            date: {$gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)},
        }).sort({date: -1});

        const expenseLast30Days = last30DaysExpense.reduce(
            (sum, transaction) => sum + transaction.amount,
            0
        );

        //fetch last 5 transactions (income + expenses)
        const lasttransaction = [
            ...(await Income.find({ userId}).sort({ date: -1}).limit(5)).map(
                (txn) => ({
                    ...txn.toObject(),
                    type: "income",
                })
            ),
            ...(await Expense.find({userId}).sort({ date: -1}).limit(5)).map(
                (txn) => ({
                    ...txn.toObject(),
                    type: "expense",
                })
            ),
        ].sort((a,b) => b.date - a.date);

        res.json({
            totalBalance:
            (totalIncome[0]?.total || 0) - (totalExpense[0]?.total || 0),
            totalIncome: totalIncome[0]?.total || 0,
            totalExpense: totalExpense[0]?.total || 0,
            last30DaysExpense: {
                total: expenseLast30Days,
                transaction: last30DaysExpense,
            },
            last60DaysIncome: {
                total: incomeLast60Days,
                transaction: last60DaysIncome,
            },
            recentTransactions: lasttransaction

        });
    } catch (error) {
        res.status(500).json({message: "Server Error", error})
        console.log("Error occurred", error); // logs the error 
    }
}