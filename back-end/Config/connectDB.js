import mongoose from 'mongoose';
import { logger } from './logger.js';

export const connectDB = async () =>{
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI)
        logger.info('MongoDB connected', { host: conn.connection.host });
    } catch (error) {
        logger.error('Error connecting to MongoDB', { err: error });
        process.exit(1)
    }
}