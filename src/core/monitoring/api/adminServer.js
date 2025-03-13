import express from 'express';
import adminRoutes from '../../../routes/adminAPI.js';

const app = express();

// Parse JSON bodies for admin endpoints.
app.use(express.json());

// Mount the admin API routes under /admin
app.use('/admin', adminRoutes);

// Listen on a dedicated local port (e.g., 3090 for admin API)
const ADMIN_PORT = process.env.ADMIN_PORT || 3090;
app.listen(ADMIN_PORT, () => {
  console.log(`Admin Control Panel API listening on port ${ADMIN_PORT}`);
});
