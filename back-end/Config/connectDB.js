import chalk from 'chalk';
import mongoose from 'mongoose';

export const connectDB = async () =>{
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI)
        console.log(chalk.blueBright.bold(`MongoDB connected: ${conn.connection.host}`))
    } catch (error) {
        console.error(chalk.red.bold('Error connecting to MongoDB:'), error)
        process.exit(1)
    }
}