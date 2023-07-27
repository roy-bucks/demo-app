import { createController, generateRequiredSchemaItems } from "./helper"
import {FundsModel } from "../models/funds.schema";
import {PayoutRequestModel} from "../models/payout_request.schema"; 
import { TransactionsModel} from "../models/transactions.schema"; 
import { Collection, Collectionv2 } from "../utilities/database"
import { config } from "../config/fc_config";

// import { mapfunds} from "../utilities/cashflow"
// import { tokenKey } from "../config"
import { pipe, zip, of, merge, forkJoin, throwError } from "rxjs"
import { mergeMap, retryWhen } from "rxjs/operators"
import { getAccessToken, getConfig, getDailyNav_PromisedBased, updateConfig, getDailyNav, getTotalEquity, getContractNotes, getContractNotes_Summary, getTradingDates } from '../utilities/fc'
import { splitToChunks, subtractDate, formatDatev2 } from '../utilities'
import moment from 'moment'
import request from "request-promise";
import { createHelpClass } from "mathjs/lib/cjs/factoriesAny";
import { stringify } from "qs";
import { map } from "mathjs/lib/cjs/entry/pureFunctionsAny.generated";
import { ConstantNode } from "mathjs/lib/cjs/entry/impureFunctionsAny.generated";
import { async } from "validate.js";

const jwt = require('jsonwebtoken');
const ObjectId = require('mongodb').ObjectId; 


const funds = new Collection(FundsModel);
const redemption = new Collection(PayoutRequestModel); 
const subscription = new Collection(TransactionsModel); 


