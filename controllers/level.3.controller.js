import { createController, generateRequiredSchemaItems } from "./helper"
import { FundsModel } from "../models/funds.schema"
import { FC_ConfigModel } from '../models/fc_config.schema'
import { PartnerCodeModel } from '../models/partner_code.schema'
import { TransactionsFCModel } from '../models/transactions_fc.schema'
import { UserTotalEquityModel } from '../models/user_total_equity.schema'
import {PayoutRequestModel} from "../models/payout_request.schema";
import { TransactionsModel} from "../models/transactions.schema";
import { NavModel } from '../models/nav.schema'
import { Collection, Collectionv2 } from "../utilities/database"
import { tokenKey } from "../config"
import { pipe, zip, of, merge, forkJoin, throwError } from "rxjs"
import { mergeMap } from "rxjs/operators"
import {
	getAccessToken,
	getConfig,
	getDailyNav_PromisedBased,
	updateConfig,
	getDailyNav,
	getTotalEquity,
	getContractNotes,
	getContractNotes_Summary,
	getTradingDates, getPortfolioData, geAUMData, getSMRta, geAUMDataReport
} from '../utilities/fc'
import { splitToChunks, subtractDate, formatDatev2 } from '../utilities'
import moment from 'moment'
import { uploadFile, base64ToBuffer } from '../utilities/upload'
import { generateCode } from "../utilities/security"
import request from "request-promise";
import html_to_pdf from 'html-pdf-node';
import fs from "fs/promises";
import {
	aum_html,
	investment_insights_html, msr_html,
	portfolio_statement_html,
	summary_of_accounts_html
} from "../config/static.html";
import { UserModel } from "../models/user.schema";
import os from "os";

const transactionDB = new Collection(TransactionsModel);
const userDB = new Collection(UserModel)
const funds = new Collection(FundsModel)

const OS_TYPE = os.platform()

const SubscriptionOperation = {
	request_mapper: ( req ) => {
		return {
			body: req.query
		}
	},
	processor: pipe(
		mergeMap( ( props ) => {
			console.log( 'props: ', props )
			return zip(
				of( props )
			)
		} ),
		mergeMap( ( [ props ] ) => {
			return zip( of( props ) )
		} )
	),
	response_mapper: ( req, res ) => ( [ result ] ) => {
		const token = jwt.sign( result, tokenKey, {
			expiresIn: '60h' // testing
			// expiresIn: '60m' //minutes //default
		} )
		res.send( {
			access_token: token,
			expires_in: 3600,
			token_type: 'Bearer',
		} );
	},
}

