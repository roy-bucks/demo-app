//this route for audit logs 

import {
	createAuditLogsController,
    getAuditLogsController,
    searchAuditLogsController, 

} from '../controllers/auditLogs.controller'


import { verifyBankToken, verifyBankUserToken, verifyToken } from "../middleware/authentication"


const express = require("express")
const router = new express.Router()

router.post('/create', verifyBankUserToken, createAuditLogsController)
router.get("/get", verifyBankUserToken, getAuditLogsController)
router.get("/search", verifyBankUserToken, searchAuditLogsController);  


module.exports = router
