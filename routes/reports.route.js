import { verifyToken, verifyApiKey, verifyBankToken,  verifyBankWithUserToken, verifyBankUserToken } from "../middleware/authentication"
import {
    GetInquiryReportController,
    GetInsightsReportController, 
    GetDataAllocationController

} from "../controllers/reports.controller";

const express = require("express")
const router = new express.Router()


router.get('/inquiry', verifyToken, GetInquiryReportController)
router.get('/insights', verifyBankWithUserToken, GetInsightsReportController)
router.get('/report/getdataalloc',  GetDataAllocationController )

module.exports = router
