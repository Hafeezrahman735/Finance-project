const jwt = require("jsonwebtoken");
const User = require('../models/User')

//generate JWT token
const generateToken = (id) => {
    return jwt.sign({id }, process.env.JWT_SECRET, { expiresIn: "1h"});
};

exports.registersUser = async (req,res) => {

    if (!req.body) {
    return res.status(400).json({ message: "Request body is missing" });
    }
    const { fullName, email, password } = req.body;

    if(!fullName || !email || !password){
        return res.status(400).json({ message: "All fields are required" });
    }

    try {
        const existingUser = await User.findOne({email});
        if (existingUser){
        return res.status(400).json({message: "Email already in user"});
        }

        const user = await User.create({
            fullName,
            email,
            password
        });

        res.status(201).json({
            id: user._id,
            user,
            token: generateToken(user._id),

        });

    } catch (err) {
        res.status(500).json({message: "Error registering user", error: err.message})
    }

};

exports.loginUser = async (req, res) => {
    const {email, password} = req.body;

    if (!email || !password){
        return res.status(400).json({ message: "All filed are required"});
    }

    try {
        const user = await User.findOne({email});
        if (!user || !(await user.comparePassword(password))) {
            return res.status(400).json({message: "Invalid credintals"});
        }

        res.status(200).json({
            id: user._id,
            user,
            token: generateToken(user._id),
        })
    } catch {
        res.status(500).json({message: "Error logging in", error: err.message})
    }
};

exports.getUserInfo = async (req, res) => {

    try {
        const user = await User.findById(req.user.id).select("-password")

        if (!user) {
            return res.status(404).json({ message: "User not Found"});

        }
        res.status(200).json(user);
    } catch (err) {
        res.status(500).json({message: "error finding user", error: err.message});
    }
};