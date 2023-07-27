import { createController, generateRequiredSchemaItems } from "./helper"
import { UserModel } from "../models/user.schema"
import { NotificationModel } from "../models/notifications.schema"
import { Collection } from "../utilities/database"
import { pipe, zip, of, merge } from "rxjs"
import { mergeMap } from "rxjs/operators"
import mongoose from 'mongoose'
import { sendNotification } from '../utilities/notifications'
import { UserDeviceModel } from '../models/user_device_token.schema'
const jwt = require('jsonwebtoken');

const users = new Collection(UserModel)
const notifications = new Collection(NotificationModel)
const userDeviceToken = new Collection(UserDeviceModel)


const GetNotificationsOperation = {
  request_mapper: (req) => {
    var accessor = req.middleware_auth
    if(accessor.UserLevel == 1){
      return {
        ReceiverId: mongoose.Types.ObjectId(req.query.fk_User)
      }
    }
    else{
      return {
        ReceiverId: req.middleware_auth._id
      }
    }
  },
  processor: mergeMap((props) => {
    return notifications.AGGREGATE([
      { $sort: { DateCreated: -1}},
      { $match: props },
    ])
  }),
  response_mapper: (req, res) => (val) => {
    res.send({
      data: val
    })
  }
}

const MarkNotificationOperation = {
  request_mapper: (req) => {
    return {
      user: req.middleware_auth,
      _id: req.body.NotificationId
    }
  },
  processor: pipe(
      mergeMap((props) => {
        return zip(
          of(props),
          notifications.UPDATE({
              identifier: {
                  _id: props._id
              },
              data: {
                isRead: 1
              }
          }),
        )
      }),
      mergeMap(([props,notification]) => {
        return zip(
          of(props),
          of(notification),
          notifications.AGGREGATE([
            { $sort: { DateCreated: -1}},
            { $match: { ReceiverId: mongoose.Types.ObjectId(props.user._id)}},
          ])
        )
      })
  ),
  response_mapper: (req, res) => ([props,notification, notifications]) => {
    res.send({
      data: notifications,
      message: "Successfully read notification!"
    })
  }
}

const MarkAllNotificationsOperation = {
  request_mapper: (req) => {
    return {
      user: req.middleware_auth,
      fk_User: req.middleware_auth._id
    }
  },
  processor: pipe(
      mergeMap((props) => {
        return zip(
          of(props),
          notifications.UPDATE_MANY({
              identifier: {
                ReceiverId: props.fk_User
              },
              data: {
                isRead: 1
              }
          }),
        )
      }),
      mergeMap(([props,notification]) => {
        return zip(
          of(props),
          of(notification),
          notifications.AGGREGATE([
            { $sort: { DateCreated: -1}},
            { $match: { ReceiverId: mongoose.Types.ObjectId(props.user._id)}},
          ])
        )
      })
  ),
  response_mapper: (req, res) => ([props,notification, notifications]) => {
    res.send({
      data: notifications,
      message: "Successfully read all notification!"
    })
  }
}

const CreateNotificationOperation = {
  requestValidationSchema: generateRequiredSchemaItems([
    'body.ReceiverId',
    'body.Type',
    'body.Title',
    'body.Content',
    'body.ModuleName',
  ]),
  request_mapper: (req) => req.body,
  processor: pipe(
      mergeMap((props) => {
        return zip(
          userDeviceToken.GET({fk_User: props.ReceiverId}),
          of(props)
        )
      }),
      mergeMap(([userdevicetoken, props]) => {
        let tokens = []
        userdevicetoken.map((token) => tokens.push(token.DeviceToken))
        return zip(
          of(props),
          sendNotification(props.Title,props.Content,tokens),
          notifications.ADD({
            ReceiverId: props.ReceiverId,
            Type: props.Type,
            ModuleName: props.ModuleName,
            Title: props.Title,
            Content: props.Content,
            isRead: 0,
            DateCreated: new Date(),
            DateUpdated: new Date()
          }),
        )
      }),
      mergeMap(([props,notification]) => notifications.AGGREGATE([
        { $sort: { DateCreated: -1}},
        { $match: {ReceiverId: mongoose.Types.ObjectId(props.ReceiverId)} },
      ]))
  ),
  response_mapper: (req, res) => (notifications) => {
    res.send({
      data: notifications,
      message: "Successfully created notification!"
    })
  }
}

export const GetNotificationsController = createController(GetNotificationsOperation)
export const MarkNotificationController = createController(MarkNotificationOperation)
export const MarkAllNotificationsController = createController(MarkAllNotificationsOperation)
export const CreateNotificationController = createController(CreateNotificationOperation)