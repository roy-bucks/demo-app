import { 
    createWalkthroughController,
    updateWalkthroughController, 
    getWalkthroughController
} from '../controllers/walkthrough.controller'

import { 
    getGpWalkthroughController, 
  } from '../controllers/assessment.controller'

import passport from 'passport'
import { verifyBankToken, verifyBankUserToken, verifyBankWithUserToken,  verifyToken } from "../middleware/authentication"


const express = require("express")
const router = new express.Router()


//get walkthrough | exposed  from wrapper
router.get('/', verifyBankToken, getWalkthroughController); 

//not exposed from wrapper
router.post('/create', verifyBankUserToken, createWalkthroughController)
router.patch('/update', verifyBankUserToken, updateWalkthroughController)


//walkthrough goal  planning
router.get('/goal-planning/get', verifyBankUserToken, getGpWalkthroughController);

module.exports = router