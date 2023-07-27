import { createController, generateRequiredSchemaItems } from "./helper"
import { educModuleModel } from "../models/education_module.schema"
import { Collection, Collectionv2 } from "../utilities/database"
import { tokenKey } from "../config"
import { pipe, zip, of, merge, forkJoin, throwError } from "rxjs"
import { mergeMap, retry } from "rxjs/operators"
import { getAccessToken, getConfig, getDailyNav_PromisedBased, updateConfig, getDailyNav, getTotalEquity, getContractNotes, getContractNotes_Summary, getTradingDates } from '../utilities/fc'
import { splitToChunks, subtractDate, formatDatev2 } from '../utilities'
import moment from 'moment'
import request from "request-promise";
import { ResultSet } from "mathjs/lib/cjs/entry/pureFunctionsAny.generated"

const jwt = require('jsonwebtoken');


const educModule = new Collection(educModuleModel)


/* this function will get all the education module 
*/
const getEducModule = {
	processor: pipe(
		mergeMap((props) => {
            return zip(
                educModule.GET({})
            )
		}),
	),
	response_mapper: (req, res) =>  (result) => {
        console.log("result: ", result)
		res.send(result);
	},
    error_handler: (_req, res) => (err) => {

        let status = 400
        console.log(err)

        if(err.message == "NO DATA"){
            err.message = "No Param Found";
        }
        else if (err.message === 'UNAUTHORIZED') {
            status = 403;
        } else {
            err.message = 'Something went wrong';
        }

        res.status(status).json({
            code: status,
            status: "failed",
            message: err.message
        })
    }
}




/* This function will update the education module by id 
*/
const updateEducModule = {
	request_mapper: (req) => {
        return req.body; 
	},
	processor: pipe(
		mergeMap((props) => {
            console.log("props: ", props); 
            return zip(
                of(props),
                educModule.GET_ONE({_id: props._id})
            )
		}), 
        mergeMap(([props, res])=>{
            if(!res){
                return throwError(new Error('NO DATA'))
            }
            else{
                //update
                return zip(
                    of(props),
                    educModule.UPDATE({
                        identifier: {
                            _id: props._id,
                        },
                        data: {
                            ArticleName: props.ArticleName,
                            Modules: props.Modules
                        }
                    })
                )
            }
        }), 
        mergeMap(([props, res])=>{

            console.log("res: ", res); 
            return zip(
                educModule.GET({
                    _id: props._id
                })
            )
        })
	),
	response_mapper: (req, res) =>  (result) => {
		res.send({
            success: true, 
            message: "successfully updated"
        });
	},
    error_handler: (_req, res) => (err) => {

        let status = 400
        console.log(err)

        if(err.message == "NO DATA"){
            err.message = "This Id did not exist";
        }
        else if (err.message === 'UNAUTHORIZED') {
            status = 403;
        } else {
            err.message = 'Something went wrong';
        }

        res.status(status).json({
            code: status,
            status: "failed",
            message: err.message
        })
    }
}

const addEducModule = {
    request_mapper: (req) => {
        return req.body; 
	},
	processor: pipe(
		mergeMap((props) => {

        console.log("props: ", props.Modules); 

            return zip(
                educModule.ADD({
                    ArticleName: props.ArticleName,
                    Modules: props.Modules, 
                    UpdatedAt: moment().format('YYYY-MM-DD'),
                    CreatedAt: moment().format('YYYY-MM-DD')
                })
            )
		})
	),
	response_mapper: (req, res) =>  (result) => {
		res.send({
            success: true, 
            message: "successfully saved"
        });
	},
    error_handler: (_req, res) => (err) => {

        let status = 400
        console.log(err)

        if(err.message == "NO DATA"){
            err.message = "This Id did not exist";
        }
        else if (err.message === 'UNAUTHORIZED') {
            status = 403;
        } else {
            err.message = 'Something went wrong';
        }

        res.status(status).json({
            code: status,
            status: "failed",
            message: err.message
        })
    }
}


