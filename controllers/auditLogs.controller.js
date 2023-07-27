import { createController, generateRequiredSchemaItems } from "./helper"
import { AuditLogsModel } from "../models/audit_logs.schema"
import { Collection, Collectionv2 } from "../utilities/database"
import { tokenKey } from "../config"
import { pipe, zip, of, merge, forkJoin, throwError } from "rxjs"
import { mergeMap } from "rxjs/operators"
import { getAccessToken, getConfig, getDailyNav_PromisedBased, updateConfig, getDailyNav, getTotalEquity, getContractNotes, getContractNotes_Summary, getTradingDates } from '../utilities/fc'
import { splitToChunks, subtractDate, formatDatev2 } from '../utilities'
import moment from 'moment'
import request from "request-promise";

const jwt = require('jsonwebtoken');


const auditLogs = new Collection(AuditLogsModel)



const auditLogsCreate = {
	request_mapper: (req) => {

		return {
			body: req.body, 
            user_name: req.middleware_auth.Email
		}
	},
	processor: pipe(
		mergeMap((props) => {
            
            //check the props
            if(Object.keys(props.body).length === 0){
                return throwError(new Error('NO DATA'))
            }
            //save it
            return zip(
                of(props),
                auditLogs.ADD({
                    fk_User: props.body.fk_user, 
                    Module: props.body.module,
                    Activity: props.body.activity,
                    Date: props.body.date, 
                    Username: props.user_name, 
                    Type: props.body.type, 
                    ActionPerformed: props.body.action_performed
                })
            )
		}),
        mergeMap(([props, res]) => {
             if(res){
                return zip(
                        auditLogs.GET({})
                    ) 
             }
             else{
                return throwError(new Error('Something went wrong'))
             }
        }),
	),
	response_mapper: (req, res) =>  ([result]) => {
		res.send({
			data: result,
		});
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


const auditLogsGet = {
	processor: pipe(
        mergeMap((props) => {
            return zip(
                auditLogs.GET()
            ) 
        }),
	),
	response_mapper: (req, res) =>  ([result]) => {
		res.send({
			data: result,
		});
	},
}


const searchAuditLogs = {
    request_mapper: (req) => {
		return {
			body: req.query
		}
	},
	processor: pipe(
		mergeMap((props) => {

            console.log("props: ", props); 
            console.log("date: ", new Date(props.body.fromDate));


            if(Object.keys(props.body).length === 0){
                return throwError(new Error('NO DATA'))
            }

            let searchparamkey = []; 
            let searchparamdate = []; 
            let searchquery = [];
            let query; 
            if(props.body.fromDate !== undefined && props.body.toDate !== undefined){
                searchparamdate.push(
                { 
                    Date: {
                        $gte: moment(new Date(props.body.fromDate)),
                        $lt: moment(new Date(props.body.toDate)),
                    }
                })
                searchquery.push(searchparamdate[0])
            }

            if(props.body.key !== undefined){
                searchparamkey.push(
                    { Activity: { '$regex': props.body.key, '$options': 'i' } },
                    { Module: { '$regex': props.body.key, '$options': 'i' } }, 
                    { Type: { '$regex': props.body.key, '$options': 'i' } },
                    { ActionPerformed: { '$regex': props.body.key, '$options': 'i' } }, 
                    { Username: { '$regex': props.body.key, '$options': 'i' } },
                )

                for(let a=0; a<searchparamkey.length; a++){
                    searchquery.push(searchparamkey[a]);
                }
            }
            if(props.body.fromDate !== undefined && props.body.toDate !== undefined && props.body.key !== undefined){
                query = {
                    "$and": [
                        {"$or": searchparamkey},
                        {Date: {
                            $gte: moment(new Date(props.body.fromDate)),
                            $lt: moment(new Date(props.body.toDate)),
                        }}
                    ]
                }
            }
            else{
                query = {
                    "$or": searchquery
                }
            }
            return zip(
                of(props), 
                auditLogs.GET(query)
            )
		}),
	),
	response_mapper: (req, res) =>  ([props,  result]) => {

        console.log(result); 
		res.send({
			data: result,
		});
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



export const createAuditLogsController = createController(auditLogsCreate); 
export const getAuditLogsController = createController(auditLogsGet); 
export const searchAuditLogsController = createController(searchAuditLogs); 