const redemptionOperation = {
	request_mapper: ( req ) => {
		return {
			body: req.query
		}
	},
	processor: pipe(
		mergeMap( ( props ) => {
			console.log( 'props: ', props )
			return zip(
				of( props )
			)
		} ),
		mergeMap( ( [ props ] ) => {
			return zip( of( props ) )
		} )
	),
	response_mapper: ( req, res ) => ( [ result ] ) => {
		const token = jwt.sign( result, tokenKey, {
			expiresIn: '60h' // testing
			// expiresIn: '60m' //minutes //default
		} )
		res.send( {
			access_token: token,
			expires_in: 3600,
			token_type: 'Bearer',
		} );
	},
}
const reportsOperation = {
	request_mapper: ( req ) => {
		return {
			body: req.query
		}
	},
	processor: pipe(
		mergeMap( ( props ) => {
			console.log( 'props: ', props )
			return zip(
				of( props )
			)
		} ),
		mergeMap( ( [ props ] ) => {
			return zip( of( props ) )
		} )
	),
	response_mapper: ( req, res ) => ( [ result ] ) => {
		const token = jwt.sign( result, tokenKey, {
			expiresIn: '60h' // testing
			// expiresIn: '60m' //minutes //default
		} )
		res.send( {
			access_token: token,
			expires_in: 3600,
			token_type: 'Bearer',
		} );
	},
}
const inquiryOperation = {
	request_mapper: ( req ) => {
		return {
			body: req.query
		}
	},
	processor: pipe(
		mergeMap( ( props ) => {
			console.log( 'props: ', props )
			return zip(
				of( props )
			)
		} ),
		mergeMap( ( [ props ] ) => {
			return zip( of( props ) )
		} )
	),
	response_mapper: ( req, res ) => ( [ result ] ) => {
		const token = jwt.sign( result, tokenKey, {
			expiresIn: '60h' // testing
			// expiresIn: '60m' //minutes //default
		} )
		res.send( {
			access_token: token,
			expires_in: 3600,
			token_type: 'Bearer',
		} );
	},
}
const equityOperation = {
	request_mapper: ( req ) => {
		return {
			body: req.query
		}
	},
	processor: pipe(
		mergeMap( ( props ) => {
			console.log( 'props: ', props )
			return zip(
				of( props )
			)
		} ),
		mergeMap( ( [ props ] ) => {
			return zip( of( props ) )
		} )
	),
	response_mapper: ( req, res ) => ( [ result ] ) => {
		const token = jwt.sign( result, tokenKey, {
			expiresIn: '60h' // testing
			// expiresIn: '60m' //minutes //default
		} )
		res.send( {
			access_token: token,
			expires_in: 3600,
			token_type: 'Bearer',
		} );
	},
}
const transactionsOperation = {
	request_mapper: ( req ) => {
		return {
			body: req.query
		}
	},
	processor: pipe(
		mergeMap( ( props ) => {
			console.log( 'props: ', props )
			return zip(
				of( props )
			)
		} ),
		mergeMap( ( [ props ] ) => {
			return zip( of( props ) )
		} )
	),
	response_mapper: ( req, res ) => ( [ result ] ) => {
		const token = jwt.sign( result, tokenKey, {
			expiresIn: '60h' // testing
			// expiresIn: '60m' //minutes //default
		} )
		res.send( {
			access_token: token,
			expires_in: 3600,
			token_type: 'Bearer',
		} );
	},
}
const statementReportOperation = {
	request_mapper: ( req ) => {
		return {
			body: req.query
		}
	},
	processor: pipe(
		mergeMap( ( props ) => {
			console.log( 'props: ', props )
			return zip(
				of( props )
			)
		} ),
		mergeMap( ( [ props ] ) => {
			return zip( of( props ) )
		} )
	),
	response_mapper: ( req, res ) => ( [ result ] ) => {
		const token = jwt.sign( result, tokenKey, {
			expiresIn: '60h' // testing
			// expiresIn: '60m' //minutes //default
		} )
		res.send( {
			access_token: token,
			expires_in: 3600,
			token_type: 'Bearer',
		} );
	},
}

