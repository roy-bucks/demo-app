import { 
  GetJourneyIDController,
  SubmitPersonalInfoStep1Controller,
  SubmitPersonalInfoStep2Controller,
  SubmitFreeFormIDController,
  SubmitIDController,
  SelfieAPIController,
  handleUBPostbackController,
  SubmitSignatureController,
  getAuthorizationController,
  verifyUBAccountController,
  getKYCDataController
} from '../controllers/kyc.controller'
import passport from 'passport'
import { verifyToken } from "../middleware/authentication"

const express = require("express")
const router = new express.Router()

router.get('/journeyid', verifyToken, GetJourneyIDController)
router.post('/personalinfo_step1', verifyToken, SubmitPersonalInfoStep1Controller)
router.post('/personalinfo_step2', verifyToken, SubmitPersonalInfoStep2Controller)
router.post('/submit_id_freeform', verifyToken,  SubmitFreeFormIDController)
router.post('/submit_id', verifyToken,  SubmitIDController)
router.post('/selfie_verification', verifyToken,  SelfieAPIController)
router.post('/signature', verifyToken, SubmitSignatureController)
router.get('/ub_postback', handleUBPostbackController)
router.get('/ub_authorize', verifyToken, getAuthorizationController)
router.post('/ub_verify', verifyToken, verifyUBAccountController)
router.get('/', verifyToken, getKYCDataController)
module.exports = router