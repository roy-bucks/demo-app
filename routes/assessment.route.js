import {
	GetAssessmentScoreController,
	GetAssessmentQuestionsController,
} from '../controllers/assessment.controller'
import { verifyToken, verifyApiKey, verifyBankToken } from "../middleware/authentication"

const express = require("express")
const router = new express.Router()


router.get('/', verifyToken, GetAssessmentScoreController);


//exposed to wrapper
router.get('/questions', verifyBankToken, GetAssessmentQuestionsController);


module.exports = router