const InvestmentPortfolioOriginalReportOperation = {
	request_mapper: ( req ) => {
		return {
			body: req.query,
			user: req.middleware_auth
		}
	},
	processor: mergeMap( ( props ) => {
		return of( props ).pipe(
			mergeMap( ( props ) => {
				console.log('props: ', props)
				return zip(
					of( props ),
					userDB.GET_ONE({Email: props.body.user}),
					funds.GET({})
				)
			} ),
			mergeMap( ( [props, user, funds] ) => {
				let parameterDate = `${props.body.month}-01-${props.body.year}`;
				const startDate = moment(parameterDate, "MM-DD-YYYY").startOf('month').format('MMMM DD, YYYY');
				const endDate   = moment(parameterDate, "MM-DD-YYYY").endOf('month').format('MMMM DD, YYYY');
				let fund = [];
				let fundsIdentifier = [];
				let fundActive = [];
				if (props.user.UserLevel == 1) {
					fund = funds;
				}
				else {
					for (let a = 0; a < funds.length; a++) {
						for (let b = 0; b < funds[a].managers.length; b++) {
							if (props.user._id.toString() == funds[a].managers[b].toString()) {
								fund.push(funds[a]);
							}
						}
					}
				}


				for(let a =0;  a<fund.length; a++){
					fundsIdentifier.push(fund[a].FundIdentifier);
				}


				fundActive = fundsIdentifier;

				return zip(
					of( props ),
					of( user ),
					getAccessToken(),
					transactionDB.GET({
						fk_User: user._id,
						Type: 1,
						Date: {
							$gte: new Date(startDate),
							$lt: new Date(endDate),
						}
					}),
					transactionDB.GET({
						fk_User: user._id,
						Type: 2,
						Date: {
							$gte: new Date(startDate),
							$lt: new Date(endDate),
						}
					}),
					of(fundActive)
				)
			} ),
			mergeMap( ( [props, user, token, subscription, redemption, fundActive] ) => {
				let currentYear = new Date().getFullYear();
				let valueArray = [];
				let valueMinusArray = [];
				let dateArray = [];
				let categoryAlloc = []; 
				const mapComputation = (date)=>{
					
					const startOfDate = moment(date).startOf('month');
					const endOfDate = moment(date).endOf('month');
					
					
					let redemptionTotal = 0;
					let subscriptionTotal = 0;
					let subscriptionMinusTotal = 0;
					//redemption
					for(let a =0; a<redemption.length; a++){
						if(moment(redemption[a].processing_dt).isBefore(endOfDate) && moment(redemption[a].processing_dt).isAfter(startOfDate)){
							redemptionTotal += parseInt(redemption[a].Amount);
						}
					}
					

					//subscription
					for(let a=0; a<subscription.length; a++){
						if(moment(subscription[a].Date).isBefore(endOfDate) && moment(subscription[a].Date).isAfter(startOfDate)){
							subscriptionTotal += parseInt(subscription[a].Amount);
							subscriptionMinusTotal += parseInt(subscription[a].Amount) - 20;
						}
					}
					valueArray.push(subscriptionTotal - redemptionTotal - 20)
					valueMinusArray.push(subscriptionMinusTotal)
					dateArray.push(moment(date).format('MMM - YYYY'))
				}

				
				
				for(let a=0; a<12; a++){
					let date = moment(String(currentYear + "0101"), 'YYYY/MM/DD');
					mapComputation(date.add(a, 'months'))
				}

				
				return zip(
					of(props),
					of( {
						valueArray,
						valueMinusArray,
						dateArray
					}),
					getPortfolioData(token.access_token, user.MasterInvestorCode, user.FundCountID, props.body.month, props.body.year),
					of(user),
					of(subscription),
					of(redemption),
					of(fundActive)
				)
			} ),
			mergeMap( async ( [ props, subRedData, data, user, subscription, redemption, funds ] ) => {
				if(data.error)
					return throwError( new Error( `NO DATA` ) )
				let options = { height: '12 in', 
					width: '20 in',
					margin: {
						top: "48px",
						right: "48px",
						bottom: "48px",
						left: "48px",
				  } };
				let fileName = `InvestmentPortfolio-${ Date.now() }.html`;

				let fileLocation = '';
				let outputFile = '';
				let fileURL = '';
				if(OS_TYPE === "win32"){
					fileLocation = 'Z:/Xampp/htdocs/reports/';
					outputFile = `Z:/Xampp/htdocs/reports/Portfolio-Statement-Report-${ Date.now() }.pdf`;
					fileURL = `http://localhost/reports/${ fileName }`
				}else{
					fileLocation = '/var/www/html/reports/';
					outputFile = `/var/www/html/reports/Portfolio-Statement-Report-${ Date.now() }.pdf`;
					fileURL = `http://54.254.120.129/reports/${ fileName }`
				}

				console.log('generating html')
				let parameterDate = `${props.body.month}-01-${props.body.year}`;

				console.log('funds: ', funds)
				console.log('data: ', data)

				let selectedFundData = [];
				for(let a=0; a<funds.length; a++){
					for(let b=0; b<data.result.length; b++){
						if(data.result[b].fund_name.includes('('+funds[a]+')')){
							selectedFundData.push(data.result[b])
						}
					}
				}

				
				await fs.writeFile( `${ fileLocation }${ fileName }`, portfolio_statement_html(data.result, subRedData, user, subscription, redemption, parameterDate, selectedFundData) );
				console.log('done saving html')
				
				const file = { url: fileURL };
				let fileBuffer = null;
				await html_to_pdf.generatePdf( file, options ).then( async pdfBuffer => {
					fileBuffer = pdfBuffer;
				} );
				await fs.writeFile( outputFile, fileBuffer );
				console.log( 'file save...' )
				props.fileData = {
					fileName,
					fileLocation,
					outputFile
				};
				return zip(
					of( props )
				)
			} ),
			mergeMap( () => {
				return zip(
					of( props )
				)
			} )
		)
	} ),
	response_mapper: ( req, res ) => ( [ result ] ) => {
		if(result.fileData)
			res.download( result.fileData.outputFile );
		else
			res.download( "" );
	},
	error_handler: ( _req, res ) => ( err ) => {
		console.log('err: ', err)
		res.download( "" );
	}
}

