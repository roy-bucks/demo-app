import { 
  RiskProfilingController, 
  GetAssessmentHistoryController
} from '../controllers/assessment.controller'
import passport from 'passport'
import { verifyToken, verifyBankToken, verifyBankWithUserToken} from "../middleware/authentication"

const express = require("express")
const router = new express.Router()


//router
router.get('/', verifyToken, GetAssessmentHistoryController)

//exposed to wrapper 
router.post('/', verifyBankWithUserToken , RiskProfilingController)





module.exports = router