const getcashflow = {
    request_mapper: (req) => {

        console.log(" I am here"); 

        return{
            props: req.query, 
            user: req.middleware_auth
        }
	},
	processor: pipe(

        //payload validation 
		mergeMap((param) => {

            let props = param.props;
            let userId = param.user._id.toString();
            let userlevel = param.user.UserLevel;

            const date = moment(new Date(props.Date)); 
            if(! date.isValid()) return throwError(new Error('INVALID PAYLOAD'))
            return zip(
                of(date), 
                of(userId), 
                of(userlevel),
                funds.GET({}), 
            )
		}), 

        //decision 
        mergeMap(([date, userId, userlevel, fund]) => {


            console.log("funds: ", fund); 
            let funds = []; 

            //admin 
            if(userlevel == 1 ){
                funds = fund;
            }
            else{
                for(let a =0; a<fund.length; a++){
                    for(let b=0; b<fund[a].managers.length; b++){
                        if(userId == String(fund[a].managers[b])){
                            funds.push(fund[a])
                        }
                    }
                }
            }

            let fundClass = [...new Set(funds.map(item => item.FundClass))]

            return zip(
                of(date),
                of(funds),
                of(fundClass)
                
            )
        }),

        //Map the funds 
        mergeMap(([date, funds, fundClass]) => {

            const mapFunds = [...new Map(funds.map(item => [item["FundIdentifier"], item])).values()]; 
            return zip(
                of(date), 
                of(mapFunds), 
                redemption.GET({RedemptionData: {$ne: null}}), 
                subscription.GET({SubscriptionData: {$ne: null}}), 
                of(fundClass)
            )
        }), 
        //Map Redemption and Subscription and compute 
        mergeMap(([date, funds, redemption, subscription, fundClass]) => {


            const mapComputation = (alterdate, fundsId, leadTime)=>{
                const startOfDate = moment(alterdate).startOf('day');
                const endOfDate = moment(alterdate).endOf('day');

                //map the redemption 
                //Only Get  the the data status 'S' means processed

                let totalRedemption = 0; 
                let totalSubscription = 0; 

                for(let a =0; a<redemption.length; a++){
                    if(moment(redemption[a].RedemptionData.data.processing_dt).isBefore(endOfDate) && moment(redemption[a].RedemptionData.data.processing_dt).isAfter(startOfDate)){
                        if(String(redemption[a].fk_Fund) == fundsId){
                            totalRedemption += parseInt(redemption[a].RedemptionData.data.amount); 
                        }
                    }
                }

                //map  the subscription 
                //Only get the data status 'S' means success 
                for(let a=0; a<subscription.length; a++){
                    if(moment(subscription[a].Date).isBefore(endOfDate) && moment(subscription[a].Date).isAfter(startOfDate)){
                        if(String(subscription[a].fk_Fund) == fundsId){
                            totalSubscription += parseInt(subscription[a].Amount); 
                        }
                    }
                } 
            
                return{
                    totalRedemption: totalRedemption, 
                    totalSubscription: totalSubscription,
                    Date: moment(endOfDate).add(parseInt(leadTime), 'days'),
                    Amount: parseInt(totalSubscription) - parseInt(totalRedemption), 
                }
            }


            //Time Series 
            const Forecast = (Date, leadTime, fundsID)=>{

                const forecast = {}; 
                
                //for default series 
                for(let a=-2; a<0; a++){
                    const defaultDate = moment(Date); 
                    const alterdate = defaultDate.add(a, 'days');
                    forecast[String('T' +a)] =  mapComputation(alterdate, fundsID, 0); 
                }

                //today series 
                forecast['T0'] =  mapComputation(Date, fundsID, 0); 

                //series for leadtime 
                for(let a=1; a<=leadTime; a++){
                    const defaultDate = moment(Date); 
                    const alterdate = defaultDate.add(a, 'days');
                    forecast['T' +a] = mapComputation(alterdate, fundsID, leadTime); 
                }

                return forecast; 
            }

            
            //Funds Data 
            const data = []; 

            for(let b=0; b<fundClass.length; b++){

                let Funddata = []; 
                for(let a=0; a<funds.length; a++){
                    if(fundClass[b] == funds[a].FundClass){
                        Funddata.push({
                            "Fund": funds[a].FundIdentifier, 
                            "fk_Fund": funds[a]._id, 
                            "lead_Time": parseInt(funds[a].LeadTime), 
                            "Forecast": Forecast(date, parseInt(funds[a].LeadTime), String(funds[a]._id))
                        })
                    }
                }

                data.push({
                    fundClass: fundClass[b], 
                    data: Funddata
                })
            }
            

            const cashflow = {
                Date: date, 
                Data: data
            }

            return zip(
                of(cashflow)
            )
           
        })
	),
	response_mapper: (req, res) =>  ([cashflow]) => {

		res.send(cashflow); 
	},
    error_handler: (_req, res) => (err) => {

        let status = 400
        console.log(err)

        if(err.message == "INVALID PAYLOAD"){
            err.message = "Error on payload, make sure it is valid date";
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


const getcashflowperTransac = {

    request_mapper: (req) => {
        return req.query; 
	},
    processor: pipe(

        //payload validation 
		mergeMap((props) => {

            const date = moment(new Date(props.Date)); 
            if(! date.isValid() && ! props.fund_Id) return throwError(new Error('INVALID PAYLOAD')); 

            return zip(
                of(props),
                of(date), 
                funds.GET({FundIdentifier: props.FundIdentifier})
            )
		}), 
        //Map the funds | get the specific funds 
        mergeMap(([props, date, funds]) => {

            console.log("props: ",funds[0]._id )
            return zip(
                of(date), 
                of(funds),
                redemption.GET({fk_Fund: funds[0]._id, RedemptionData: {$ne: null}}), 
                subscription.GET({fk_Fund: funds[0]._id, SubscriptionData: {$ne: null}})
            )
        }), 

        //Map Redemption and Subscription and compute 
        mergeMap(([date, funds, redemption, subscription]) => {

            
            const mapComputation = (leadCount, alterdate, fund_id, leadTime) => {
                let data = [];
                const startOfDate = moment(alterdate).startOf('day');
                const endOfDate = moment(alterdate).endOf('day'); 

                if(leadCount < 1){

                    //first transaction
                    let total = 0; 
                    let count = []; 

                    for(let a =0; a<redemption.length; a++){
                        if(moment(redemption[a].RedemptionData.data.processing_dt).isBefore(endOfDate) && moment(redemption[a].RedemptionData.data.processing_dt).isAfter(startOfDate)){
                            total += parseInt(redemption[a].RedemptionData.data.amount);
                            count.push(redemption[a].RedemptionData.data.amount); 
                        }
                    }

                    data.push({
                        value: total, 
                        count: count, 
                    })

                    //Other  subscription transaction T-2 to T-0
                    for(let a=0; a<subscription.length; a++){
                        if(moment(subscription[a].Date).isBefore(endOfDate) && moment(subscription[a].Date).isAfter(startOfDate)){
                            data.push(subscription[a].Amount); 
                        }
                    } 
                }

                if(leadCount >= 1){
                    for(let a =0; a<redemption.length; a++){
                        if(moment(redemption[a].RedemptionData.data.processing_dt).isBefore(endOfDate) && moment(redemption[a].RedemptionData.data.processing_dt).isAfter(startOfDate)){
                            data.push(parseInt(redemption[a].RedemptionData.data.amount));
                        }
                    }
                }
                return data; 
            }

            //Time Series 
            const Forecast = (fundId, leadTime)=>{
                const forecast = {}; 
                
                //for default series 
                for(let a=-2; a<0; a++){
                    const defaultDate = moment(date); 
                    const alterdate = defaultDate.add(a, 'days');

                    forecast[String('T' +a)] = mapComputation(a, alterdate, fundId, leadTime)
                }

                //today series 
                forecast['T0'] =  mapComputation(0, date, fundId, leadTime)

                //series for leadtime 
                for(let a=1; a<=leadTime; a++){
                    const defaultDate = moment(date); 
                    const alterdate = defaultDate.add(a, 'days');
                    forecast['T' +a] = mapComputation(a, alterdate, fundId, leadTime)
                }
                return forecast; 
            }
            const manage = ()=>{
                const fundsId = funds[0]._id; 
                const leadTime = funds[0].LeadTime; 
                const data = Forecast(fundsId, leadTime);
                return data; 
            }
            return zip(
                of(manage())
            )
        })
    ), 
    response_mapper: (req, res) =>  (data) => {
		res.send(data[0]);
	},
    error_handler: (_req, res) => (err) => {

        let status = 400
        console.log(err)

        if(err.message == "INVALID PAYLOAD"){
            err.message = "Error on payload, make sure it is valid date";
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
const getorderbook = {
    request_mapper: (req) => {
        return req.query; 
	},
    processor: pipe(

        mergeMap((props) => {
            const BASE_CALENDAR_URL =
              "https://www.googleapis.com/calendar/v3/calendars";
            const BASE_CALENDAR_ID_FOR_PUBLIC_HOLIDAY =
              "holiday@group.v.calendar.google.com";
            const API_KEY = config.GOOGLE_API_KEY;
            const CALENDAR_REGION = "en.philippines";
            const url = `${BASE_CALENDAR_URL}/${CALENDAR_REGION}%23${BASE_CALENDAR_ID_FOR_PUBLIC_HOLIDAY}/events?key=${API_KEY}`;
            const options = {
              method: "GET",
              url: url,
            };
            return zip(request(options), of(props));
          }),
          mergeMap(([result, props]) => {
            const holidays = JSON.parse(result);
            let retVal = [];
            if (holidays.items)
              for (let i = 0; i < holidays.items.length; i++) {
                let holiday = holidays.items[i];
                let holidayYear = holiday.start.date.split("-")[0];
                let currentDate = new Date();
                if (holidayYear === currentDate.getFullYear().toString())
                  retVal.push({
                    name: holiday.summary,
                    description: holiday.description,
                    date: holiday.start.date,
                  });
              }
            return zip(
              of(retVal.sort((a, b) => new Date(a.date) - new Date(b.date))), 
              of(props)
            );
          }),
          mergeMap(([holidays, props]) => {
            // console.log(holidays);
            let curr = new Date();
            let week = [];
            let non_trading_dates = {};
            let day1 = moment().startOf("year");
            for (
              let i = 0;
              i <= moment().endOf("year").diff(moment().startOf("year"), "days");
              i++
            ) {
              let day = new Date(
                moment(day1.format("YYYY-MM-DD")).add(i, "days").format("YYYY-MM-DD")
              )
                .toISOString()
                .slice(0, 10);
              let holiday_details = null;
              let currentDate = new Date(day);
              if (currentDate.getDay() === 6 || currentDate.getDay() === 0) {
                // console.log('day is weekend: ', day);
                non_trading_dates[day] = "weekend";
              } else {
                if (
                  holidays.some((holiday) => {
                    holiday_details = holiday;
                    return holiday.date === day;
                  })
                ) {
                  non_trading_dates[day] = holiday_details;
                  // console.log('day is holiday: ', day);
                } else {
                  week.push(day);
                }
              }
            }
            // of(week), 
            return zip(of(props), of(non_trading_dates));
          }),


        //process the data | get the funds 
        mergeMap(([props, non_trading_dates]) => {

            return zip(
                of(props),
                funds.GET({FundIdentifier: props.FundIdentifier, FundClass: props.FundClass}), 
                of(non_trading_dates)
            )
		}), 

        //process the data | get the redemption and subscription
        mergeMap(([props, funds, non_trading_dates]) => {

            if(typeof funds[0] === "undefined"){
                return throwError(new Error('payloadError'))
            }
            return zip(
                of(props), 
                of(funds[0].CutOff),
                redemption.GET({RedemptionData: {$ne: null}, fk_Fund: funds[0]._id}), 
                subscription.GET({SubscriptionData: {$ne: null}, fk_Fund: funds[0]._id}), 
                of(non_trading_dates)
            )
		}),

        //process the data | map the redemption and subscription
        mergeMap(([props,cutoff, redemption, subscription, non_trading_dates]) => {
            
            const date = props.Date;
            const time = cutoff;
            const dateTime = moment(date + ' ' + time);

            let nonBankingdays = []; 
            for (var key in non_trading_dates) {
                if (non_trading_dates.hasOwnProperty(key)) {
                    nonBankingdays.push(moment(key));
                }
            }


            const endOfDate = moment(dateTime);
            const startOfDate = moment(dateTime.subtract(1, 'days')).add(1,'minutes');

            let startDate =  moment(startOfDate.subtract(1, 'days')).add(1,'minutes');
            

            let BctotalRedemption = 0;
            let BctotalSubscription = 0; 
            let BcDataRedemption = []; 
            let BcDataSubscription = []; 
            let flag = false; 

            do{

                flag = false; 
                for(let a =0; a< nonBankingdays.length; a++){
                    if(moment(nonBankingdays[a], "DD-MM-YYYY").isSame(moment(startDate, "DD-MM-YYYY"))){
                        
                        const endOfDateWait = moment(startDate);
                        const startOfDateWait = moment(startDate.subtract(1, 'days')).add(1,'minutes');

                        //before cutoff redemption
                        for(let a =0; a<redemption.length; a++){
                            if(moment(new Date(redemption[a].RedemptionData.data.processing_dt)).isBefore(endOfDateWait) && moment(new Date(redemption[a].RedemptionData.data.processing_dt)).isAfter(startOfDateWait)){
                                BctotalRedemption += parseInt(redemption[a].RedemptionData.data.amount); 
                                BcDataRedemption.push(redemption[a].RedemptionData.data.amount)
                            }
                        }
                        //before cutoff subscription
                        for(let a=0; a<subscription.length; a++){
                            if(moment(subscription[a].Date).isBefore(endOfDateWait) && moment(subscription[a].Date).isAfter(startOfDateWait)){
                                BctotalSubscription += parseInt(subscription[a].Amount);
                                BcDataSubscription.push(subscription[a].Amount)
                            }
                        } 

                        startDate.subtract(1, 'days');
                        flag = true; 
                    }
                }

            }while(flag);

            //before cutoff redemption
            for(let a =0; a<redemption.length; a++){
                if(moment(new Date(redemption[a].RedemptionData.data.processing_dt)).isBefore(endOfDate) && moment(new Date(redemption[a].RedemptionData.data.processing_dt)).isAfter(startOfDate)){
                    BctotalRedemption += parseInt(redemption[a].RedemptionData.data.amount); 
                    BcDataRedemption.push(redemption[a].RedemptionData.data.amount)
                }
            }
            //before cutoff subscription
            for(let a=0; a<subscription.length; a++){
                if(moment(subscription[a].Date).isBefore(endOfDate) && moment(subscription[a].Date).isAfter(startOfDate)){
                    BctotalSubscription += parseInt(subscription[a].Amount);
                    BcDataSubscription.push(subscription[a].Amount)
                }
            } 


            const addStartOfDate = moment(endOfDate).add(1,'minutes');
            const addEndOfDate = moment(endOfDate).add(1, 'days');

            let startDateV2 =  moment(addEndOfDate.subtract(1, 'days')).add(1,'minutes');

            let ActotalRedemption = 0;
            let ActotalSubscription = 0; 
            let AcDataRedemption = []; 
            let AcDataSubscription = []; 
            let flags = false; 

            do{

                flags = false; 
                for(let a =0; a< nonBankingdays.length; a++){
                    if(moment(nonBankingdays[a], "DD-MM-YYYY").isSame(moment(startDateV2, "DD-MM-YYYY"))){
                        
                        const endOfDateWaitV2 = moment(startDateV2);
                        const startOfDateWaitV2 = moment(startDateV2.subtract(1, 'days')).add(1,'minutes');

                        //after cutoff redemption
                        for(let a =0; a<redemption.length; a++){
                            if(moment(new Date(redemption[a].RedemptionData.data.processing_dt)).isBefore(startOfDateWaitV2) && moment(new Date(redemption[a].RedemptionData.data.processing_dt)).isAfter(endOfDateWaitV2)){
                                console.log("redemption");
                                ActotalRedemption += parseInt(redemption[a].RedemptionData.data.amount); 
                                AcDataRedemption.push(redemption[a].RedemptionData.data.amount)
                            }
                        }
                        //after cutoff subscription
                        for(let a=0; a<subscription.length; a++){
                            if(moment(subscription[a].Date).isBefore(startOfDateWaitV2) && moment(subscription[a].Date).isAfter(endOfDateWaitV2)){
                                ActotalSubscription += parseInt(subscription[a].Amount);
                                AcDataSubscription.push(subscription[a].Amount)
                            }
                        } 

                        startDateV2.subtract(1, 'days');
                        flags = true; 
                    }
                }

            }while(flags);

            //after cutoff redemption
            for(let a =0; a<redemption.length; a++){
                if(moment(new Date(redemption[a].RedemptionData.data.processing_dt)).isBefore(addEndOfDate) && moment(new Date(redemption[a].RedemptionData.data.processing_dt)).isAfter(addStartOfDate)){
                    console.log("redemption");
                    ActotalRedemption += parseInt(redemption[a].RedemptionData.data.amount); 
                    AcDataRedemption.push(redemption[a].RedemptionData.data.amount)
                }
            }
            //after cutoff subscription
            for(let a=0; a<subscription.length; a++){
                if(moment(subscription[a].Date).isBefore(addEndOfDate) && moment(subscription[a].Date).isAfter(addStartOfDate)){
                    ActotalSubscription += parseInt(subscription[a].Amount);
                    AcDataSubscription.push(subscription[a].Amount)
                }
            } 

            //after cutoff redemption
            const data = {
                before_cutoff: {
                    subscription: {
                        data: BcDataSubscription, 
                        total: BctotalSubscription,
                    }, 
                    redemption: {
                        data:  BcDataRedemption,
                        total: BctotalRedemption
                    }

                }, 
                after_cutoff:{
                    subscription: {
                        data: AcDataSubscription, 
                        total: ActotalSubscription,
                    }, 
                    redemption: {
                        data:  AcDataRedemption,
                        total: ActotalRedemption
                    }
                }
            }
            return zip(
                of(data)
            )

		}),

    ), 
    response_mapper: (req, res) =>  ([data]) => {
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


const getFundsByClass = {

    request_mapper: (req) => {
        return {
            query: req.query, 
            user: req.middleware_auth, 
        }
	},
    processor: pipe(

        //initiate the payload validation
		mergeMap((props) => {
            return zip(
                of(props.user.UserLevel),
                of(props.user._id.toString()),
                of(props.query), 
                funds.GET({FundClass: props.query.FundClass})
            )
		}), 

        //decision
        mergeMap(([userLevel, userId, query, funds]) => {

            let fund = [];

            if(userLevel == 1){
                fund = funds;
            }
            else{
                for(let a =0; a<funds.length; a++){
                    for(let b =0; b<funds[a].managers.length; b++){
                        if(userId == funds[a].managers[b].toString()){
                            fund.push(funds[a])
                        }
                    }
                }
            }

            return zip(
                of(query),
                of(fund), 
            )
		}), 

        //map all the return funds
        mergeMap(([props, funds]) => {

            let FundIdentifier = [];
            if(! funds.length){
                return zip(
                    of({
                        contain: false, 
                        message: "No data found"
                    })
                )
            }
            else{
                for(let a=0; a<funds.length; a++){
                    FundIdentifier.push(funds[a].FundIdentifier)
                }
                let unique = [...new Set(FundIdentifier)]; 

                return zip (
                    of({
                        contain: true,
                        data: unique
                    })
                )
            }
		})
    ), 
    response_mapper: (req, res) =>  ([data]) => {
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




export const getcashflowController = createController(getcashflow); 
export const getcashflowtransacController = createController(getcashflowperTransac); 
export const getOrderBookController = createController(getorderbook); 
export const getFundsByClassController = createController(getFundsByClass)


