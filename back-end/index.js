import 'dotenv/config'; // load env BEFORE any other module that reads process.env
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import chalk from 'chalk';
import path from 'path';
import { connectDB } from './Config/connectDB.js';

// Side-effect imports (init configs / register queues) — must come BEFORE routes
import './Config/cloudinary.js';
import './Config/openai.js';
import './Config/redis.js';
import './Service/proxyPool.service.js';
import './Service/garage.service.js';
import './Service/jobQueue.service.js';
import './Queue/vehicleLookup.queue.js';
import './Queue/escrowRelease.queue.js';      // Phase-2 escrow worker
import './Queue/disputeDeadline.queue.js';    // Phase-2 dispute SLA worker
import './Service/notification.service.js';
import './Service/qpay.service.js';

// Route modules
import authRoutes         from './Routes/auth.route.js';
import productRoutes      from './Routes/product.route.js';
import orderRoutes        from './Routes/order.route.js';
import userRoutes         from './Routes/user.route.js';
import statsRoutes        from './Routes/stats.route.js';
import uploadRoutes       from './Routes/upload.route.js';
import sellerRoutes       from './Routes/seller.route.js';
import aiRoutes           from './Routes/ai.route.js';
import wishlistRoutes     from './Routes/wishlist.route.js';
import garageRoutes       from './Routes/garage.route.js';
import vehicleRoutes      from './Routes/vehicle.route.js';
import oemRoutes          from './Routes/oem.route.js';
import notificationRoutes from './Routes/notification.route.js';
import qpayRoutes         from './Routes/qpay.route.js';
import trainingRoutes     from './Routes/training.route.js';
import proxyRoutes        from './Routes/proxy.route.js';
import smartSearchRoutes  from './Routes/smartSearch.route.js';
import sellerImportRoutes from './Routes/sellerImport.route.js';
import disputeRoutes      from './Routes/dispute.route.js';

connectDB();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(path.resolve('uploads'), {
  setHeaders: (res) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=86400');
  },
}));

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/api/auth',          authRoutes);
app.use('/api/products',      productRoutes);
app.use('/api/orders',        orderRoutes);
app.use('/api/users',         userRoutes);
app.use('/api/stats',         statsRoutes);
app.use('/api/upload',        uploadRoutes);
app.use('/api/seller',        sellerRoutes);
app.use('/api/ai',            aiRoutes);
app.use('/api/wishlist',      wishlistRoutes);
app.use('/api/garage',        garageRoutes);   // user's personal car garage
app.use('/api/vehicle',       vehicleRoutes);  // plate lookup + compatibility (NEW)
app.use('/api/vehicles',      garageRoutes);   // alias for backwards compat
app.use('/api/oem',           oemRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/qpay',          qpayRoutes);
app.use('/api/training',      trainingRoutes);
app.use('/api/admin/proxy',   proxyRoutes);
app.use('/api/search',        smartSearchRoutes);
app.use('/api/seller/import', sellerImportRoutes);
app.use('/api/disputes',      disputeRoutes);   // Phase-2: refund / dispute system

app.use((err, _req, res, _next) => {
  console.error(chalk.red(err.stack || err.message));
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

app.listen(PORT, () => {
  console.log(chalk.blueBright.bold(`Server running on port ${PORT}`));
});
