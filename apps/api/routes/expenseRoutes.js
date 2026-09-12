const express = require("express");
const {protect} = require("../middleware/authMiddleware");

const {
    addExpense,
    deleteExpense,
    getallExpense,
    downloadExpenseExcel,
    updateExpense
} = require("../controllers/expenseController.js");

const router = express.Router();

router.delete("/:id",protect, deleteExpense);

router.post("/addExpense", protect, addExpense);

router.patch("/updateExpense/:id", protect, updateExpense);

router.get("/get", protect, getallExpense);

router.get("/downloadExcel",protect,  downloadExpenseExcel);

module.exports = router;

