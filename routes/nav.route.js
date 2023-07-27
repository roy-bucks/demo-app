import {
  deleteNavMakerCheckerController,
  deleteNavOTPVerificationController,
  exportNavRatesController,
  GetAllNavRatesController,
  GetAllNavRatesDateController,
  GetAllNavRatesTodayApprovalController,
  GetAllNavRatesTodayController,
  getAllNavvRateController,
  GetNavChartDataController,
  getNavvRateController,
  importNavRatesController,
  NavCRUDController,
  NavLatestAsOfYesterdayController,
  NavMakerCheckerDeclineController,
  NavMakerCheckerVerificationController,
  NavOTPVerificationController,
  testNavController,
} from "../controllers/nav.controller";
import { verifyBankToken, verifyToken } from "../middleware/authentication";

const express = require("express");
const router = new express.Router();

router.get("/rates/all", verifyToken, GetAllNavRatesController);
router.get("/rates", verifyToken, GetAllNavRatesController);
router.get("/rates/middleware", GetAllNavRatesController);
router.get("/rates/today", verifyToken, GetAllNavRatesTodayController);
router.get("/rates/date", verifyToken, GetAllNavRatesDateController);
router.get("/rates/middleware/date", GetAllNavRatesDateController);
router.get(
  "/rates/today/approval",
  verifyToken,
  GetAllNavRatesTodayApprovalController
);
router.post("/day", verifyToken, NavCRUDController);
router.post("/date", verifyToken, NavCRUDController);
router.post("/day/verify", verifyToken, NavOTPVerificationController);
router.post(
  "/day/verify-checker",
  verifyToken,
  NavMakerCheckerVerificationController
);
router.post(
  "/day/checker-decline",
  verifyToken,
  NavMakerCheckerDeclineController
);
router.patch("/import", verifyToken, importNavRatesController);
router.get("/export", verifyToken, exportNavRatesController);
router.patch("/day", verifyToken, NavCRUDController);
router.delete("/day", verifyToken, NavCRUDController);
router.delete("/day/verify", verifyToken, deleteNavOTPVerificationController);
router.delete(
  "/day/verify-checker",
  verifyToken,
  deleteNavMakerCheckerController
);
router.get("/test", verifyToken, testNavController);
router.get("/chart-data", verifyToken, GetNavChartDataController);
router.get(
  "/latest/as-of-yesterday",
  verifyToken,
  NavLatestAsOfYesterdayController
);
//exposed on wrapper
router.get("/wrap/nav/per-funds", verifyBankToken, getNavvRateController);
router.get("/wrap/nav/all", verifyBankToken, getAllNavvRateController);

module.exports = router;
