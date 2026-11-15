import express from 'express';
import { nasaRouter } from '../server/routes/nasaRoutes.ts';

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use('/api', nasaRouter);
app.use('/', nasaRouter);

export default app;
