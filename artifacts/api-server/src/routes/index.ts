import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tradingRouter from "./trading";
import statsRouter from "./stats";
import marketRouter from "./market";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tradingRouter);
router.use(statsRouter);
router.use(marketRouter);

export default router;
