//this route for audit logs 

import {
	getcashflowController,
	getcashflowtransacController,
	getOrderBookController,
	getFundsByClassController

} from '../controllers/cashflow.controller'


import { verifyBankToken, verifyBankUserToken, verifyToken } from "../middleware/authentication"


const express = require("express")
const router = new express.Router()

router.get('/', verifyToken, getcashflowController)
router.get('/transaction', verifyToken, getcashflowtransacController )
router.get("/order-book", verifyToken, getOrderBookController)
router.get("/order-book/fund-class", verifyToken, getFundsByClassController)


module.exports = router
