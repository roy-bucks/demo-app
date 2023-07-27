import { 
  UpdateGeneralSettingsController,
  UpdateTierLimitsController,
  UpdateTransactionFeesController,
  GetGeneralSettingsController
} from '../controllers/data_management.controller'
import passport from 'passport'
import { verifyToken, verifyApiKey } from "../middleware/authentication"

const express = require("express")
const router = new express.Router()


router.put('/general', verifyToken, UpdateGeneralSettingsController)
router.put('/tierlimit', verifyToken, UpdateTierLimitsController)
router.put('/transaction', verifyToken, UpdateTransactionFeesController)
router.get('/', verifyApiKey, GetGeneralSettingsController)
module.exports = router