import { Router } from "express";
import { publicPlans } from "../utils/plans.js";

// Public: the pricing tiers shown on the login page. Contains no account or company data.
const router = Router();
router.get("/", (_req, res) => res.json(publicPlans()));
export default router;
