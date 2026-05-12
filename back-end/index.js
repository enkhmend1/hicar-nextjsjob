import express from 'express';
import dotenv from 'dotenv';
import chalk from 'chalk';
import { connectDB } from './Config/connectDB.js';



dotenv.config();
connectDB();
const app = express();
const PORT = process.env.PORT || 6000;

app.listen(PORT, ()=>{
    console.log(chalk.blueBright.bold(`server is running on port ${PORT}`))
})
