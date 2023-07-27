import { 
  AddFAQController,
  GetFAQsController,
} from '../controllers/faq.controller'
import passport from 'passport'
import { verifyToken } from "../middleware/authentication"

const express = require("express")
const router = new express.Router()


router.post('/', verifyToken, AddFAQController)
router.get('/', verifyToken, GetFAQsController)
module.exports = router