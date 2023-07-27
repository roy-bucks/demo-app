import { createController, generateRequiredSchemaItems } from "./helper"
import { GeneralSettingsModel } from "../models/general_settings.schema"
import { Collection } from "../utilities/database"
import { tokenKey } from "../config"
import { pipe, zip, of, merge, throwError } from "rxjs"
import { mergeMap } from "rxjs/operators"
const jwt = require('jsonwebtoken');

const GeneralSettings = new Collection(GeneralSettingsModel)

const UpdateGeneralSettingsOperation = {
  requestValidationSchema: generateRequiredSchemaItems([
    'body.showSMSOTP',
    'body.sessionExpiry',
    'body.enableTransactionFees'
  ]),
  request_mapper: (req) => {
    return {
      user: req.middleware_auth,
      data: req.body
    }
  },
  processor: pipe(
    mergeMap((props) => {
      if(props.user.UserLevel !== 1){
        return throwError(new Error("Unauthorized"))
      }
      return GeneralSettings.UPDATE({
        identifier: {
          Config_ID: "BXB"
        },
        data: {
          showSMSOTP: props.data.showSMSOTP,
          sessionExpiry: props.data.sessionExpiry,
          enableTransactionFees: props.data.enableTransactionFees,
          DateUpdated: new Date()
        }
      })
    }),
    mergeMap(props => GeneralSettings.GET_ONE({Config_ID: "BXB"}))
  ),
  response_mapper: (req, res) => (val) => {
    res.send({
      message: "Successfully updated General Settings!",
      data: val
  })
  },
  error_handler: (_req, res) => (err) => {
    let status = 500

    if(err.message === 'Unauthorized') {
      status = 401
    }

    console.log(err)
    res.status(status).json({
      message: err.message
    })
  }
}

const UpdateTierLimitsOperation = {
  requestValidationSchema: generateRequiredSchemaItems([
    'body.Tier1_Limit',
    'body.Tier2_Limit',
    'body.Tier3_Limit'
  ]),
  request_mapper: (req) => {
    return {
      user: req.middleware_auth,
      data: req.body
    }
  },
  processor: pipe(
    mergeMap((props) => {
      if(props.user.UserLevel !== 1){
        return throwError(new Error("Unauthorized"))
      }
      return GeneralSettings.UPDATE({
        identifier: {
          Config_ID: "BXB"
        },
        data: {
          Tier1_Limit: props.data.Tier1_Limit,
          Tier2_Limit: props.data.Tier2_Limit,
          Tier3_Limit: props.data.Tier3_Limit,
          DateUpdated: new Date()
        }
      })
    }),
    mergeMap(props => GeneralSettings.GET_ONE({Config_ID: "BXB"}))
  ),
  response_mapper: (req, res) => (val) => {
    res.send({
      message: "Successfully updated Tier Limits!",
      data: val
  })
  },
  error_handler: (_req, res) => (err) => {
    let status = 500

    if(err.message === 'Unauthorized') {
      status = 401
    }

    console.log(err)
    res.status(status).json({
      message: err.message
    })
  }
}

const UpdateTransactionFeesOperation = {
  requestValidationSchema: generateRequiredSchemaItems([
    'body.Subscription_Fee',
    'body.Redemption_Fee',
  ]),
  request_mapper: (req) => {
    return {
      user: req.middleware_auth,
      data: req.body
    }
  },
  processor: pipe(
    mergeMap((props) => {
      if(props.user.UserLevel !== 1){
        return throwError(new Error("Unauthorized"))
      }
      return GeneralSettings.UPDATE({
        identifier: {
          Config_ID: "BXB"
        },
        data: {
          Subscription_Fee: props.data.Subscription_Fee,
          Redemption_Fee: props.data.Redemption_Fee,
          DateUpdated: new Date()
        }
      })
    }),
    mergeMap(props => GeneralSettings.GET_ONE({Config_ID: "BXB"}))
  ),
  response_mapper: (req, res) => (val) => {
    res.send({
      message: "Successfully updated Transaction Fees!",
      data: val
  })
  },
  error_handler: (_req, res) => (err) => {
    let status = 500

    if(err.message === 'Unauthorized') {
      status = 401
    }

    console.log(err)
    res.status(status).json({
      message: err.message
    })
  }
}


const GetGeneralSettingsOperation = {
  request_mapper: (req) => req.body,
  processor: mergeMap((props) => GeneralSettings.GET_ONE({Config_ID: "BXB"})),
  response_mapper: (req, res) => (val) => {
    res.send({
      data: val
    })
  }
}


export const UpdateGeneralSettingsController = createController(UpdateGeneralSettingsOperation)
export const UpdateTierLimitsController = createController(UpdateTierLimitsOperation)
export const UpdateTransactionFeesController = createController(UpdateTransactionFeesOperation)
export const GetGeneralSettingsController = createController(GetGeneralSettingsOperation)