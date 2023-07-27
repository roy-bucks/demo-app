const express = require("express");
const {
  AMLReportCRUDController,
} = require("../controllers/aml_reports.controller");

const { verifyToken } = require("../middleware/authentication");
const router = new express.Router();

router.post("/", verifyToken, AMLReportCRUDController);
router.get("/", verifyToken, AMLReportCRUDController);
router.patch("/", verifyToken, AMLReportCRUDController);
router.delete("/", verifyToken, AMLReportCRUDController);
module.exports = router;