const InvestmentPortfolioReportOperation = {
	request_mapper: ( req ) => {
		return {
			body: req.query,
			user: req.middleware_auth
		}
	},
	processor: mergeMap( ( props ) => {
		return of( props ).pipe(
			mergeMap( ( props ) => {
				console.log('I am here: ', props)
				return zip(
					of( props ),
					userDB.GET_ONE({Email: props.body.user}),
					funds.GET({})
				)
			} ),
			mergeMap( ( [props, user, funds] ) => {
				let parameterDate = `${props.body.month}-01-${props.body.year}`;
				const startDate = moment(parameterDate, "MM-DD-YYYY").startOf('month').format('MMMM DD, YYYY');
				const endDate   = moment(parameterDate, "MM-DD-YYYY").endOf('month').format('MMMM DD, YYYY');
				let fund = [];
				let fundsIdentifier = [];
				let fundActive = [];
				if (props.user.UserLevel == 1) {
					fund = funds;
				}
				else {
					for (let a = 0; a < funds.length; a++) {
						for (let b = 0; b < funds[a].managers.length; b++) {
							if (props.user._id.toString() == funds[a].managers[b].toString()) {
								fund.push(funds[a]);
							}
						}
					}
				}


				for(let a =0;  a<fund.length; a++){
					fundsIdentifier.push(fund[a].FundIdentifier);
				}


				fundActive = fundsIdentifier;

				return zip(
					of( props ),
					of( user ),
					getAccessToken(),
					transactionDB.GET({
						fk_User: user._id,
						Type: 1,
						Date: {
							$gte: new Date(startDate),
							$lt: new Date(endDate),
						}
					}),
					transactionDB.GET({
						fk_User: user._id,
						Type: 2,
						Date: {
							$gte: new Date(startDate),
							$lt: new Date(endDate),
						}
					}),
					of(fundActive)
				)
			} ),
			mergeMap( ( [props, user, token, subscription, redemption, fundActive] ) => {
				let currentYear = new Date().getFullYear();
				let valueArray = [];
				let valueMinusArray = [];
				let dateArray = [];
				let categoryAlloc = [];
				const mapComputation = (date)=>{

					const startOfDate = moment(date).startOf('month');
					const endOfDate = moment(date).endOf('month');


					let redemptionTotal = 0;
					let subscriptionTotal = 0;
					let subscriptionMinusTotal = 0;
					//redemption
					for(let a =0; a<redemption.length; a++){
						if(moment(redemption[a].processing_dt).isBefore(endOfDate) && moment(redemption[a].processing_dt).isAfter(startOfDate)){
							redemptionTotal += parseInt(redemption[a].Amount);
						}
					}


					//subscription
					for(let a=0; a<subscription.length; a++){
						if(moment(subscription[a].Date).isBefore(endOfDate) && moment(subscription[a].Date).isAfter(startOfDate)){
							subscriptionTotal += parseInt(subscription[a].Amount);
							subscriptionMinusTotal += parseInt(subscription[a].Amount) - 20;
						}
					}
					valueArray.push(subscriptionTotal - redemptionTotal - 20)
					valueMinusArray.push(subscriptionMinusTotal)
					dateArray.push(moment(date).format('MMM - YYYY'))
				}



				for(let a=0; a<12; a++){
					let date = moment(String(currentYear + "0101"), 'YYYY/MM/DD');
					mapComputation(date.add(a, 'months'))
				}


				return zip(
					of(props),
					of( {
						valueArray,
						valueMinusArray,
						dateArray
					}),
					getPortfolioData(token.access_token, user.MasterInvestorCode, user.FundCountID, props.body.month, props.body.year),
					of(user),
					of(subscription),
					of(redemption),
					of(fundActive)
				)
			} ),
			mergeMap( async ( [ props, subRedData, data, user, subscription, redemption, funds ] ) => {
				if(data.error)
					return throwError( new Error( `NO DATA` ) )
				let options = { height: '14 in', width: '18 in' };
				let fileName = `InvestmentPortfolio-${ Date.now() }.html`;

				let fileLocation = '';
				let outputFile = '';
				let fileURL = '';
				if(OS_TYPE === "win32"){
					fileLocation = 'Z:/Xampp/htdocs/reports/';
					outputFile = `Z:/Xampp/htdocs/reports/Portfolio-Statement-Report-${ Date.now() }.pdf`;
					fileURL = `http://localhost/reports/${ fileName }`
				}else{
					fileLocation = '/var/www/html/reports/';
					outputFile = `/var/www/html/reports/Portfolio-Statement-Report-${ Date.now() }.pdf`;
					fileURL = `http://54.254.120.129/reports/${ fileName }`
				}

				console.log('generating html...')
				let parameterDate = `${props.body.month}-01-${props.body.year}`;

				console.log('funds: ', funds)
				console.log('data: ', data)

				let selectedFundData = [];
				for(let a=0; a<funds.length; a++){
					for(let b=0; b<data.result.length; b++){
						if(data.result[b].fund_name.includes('('+funds[a]+')')){
							selectedFundData.push(data.result[b])
						}
					}
				}

				//combine data 

				const dataUncommbine = data.result;

				console.log("dataUncombined: ", dataUncommbine);


				await fs.writeFile( `${ fileLocation }${ fileName }`, portfolio_statement_html(data.result, subRedData, user, subscription, redemption, parameterDate, selectedFundData) );
				console.log('done saving html')

				const file = { url: fileURL };
				let fileBuffer = null;
				await html_to_pdf.generatePdf( file, options ).then( async pdfBuffer => {
					fileBuffer = pdfBuffer;
				} );
				await fs.writeFile( outputFile, fileBuffer );
				console.log( 'file save...' )
				props.fileData = {
					fileName,
					fileLocation,
					outputFile
				};
				return zip(
					of( props )
				)
			} ),
			mergeMap( () => {
				return zip(
					of( props )
				)
			} )
		)
	} ),
	response_mapper: ( req, res ) => ( [ result ] ) => {
		if(result.fileData)
			res.download( result.fileData.outputFile );
		else
			res.download( "" );
	},
	error_handler: ( _req, res ) => ( err ) => {
		console.log('err: ', err)
		res.download( "" );
	}
}
const InvestmentInsightsReportOperation = {
	request_mapper: ( req ) => {
		return {
			body: req.query
		}
	},
	processor: mergeMap( ( props ) => {
		return of( props ).pipe(
			mergeMap( ( props ) => {
				return zip(
					of( props ),
					getAccessToken(),
					userDB.GET_ONE({Email: props.body.user})
				)
			} ),
			mergeMap( ( [props, token, user] ) => {
				return zip(
					of( props ),
					of( user ),
					getPortfolioData(token.access_token, user.MasterInvestorCode, user.FundCountID, props.body.month, props.body.year)
				)
			} ),
			mergeMap( async ( [ props, user, data ] ) => {
				let options = { height: '12 in', width: '20 in', margin: {
					top: "48px",
					right: "48px",
					bottom: "48px",
					left: "48px",
			  } };
				let fileName = `InvestmentInsights-${ Date.now() }.html`;


				let fileLocation = '';
				let outputFile = '';
				let fileURL = '';
				if(OS_TYPE === "win32"){
					fileLocation = 'Z:/Xampp/htdocs/reports/';
					outputFile = `Z:/Xampp/htdocs/reports/InvestmentInsights-${ Date.now() }.pdf`;
					fileURL = `http://localhost/reports/${ fileName }`
				}else{
					fileLocation = '/var/www/html/reports/';
					outputFile = `/var/www/html/reports/InvestmentInsights-${ Date.now() }.pdf`;
					fileURL = `http://54.254.120.129/reports/${ fileName }`
				}
				
				await fs.writeFile( `${ fileLocation }${ fileName }`, investment_insights_html(user, data.result) );
				
				const file = { url: fileURL };
				let fileBuffer = null;
				await html_to_pdf.generatePdf( file, options ).then( async pdfBuffer => {
					fileBuffer = pdfBuffer;
				} );
				await fs.writeFile( outputFile, fileBuffer );
				console.log( 'file save...' )
				props.fileData = {
					fileName,
					fileLocation,
					outputFile
				};
				return zip(
					of( props )
				)
			} ),
			mergeMap( () => {
				return zip(
					of( props )
				)
			} )
		)
	} ),
	response_mapper: ( req, res ) => ( [ result ] ) => {
		if(result.fileData)
			res.download( result.fileData.outputFile );
		else
			res.download( "" );
	},
	error_handler: ( _req, res ) => ( err ) => {
		res.download( "" );
	}
}
const SummaryOfAccountsReportOperation = {
	request_mapper: ( req ) => {
		return {
			body: req.query, 
			user: req.middleware_auth
		}
	},
	processor: mergeMap( ( props ) => {

		return of( props ).pipe(
			
			mergeMap( ( props ) => {
				return zip(
					of( props ),
					getAccessToken(),
					userDB.GET_ONE({
						Email: props.body.user
					}), 
					funds.GET({})
				)
			} ),
			mergeMap( ( [props, token, user, funds] ) => {


				let fund = [];
				let fundsIdentifier = [];
				let fundActive = []; 
				if (props.user.UserLevel == 1) {
					fund = funds;
				} 
				else {
					for (let a = 0; a < funds.length; a++) {
						for (let b = 0; b < funds[a].managers.length; b++) {
							if (props.user._id.toString() == funds[a].managers[b].toString()) {
								fund.push(funds[a]);
							}
						}
					}
				}


				for(let a =0;  a<fund.length; a++){
					fundsIdentifier.push(fund[a].FundIdentifier);
				}


				if(props.body.fund == "all"){
					fundActive = fundsIdentifier;
				}
				else{
					fundActive.push(props.body.fund)
				}

				return zip(
					of(fundActive),
					of( props ),
					of(user),
					getPortfolioData(token.access_token, user.MasterInvestorCode, user.FundCountID, props.body.month, props.body.year)
				)
			} ),
			mergeMap( async ( [funds,  props, user, data ] ) => {

				let selectedFundData = [];
				for(let a=0; a<funds.length; a++){
					for(let b=0; b<data.result.length; b++){
						if(data.result[b].fund_name.includes('('+funds[a]+')')){
							selectedFundData.push(data.result[b])
						}
					}
				}

				let options = { height: '12 in', width: '20 in',margin: {
					top: "48px",
					right: "48px",
					bottom: "48px",
					left: "48px",
			  } };
				let fileName = `SummaryOfAccounts-${ Date.now() }.html`;


				let fileLocation = '';
				let outputFile = '';
				let fileURL = '';
				if(OS_TYPE === "win32"){
					fileLocation = 'Z:/Xampp/htdocs/reports/';
					outputFile = `Z:/Xampp/htdocs/reports/SummaryOfAccounts-${ Date.now() }.pdf`;
					fileURL = `http://localhost/reports/${ fileName }`
				}else{
					fileLocation = '/var/www/html/reports/';
					outputFile = `/var/www/html/reports/SummaryOfAccounts-${ Date.now() }.pdf`;
					fileURL = `http://54.254.120.129/reports/${ fileName }`
				}
				let parameterDate = `${props.body.month}-01-${props.body.year}`;

				// const selectedFundData = data.result.find(
				// 	(o) => o.fund_name.includes('('+props.body.fund+')')
				// );
				if(!!selectedFundData){
					await fs.writeFile( `${ fileLocation }${ fileName }`, summary_of_accounts_html(selectedFundData, user, parameterDate, funds) );
					console.log('b')

					const file = { url: fileURL };
					let fileBuffer = null;
					await html_to_pdf.generatePdf( file, options ).then( async pdfBuffer => {
						fileBuffer = pdfBuffer;
					} );
					await fs.writeFile( outputFile, fileBuffer );
					console.log( 'file save...' )
					props.fileData = {
						fileName,
						fileLocation,
						outputFile
					};
					return zip(
						of( props )
					)
				}else{
					return throwError( new Error( `NO DATA` ) )
				}
			} ),
			mergeMap( () => {
				return zip(
					of( props )
				)
			} )
		)
	} ),
	response_mapper: ( req, res ) => ( [ result ] ) => {
		if(result.fileData)
			res.download( result.fileData.outputFile );
		else
			res.download( "" );
	},
	error_handler: ( _req, res ) => ( err ) => {
		res.download( "" );
	}
}
const AUMReportOperation = {
	request_mapper: ( req ) => {
		return {
			body: req.query,
			user: req.middleware_auth
		}
	},
	processor: mergeMap( ( props ) => {
		console.log('here')
		return of( props ).pipe(
			mergeMap( ( props ) => {
				console.log('here 1', props)
				return zip(
					of( props ),
					getAccessToken(),
					funds.GET({})
				)
			} ),
			mergeMap( ( [props, token, fund_] ) => {
				console.log('here 2')
				let fund = [];
				let fundsIdentifier = [];
				let fundActive = [];
				if (props.user.UserLevel === 1) {
					fund = fund_;
				}
				else {
					for (let a = 0; a < fund_.length; a++) {
						for (let b = 0; b < fund_[a].managers.length; b++) {
							if (props.user._id.toString() === fund_[a].managers[b].toString()) {
								fund.push(fund_[a]);
							}
						}
					}
				}


				for(let a =0;  a<fund.length; a++){
					fundsIdentifier.push({
						id: fund[a].FundIdentifier,
						logo: fund[a].Logo
					});
				}


				if(props.body.fund === "all"){
					fundActive = fundsIdentifier;
				}
				else{
					fundActive.push(fundsIdentifier.find(item=>{ return item.id === props.body.fund }))
				}
				console.log('fundActive: ', fundActive)
				console.log('fundsIdentifier: ', fundsIdentifier)
				return zip(
					of( props ),
					geAUMDataReport(token.access_token, props.body.fund),
					of(fundActive)
				)
			} ),
			mergeMap( async ( [ props, data, funds ] ) => {


				console.log("fundActive: ", funds);

				let selectedFundData = [];
				for(let a=0; a<funds.length; a++){
					for(let b=0; b<data.result.length; b++){
						if(data.result[b].fund_name.includes('('+funds[a].id+')')){
							let temp = {
								...data.result[b],
								logo: funds[a].logo
							}
							selectedFundData.push(temp)
						}
					}
				}
				console.log("selectedFundData: ", selectedFundData);



				let options = { height: '12 in', width: '20 in', margin: {
					top: "48px",
					right: "48px",
					bottom: "48px",
					left: "48px",
			  } };
				let fileName = `aum-${ Date.now() }.html`;


				let fileLocation = '';
				let outputFile = '';
				let fileURL = '';
				if(OS_TYPE === "win32"){
					fileLocation = 'Z:/Xampp/htdocs/reports/';
					outputFile = `Z:/Xampp/htdocs/reports/AUM-${ Date.now() }.pdf`;
					fileURL = `http://localhost/reports/${ fileName }`
				}else{
					fileLocation = '/var/www/html/reports/';
					outputFile = `/var/www/html/reports/AUM-${ Date.now() }.pdf`;
					fileURL = `http://54.254.120.129/reports/${ fileName }`
				}
				
				await fs.writeFile( `${ fileLocation }${ fileName }`, aum_html(selectedFundData, props) );
				
				const file = { url: fileURL };
				let fileBuffer = null;
				await html_to_pdf.generatePdf( file, options ).then( async pdfBuffer => {
					fileBuffer = pdfBuffer;
				} );
				await fs.writeFile( outputFile, fileBuffer );
				console.log( 'file save...' )
				props.fileData = {
					fileName,
					fileLocation,
					outputFile
				};
				return zip(
					of( props )
				)
			} ),
			mergeMap( () => {
				return zip(
					of( props )
				)
			} )
		)
	} ),
	response_mapper: ( req, res ) => ( [ result ] ) => {

		console.log("result: ", result); 

		if(result.fileData)
			res.download( result.fileData.outputFile );
		else
			res.download( "" );
	},
	error_handler: ( _req, res ) => ( err ) => {
		console.log('err: ', err)
		res.download( "" );
	}
}
const MSRReportOperation = {
	request_mapper: ( req ) => {
		return {
			body: req.query
		}
	},
	processor: mergeMap( ( props ) => {
		return of( props ).pipe(
			mergeMap( ( props ) => {
				console.log( 'props: ', props )
				return zip(
					of( props ),
					getAccessToken()
				)
			} ),
			mergeMap( ( [props, token] ) => {

				console.log(props); 

				return zip(
					of( props ),
					getSMRta(token.access_token, props.body.fund, props.body.duration),
					funds.GET({
						FundIdentifier: props.body.fund
					})
				)
			} ),
			mergeMap( async ( [ props, data, fund ] ) => {

				console.log("data: ", data);
				console.log("fund: ", fund);

				let options = { height: '12 in', width: '20 in',margin: {
					top: "48px",
					right: "48px",
					bottom: "48px",
					left: "48px",
			  	} };
				let fileName = `msr-${ Date.now() }.html`;

				let fileLocation = '';
				let outputFile = '';
				let fileURL = '';
				if(OS_TYPE === "win32"){
					fileLocation = 'Z:/Xampp/htdocs/reports/';
					outputFile = `Z:/Xampp/htdocs/reports/MSR-${ Date.now() }.pdf`;
					fileURL = `http://localhost/reports/${ fileName }`
				}else{
					fileLocation = '/var/www/html/reports/';
					outputFile = `/var/www/html/reports/MSR-${ Date.now() }.pdf`;
					fileURL = `http://54.254.120.129/reports/${ fileName }`
				}
				
				await fs.writeFile( `${ fileLocation }${ fileName }`, msr_html(data.result, fund[0].Logo) );
				
				const file = { url: fileURL };
				let fileBuffer = null;
				await html_to_pdf.generatePdf( file, options ).then( async pdfBuffer => {
					fileBuffer = pdfBuffer;
				} );
				await fs.writeFile( outputFile, fileBuffer );
				console.log( 'file save...' )
				props.fileData = {
					fileName,
					fileLocation,
					outputFile
				};
				return zip(
					of( props )
				)
			} ),
			mergeMap( () => {
				return zip(
					of( props )
				)
			} )
		)
	} ),
	response_mapper: ( req, res ) => ( [ result ] ) => {
		if(result.fileData)
			res.download( result.fileData.outputFile );
		else
			res.download( "" );
	},
	error_handler: ( _req, res ) => ( err ) => {
		res.download( "" );
	}
}
const navRatesOperation = {
	request_mapper: ( req ) => {
		return {
			body: req.query
		}
	},
	processor: pipe(
		mergeMap( ( props ) => {
			const options = {
				'method': 'GET',
				'url': 'http://localhost:3001/api/daily-nav?fund_identifier=UBX',
				'headers': {
					'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJib2R5Ijp7ImdyYW50X3R5cGUiOiJjbGllbnRfY3JlZGVudGlhbHMiLCJzY29wZSI6Im1iZy1hcGkifSwiaWF0IjoxNjU4NDY1ODU0LCJleHAiOjE2NTg2ODE4NTR9.FKiDu38Kby4IrEwgcwK66jbpTEACMLYou6azY03Pw-c'
				}
			};
			return zip(
				request( options )
			)
		} ),
		mergeMap( ( [ dailyNav ] ) => {
			return zip( of( JSON.parse( dailyNav ) ) )
		} )
	),
	response_mapper: ( req, res ) => ( [ dailyNav ] ) => {
		res.send( {
			...dailyNav,
			success: true
		} );
	},
}

