import 'dotenv/config'; // load env BEFORE any other module that reads process.env
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import { connectDB } from './Config/connectDB.js';
import { logger } from './Config/logger.js';

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
import { startReconciliationScheduler } from './Queue/reconciliation.queue.js';
import { startOutboxWorker } from './Queue/notificationOutbox.queue.js';
import { startBackgroundAgentScheduler } from './Queue/backgroundAgent.queue.js';   // Phase L
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
import auditRoutes        from './Routes/audit.route.js';
import siteContentRoutes  from './Routes/siteContent.route.js';

connectDB();

const app = express();
const PORT = process.env.PORT || 5001;

// ── Security headers ─────────────────────────────────────────────────
// helmet sets a sensible default of: X-Content-Type-Options=nosniff,
// X-Frame-Options=SAMEORIGIN, X-DNS-Prefetch-Control=off,
// Strict-Transport-Security (when behind HTTPS), Referrer-Policy=no-referrer,
// and removes X-Powered-By. We disable CSP here because the API never
// serves HTML — CSP belongs on the Next.js front-end.
app.use(helmet({
  contentSecurityPolicy: false,
  // Cloudinary images served via /uploads need cross-origin embedding.
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));
// Global body limit. Individual routes that need MORE (image uploads,
// product imports) opt in with their own multer/express.json mount.
app.use(express.json({ limit: '256kb' }));
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
app.use('/api/admin/audit',   auditRoutes);     // hash-chained financial event log
app.use('/api/site-content',  siteContentRoutes); // homepage display labels + hero copy

app.use((err, req, res, _next) => {
  logger.error('Unhandled request error', {
    err,
    method: req.method,
    path: req.originalUrl,
    status: err.status || 500,
  });
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

app.listen(PORT, () => {
  logger.info('Server running', { port: PORT });
  // Kick off background workers. Both schedulers have bootDelayMs so they
  // wait for Mongo + Redis to settle before firing the first tick.
  startReconciliationScheduler();
  startOutboxWorker();
  startBackgroundAgentScheduler();  // Phase L — daily AI insight notifications
});

// ── Process-level safety net ──────────────────────────────────────────
// Previously unhandled — a rejected promise or thrown error left no
// structured trace. Log both; on an uncaught exception the process state
// is undefined, so we exit(1) and let the supervisor (pm2/systemd) restart.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    err: reason instanceof Error ? reason : new Error(String(reason)),
  });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — exiting', { err });
  process.exit(1);
});
