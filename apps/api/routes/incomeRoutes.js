const express = require("express");
const {protect} = require("../middleware/authMiddleware");

const { 
    addIncome,
    deleteIncome,
    getallIncome,
    updateIncome,
    downloadIncomeExcel
} = require("../controllers/incomeController");

const router = express.Router();

router.post("/addIncome", protect, addIncome);

router.delete("/delete/:id", protect, deleteIncome);

router.get("/getIncome", protect, getallIncome);

router.get("/downloadexcel", protect, downloadIncomeExcel);

router.patch("/updateIncome/:id", protect, updateIncome);

module.exports = router;
