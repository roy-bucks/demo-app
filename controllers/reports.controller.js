import { createController } from "./helper"
import { Collection, Collectionv2 } from "../utilities/database"
import { pipe, zip, of, merge, throwError, forkJoin } from "rxjs"
import { mergeMap } from "rxjs/operators"
import { NavModel } from "../models/nav.schema";
import { FundsModel } from "../models/funds.schema";
import moment from "moment/moment";
import { SettingsModel } from "../models/settings.schema";
import {TransactionsModel} from "../models/transactions.schema";
import { TranscriptionPage } from "twilio/lib/rest/api/v2010/account/transcription";


const transacCollection = new Collection(TransactionsModel);
const navCollection = new Collection(NavModel)
const Navs_ = new Collectionv2(NavModel)
const fundsCollection = new Collection(FundsModel)
const settingsCollection = new Collection(SettingsModel)

const getInquiryReportOperation = {
	request_mapper: (req) => {
		return {
			body: {
				...req.body,
				...req.query
			},
		}
	},
	processor: pipe(
		mergeMap((props) => {
			return zip(
				of({})
			)
		})
	),
	response_mapper: (req, res) => ([funds]) => {
		res.send({
			message: 'success'
		})
	},
	error_handler: (_req, res) => (err) => {
		let status = 500
		
		console.log(err)
		res.status(status).json({
			code: status,
			status: "failed",
			message: err.message
		})
	}
}

/* Map all the user in the transaction
*/
const getInsightsReportOperation = {
	request_mapper: (req) => {
		return {
			bankUser: req.bankUser || req.middleware_auth
		}
	},
	processor: pipe(
		mergeMap((props) => {
			console.log(props)
			// let fkUser = props.bankUser._id;
			//For test purpose
			let fkUser = "607e7e3099f738510846fc10";
			return zip(
				of(props.bankUser),
				transacCollection.GET({fk_User: fkUser}),
				fundsCollection.GET()
			)
		}),
		mergeMap(([user, transactions, funds]) => {

			console.log("user: ", user);


			let rawData = [];
			for(let a=0; a<transactions.length; a++){
				rawData.push({
					fk_fund: String(transactions[a].fk_Fund),
					amount: transactions[a].Amount
				})
			}

			let unique = [...new Set(rawData.map(item => item.fk_fund))];
			let transactionData = [];

			for(let b =0; b<unique.length; b++){
				let trs_Amount = 0;
				for(let c =0; c<rawData.length; c++){
					if(unique[b] == rawData[c].fk_fund){
						trs_Amount += parseInt(rawData[c].amount);
					}
				}
				transactionData.push({
					fk_Fund: unique[b],
					amount: trs_Amount
				})
			}

			const ins_data = [];
			for(let a=0; a<transactionData.length; a++){
				let fund_Identifier = '';
				for(let b=0; b<funds.length; b++){
					if(transactionData[a].fk_Fund == funds[b]._id){
						fund_Identifier = funds[b].FundIdentifier;
					}
				}
				ins_data.push({
					fk_Id: transactionData[a].fk_Fund,
					fund_Identifier: fund_Identifier,
					investment: transactionData[a].amount,
					current_value: [], //to update
					absolute_return: [], //to update
				})
			}


			//Total computation
			let total_investment = 0;
			for(let a=0; a<ins_data.length; a++){
				total_investment += ins_data[a].investment;
			}

			return zip(
				of({
					schema_category: ins_data,
					category_allocation: {
						equity_banking: 0,
						debit_liquid: 0,
						equity_int: 0,
						tax_saver: 0
					},
					total: {
						total_investment: total_investment,
						total_current_value: 0,
						total_absolute_returns: 0
					},
					user: {
						bank_id: user.bankId,
						accountNo: user.AccountNo,
						email: user.Email,
						first_name: user.FirstName,
						last_name: user.LastName,
						mobile_number: user.MobileNo,
						nationality: user.Nationality,
					}
				})
			)
		})
	),
	response_mapper: (req, res) => ([insights]) => {
		res.send(insights);
	},
	error_handler: (_req, res) => (err) => {
		let status = 500
		
		console.log(err)
		res.status(status).json({
			code: status,
			status: "failed",
			message: err.message
		})
	}
}


const getDataAllocationOperation = {
	request_mapper: (req) => {
        return req.query; 
    },
    processor: pipe(
        mergeMap((props) => {


			console.log("props: ", props); 


            return zip(
                of("ok"),
            )
        }), 
    ), 
    response_mapper: (req, res) =>  ([data]) => {
        res.send("yea");
    },
    error_handler: (_req, res) => (err) => {

        let status = 400
        console.log(err)

        if(err.message == "payloadError"){
            err.message = "Invalid payload";
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



export const GetInquiryReportController = createController(getInquiryReportOperation)
export const GetInsightsReportController = createController(getInsightsReportOperation)
export const GetDataAllocationController = createController(getDataAllocationOperation)
