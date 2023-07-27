import { 

    getEducModuleController, 
    addEducModuleController, 
    updateEducModuleController, 
    deleteModuleController, 
    getModuleController, 
    getChapterController, 
    getPageController
    
} from '../controllers/education_module.controller'


import passport from 'passport'
import { verifyBankToken, verifyBankUserToken, verifyBankWithUserToken, verifyToken } from "../middleware/authentication"


const express = require("express")
const router = new express.Router()


router.get('/', verifyToken, getEducModuleController); 
router.patch('/update', verifyToken, updateEducModuleController); 
router.post('/add', verifyToken, addEducModuleController); 
router.delete('/delete', verifyToken, deleteModuleController); 


//wrapper 
router.get('/all', verifyBankToken, getEducModuleController); 
router.get('/module', verifyBankToken, getModuleController);
router.get('/chapter', verifyBankToken, getChapterController);
router.get('/page', verifyBankToken, getPageController); 


module.exports = router