const portfolioPerformanceOperation = {
    request_mapper: (req) => {
        return req.query; 
    },
    processor: pipe(
		mergeMap((props) =>{

			console.log("props: ", props.user); 

			return zip (
				getAccessToken(), 
				userDB.GET_ONE({
					Email: props.user
				})
			)
		}),
        mergeMap(([token, user]) => {

			console.log("user: ", user)
            return zip(
                getPortfolioData(token.access_token, user.MasterInvestorCode)
            )
        }), 


    ), 
    response_mapper: (req, res) =>  ([data]) => {
		console.log(data); 
		
        res.send(data);
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

export const SubscriptionController = createController( SubscriptionOperation )
export const RedemptionController = createController( redemptionOperation )
export const ReportsController = createController( reportsOperation )
export const InquiryController = createController( inquiryOperation )
export const EquityController = createController( equityOperation )
export const TransactionsController = createController( transactionsOperation )
export const StatementReportController = createController( statementReportOperation )
export const NavRatesController = createController( navRatesOperation )
export const InvestmentPortfolioOriginalReportController = createController( InvestmentPortfolioOriginalReportOperation )
export const InvestmentPortfolioReportController = createController( InvestmentPortfolioReportOperation )
export const InvestmentInsightsReportController = createController( InvestmentInsightsReportOperation )
export const SummaryOfAccountsReportController = createController( SummaryOfAccountsReportOperation )
export const AUMReportController = createController( AUMReportOperation )
export const MSRReportController = createController( MSRReportOperation )
export const portfolioPerformanceController = createController(portfolioPerformanceOperation)