const getModuleOperation = {
    request_mapper: (req) => {
        return req.query; 
	},
	processor: pipe(
		mergeMap((props) => {
            return zip(
                of(props), 
                educModule.GET({})
            );
		}),
        mergeMap(([props, educModule]) => {

            let module = []; 
            for(let a =0; a<educModule.length; a++){
                for(let b =0;b<educModule[a].Modules.length; b++){
                    if(educModule[a].Modules[b].Name == props.Module){
                        module.push(educModule[a].Modules[b]);
                    }
                }
            }
            return zip(
                of(module)
            );
		}),
	),
	response_mapper: (req, res) =>  (result) => {
		res.send(result);
	},
    error_handler: (_req, res) => (err) => {

        let status = 400
        console.log(err)

        if(err.message == "NO DATA"){
            err.message = "This Id did not exist";
        }
        else if (err.message === 'UNAUTHORIZED') {
            status = 403;
        } else {
            err.message = 'Something went wrong';
        }

        res.status(status).json({
            code: status,
            status: "failed",
            message: err.message
        })
    }
}

const deleteEducModule = {
   request_mapper: (req) => {
        return {
			...req.body,
      
			...req.query
		}
	},
	processor: pipe(
		mergeMap((props) => {

            console.log("props: ", props); 
            //check the id
            return zip(
                of(props), 
                educModule.GET_ONE({
                    _id: props._id
                })
            )
		}), 
        mergeMap(([props, exist])=>{
            
            console.log("exist: ", exist); 

            if(!exist) return throwError(new Error('NO DATA'))
            return zip(
                educModule.DELETE_ONE({
                    _id: props._id
                })
            )
        })
	),
	response_mapper: (req, res) =>  (result) => {
		res.send("Successfully deleted!");
	},
    error_handler: (_req, res) => (err) => {

        let status = 400
        console.log(err)

        if(err.message == "NO DATA"){
            err.message = "This Id did not exist";
        }
        else if (err.message === 'UNAUTHORIZED') {
            status = 403;
        } else {
            err.message = 'Something went wrong';
        }

        res.status(status).json({
            code: status,
            status: "failed",
            message: err.message
        })
    }
}


const getChapterOperation = {
    request_mapper: (req) => {
        return req.query; 
	},
	processor: pipe(
		mergeMap((props) => {
            return zip(
                of(props), 
                educModule.GET({})
            );
		}),
        mergeMap(([props, educModule]) => {
            let article = []; 
            for(let a =0; a<educModule.length; a++){
                if(educModule[a].ArticleName == props.Article){
                    article.push(educModule[a]);
                }
            }
            return zip(
                of(article)
            );
		}),
	),
	response_mapper: (req, res) =>  (result) => {
		res.send(result);
	},
    error_handler: (_req, res) => (err) => {

        let status = 400
        console.log(err)

        if(err.message == "NO DATA"){
            err.message = "This Id did not exist";
        }
        else if (err.message === 'UNAUTHORIZED') {
            status = 403;
        } else {
            err.message = 'Something went wrong';
        }

        res.status(status).json({
            code: status,
            status: "failed",
            message: err.message
        })
    }
}

const getPageOperation = {
    request_mapper: (req) => {
        return req.query; 
	},
	processor: pipe(
		mergeMap((props) => {
            return zip(
                of(props), 
                educModule.GET({})
            );
		}),
        mergeMap(([props, educModule]) => {
            
            let book = []; 
            for(let a=0; a<educModule.length; a++){
                if(educModule[a].ArticleName == props.Article){
                    for(let b=0; b<educModule[a].Modules.length; b++){
                        if(educModule[a].Modules[b].Name == props.Module){
                            for(let c=0; c<educModule[a].Modules[b].Pages.length; c++){
                                if(educModule[a].Modules[b].Pages[c].Pagenum == String(props.Page)){
                                    book.push(educModule[a].Modules[b])
                                }
                            }
                        }
                    }
                }
            }

            console.log(book); 

            return zip(of(book));
		}),
	),
	response_mapper: (req, res) =>  (result) => {
		res.send(result);
	},
    error_handler: (_req, res) => (err) => {

        let status = 400
        console.log(err)

        if(err.message == "NO DATA"){
            err.message = "This Id did not exist";
        }
        else if (err.message === 'UNAUTHORIZED') {
            status = 403;
        } else {
            err.message = 'Something went wrong';
        }

        res.status(status).json({
            code: status,
            status: "failed",
            message: err.message
        })
    }
}









export const getEducModuleController = createController(getEducModule); 
export const updateEducModuleController = createController(updateEducModule); 
export const addEducModuleController = createController(addEducModule);
export const deleteModuleController = createController(deleteEducModule);
export const getModuleController = createController(getModuleOperation);
export const getChapterController = createController(getChapterOperation);
export const getPageController = createController(getPageOperation);


