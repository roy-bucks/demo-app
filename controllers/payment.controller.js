import moment from "moment";
import { of, pipe, throwError, zip } from "rxjs";
import { mergeMap } from "rxjs/operators";
import { FundsModel } from "../models/funds.schema";
import { GeneralSettingsModel } from "../models/general_settings.schema";
import { NavModel } from "../models/nav.schema";
import { NotificationModel } from "../models/notifications.schema";
import { PartnerCodeModel } from "../models/partner_code.schema";
import { TransactionsModel } from "../models/transactions.schema";
import { UserModel } from "../models/user.schema";
import { UserDeviceModel } from "../models/user_device_token.schema";
import { Collection, Collectionv2 } from "../utilities/database";
import { getAvailableProcessors_Payment } from "../utilities/dragonpay";
import {
  createPartnerSetup,
  createSubscription,
  getAccessToken,
} from "../utilities/fc";
import { sendNotification } from "../utilities/notifications";
import { generateID } from "../utilities/security";
import { createController, generateRequiredSchemaItems } from "./helper";
const jwt = require("jsonwebtoken");

const transactions = new Collection(TransactionsModel);
const user = new Collection(UserModel);
const userDeviceToken = new Collection(UserDeviceModel);
const partners = new Collection(PartnerCodeModel);
const funds = new Collection(FundsModel);
const notifications = new Collection(NotificationModel);
const settings = new Collection(GeneralSettingsModel);
const nav_v2 = new Collectionv2(NavModel);
const getProccessorsOperation = {
  request_mapper: (req) => req.body,
  processor: pipe(
    mergeMap((props) => {
      return getAvailableProcessors_Payment();
    })
  ),
  response_mapper: (req, res) => (val) => {
    res.send({
      data: val,
      message: "Successfully requested for available dragonpay processors!",
    });
  },
};
const CreateTransactionOperation = {
  requestValidationSchema: generateRequiredSchemaItems([
    "body.Type",
    "body.Amount",
    "body.Description",
    "body.Email",
    "body.procId",
    "body.procName",
    "body.Param1",
    "body.Param2",
    "body.FundIdentifier",
  ]),
  request_mapper: (req) => {
    return {
      data: req.body,
      user: req.middleware_auth,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(
        of(props),
        funds.GET_ONE({ FundIdentifier: props.data.FundIdentifier }),
        settings.GET_ONE({ Config_ID: "BXB" })
      );
    }),
    mergeMap(([props, fund, settings]) => {
      const id = "PY" + generateID(4);
      return zip(
        of(props),
        transactions.ADD({
          TransactionID: id,
          RefNo: null,
          fk_User: props.user._id,
          Amount: props.data.Amount,
          Fee: settings.enableTransactionFees ? settings.Subscription_Fee : 0,
          PaymentMethod: props.data.procName,
          Status: "P",
          Date: new Date(),
          Type: props.data.Type,
          Description: props.data.Description,
          fk_Fund: fund._id,
        }),
        of(id)
      );
    }),
    mergeMap(([props, transaction, id]) => {
      var data = {
        TransactionID: id,
        Amount: transaction.Amount + transaction.Fee,
        Email: props.data.Email,
        Description: props.data.Description,
        Currency: "PHP",
        procId: props.data.procId,
        Param1: props.data.Param1,
        Param2: props.data.Param2,
      };
      // console.log(data)
      // return requestPayment(data)
      return zip(of(data));
    })
  ),
  response_mapper: (req, res) => (val) => {
    res.send({
      message: "Successfully requested access!",
      data: val,
    });
  },
};
const ProcessPostbackOperation = {
  request_mapper: (req) => {
    if (req.body.txnid !== undefined) {
      console.log("POST:: FROM POSTBACK DRAGONPAY");
      var data = req.body;
    } else {
      console.log("GET:: FROM RETURN URL DRAGONPAY");
      var data = req.query;
    }

    // console.log(data)

    if (data.txnid === undefined) {
      return undefined;
    } else {
      return {
        TransactionID: data.txnid,
        RefNo: data.refno,
        Status: data.status,
        Message: data.message,
        Digest: data.digest,
        Param1: data.param1,
        Param2: data.param2,
      };
    }
  },
  processor: pipe(
    mergeMap((props) => {
      console.log("props: ", props);
      return zip(
        of(props),
        transactions.UPDATE({
          identifier: {
            TransactionID: props.TransactionID,
          },
          data: {
            RefNo: props.RefNo,
            Status: props.Status == "S" ? "S" : "P",
          },
        }),
        transactions.GET_ONE({ TransactionID: props.TransactionID })
      );
    }),
    mergeMap(([props, temp, transaction]) => {
      // console.log(transaction)
      return zip(
        of(props),
        of(transaction),
        userDeviceToken.GET({ fk_User: transaction.fk_User }),
        funds.GET_ONE({ _id: transaction.fk_Fund })
      );
    }),
    mergeMap(([props, transaction, userdevicetoken, fund]) => {
      if (props.Status == "S") {
        let tokens = [];
        userdevicetoken.map((token) => tokens.push(token.DeviceToken));
        var title = `Your payment via dragonpay is successful!`;
        var body = `Your payment transaction (${transaction.TransactionID}) with the reference number ${transaction.RefNo} is successful`;

        return of(tokens).pipe(
          mergeMap(() => sendNotification(title, body, tokens)),
          mergeMap(() =>
            notifications.ADD({
              ReceiverId: transaction.fk_User,
              Type: "Payment",
              ModuleName: "Investments",
              Title: title,
              Content: body,
              isRead: 0,
              DateCreated: new Date(),
              DateUpdated: new Date(),
            })
          ),
          mergeMap(() => user.GET_ONE({ _id: transaction.fk_User })),
          mergeMap((user_info) => {
            return zip(of(user_info), getAccessToken());
          }),
          mergeMap(([user_info, fc_token]) => {
            return zip(
              createPartnerSetup(fc_token.access_token, user_info, fund),
              of(fc_token)
            );
          }),
          mergeMap(([partner, fc_token]) => {
            console.log("partner: ", JSON.stringify(partner));
            console.log("partner: ", partner.data);
            if (partner.data && partner.data.result) {
              return zip(
                partners.ADD({
                  fk_User: transaction.fk_User,
                  fk_Fund: fund._id,
                  PartnerCode: partner.data.result.data["Partner Code"],
                  DateCreated: new Date(),
                }),
                of(true),
                of(fc_token)
              );
            } else {
              return zip(
                partners.GET_ONE({
                  fk_Fund: fund._id,
                  fk_User: transaction.fk_User,
                }),
                of(false),
                of(fc_token)
              );
            }
          }),
          mergeMap(([partner, result, fc_token]) => {
            if (partner == null) {
              return throwError(new Error("Adding of partner code failed"));
            }

            const fc_subscription_data = {
              Amount: transaction.Amount,
              FundIdentifier: fund.FundIdentifier,
              PartnerCode: partner.PartnerCode,
            };

            return createSubscription(
              fc_token.access_token,
              fc_subscription_data
            );
          }),
          mergeMap((fc_subscription) => {
            console.log("fc_subscription: ", fc_subscription);
            if (fc_subscription.result && fc_subscription.result.code == 0) {
              var title = `Subscription to Fund ${fund.Name}`;
              var body = `Your subscription to Fund ${fund.Name} is being processed. Your transaction details will be available in 3-5 working days.`;
              return zip(
                sendNotification(title, body, tokens),
                notifications.ADD({
                  ReceiverId: transaction.fk_User,
                  Type: "Payment",
                  ModuleName: "Investments",
                  Title: title,
                  Content: body,
                  isRead: 0,
                  DateCreated: new Date(),
                  DateUpdated: new Date(),
                }),
                transactions.UPDATE({
                  identifier: {
                    _id: transaction._id,
                  },
                  data: {
                    SubscriptionData: fc_subscription.result,
                  },
                }),
                user.GET_ONE({ _id: transaction.fk_User })
              );
            } else {
              return throwError(new Error("Subscription to FC failed!"));
            }
          }),
          mergeMap(([notif1, notif2, update_transaction, user_data]) => {
            // console.log(user_data)
            return user.UPDATE({
              identifier: {
                _id: transaction.fk_User,
              },
              data: {
                TransactionAmount:
                  user_data.TransactionAmount + transaction.Amount,
              },
            });
          })
        );
      } else {
        return of([]);
      }
    })
  ),
  response_mapper: (req, res) => (val) => {
    res.send("result=OK");
  },
};
const ProcessReturnURLOperation = {
  request_mapper: (req) => {
    if (req.body.txnid !== undefined) {
      var data = req.body;
    } else {
      var data = req.query;
    }

    console.log("POST:: FROM POSTBACK DRAGONPAY");
    // console.log(data)

    if (data.txnid === undefined) {
      return undefined;
    } else {
      return {
        TransactionID: data.txnid,
        RefNo: data.refno,
        Status: data.status,
        Message: data.message,
        Digest: data.digest,
        Param1: data.param1,
        Param2: data.param2,
      };
    }
  },
  response_mapper: (req, res) => (val) => {
    res.send("result=OK");
  },
};
const GetTransactionsOperation = {
  request_mapper: (req) => {
    return { Type: 1, query: req.query, userData: req.middleware_auth };
  },
  processor: pipe(
    mergeMap((props) => {
      let query = {
        TransactionID: { $ne: null },
        Type: 1,
        Status: {
          $ne: "AML",
        },
        // $or: [{ $and: [{ IsCTR: false }, { IsSTR: false }] }],
      };
      if (props.query.status) {
        query.Status = props.query.status;
      }
      if (props.query.fund) {
        query["fk_Fund"] = props.query.fund;
      }
      if (props.query.start && props.query.end) {
        query["Date"] = {
          $gte: new Date(props.query.start),
          $lte: new Date(props.query.end),
        };
      }
      let paginate = {
        page: parseInt(props.query.page ? props.query.page : 0),
        max: parseInt(props.query.max ? props.query.max : 0),
      };
      let aggregateQuery = [
        { $sort: { Date: -1 } },
        { $match: query },
        {
          $lookup: {
            from: "user",
            localField: "fk_User",
            foreignField: "_id",
            as: "user",
          },
        },
        // {
        //   $lookup: {
        //     from: "nav",
        //     localField: "fk_Fund",
        //     foreignField: "fk_Fund",
        //     as: "current_nav",
        //   },
        // },
        { $unwind: "$user" },
        {
          $lookup: {
            from: "funds",
            localField: "fk_Fund",
            foreignField: "_id",
            as: "funds",
          },
        },
        { $unwind: "$funds" },
      ];
      if (props.query.keyword) {
        aggregateQuery.push({
          $addFields: {
            result: {
              $or: [
                {
                  $regexMatch: {
                    input: "$user.FirstName",
                    regex: new RegExp(props.query.keyword, "i"),
                  },
                },
                {
                  $regexMatch: {
                    input: "$funds.FundIdentifier",
                    regex: new RegExp(props.query.keyword, "i"),
                  },
                },
                {
                  $regexMatch: {
                    input: "$Status",
                    regex: new RegExp(props.query.keyword, "i"),
                  },
                },
              ],
            },
          },
        });
      }
      if (paginate.page && paginate.max) {
        aggregateQuery.push({
          $facet: {
            paginatedResults: [
              { $skip: paginate.page },
              { $limit: paginate.max },
            ],
            totalCount: [
              {
                $count: "count",
              },
            ],
          },
        });
      }
      console.log("aggregateQuery: ", aggregateQuery);
      return zip(of(props), transactions.AGGREGATE(aggregateQuery));
    }),
    mergeMap(([props, transactions]) => {
      const res = of(transactions).pipe(
        mergeMap(async (transactionsz) => {
          const data = [];
          for (let transaction of transactionsz) {
            const nav = await nav_v2.GET_ONE({
              fk_Fund: transaction.fk_Fund,
              Date: moment(transaction.Date).format("YYYY-MM-DD"),
            });
            data.push({ ...transaction, nav });
          }
          return data;
        })
      );

      return zip(of(props), res);
    }),
    mergeMap(([props, results]) => zip(of(props), of(results)))
  ),

  response_mapper:
    (req, res) =>
    ([props, val]) => {
      let paginate = {
        page: parseInt(props.query.page ? props.query.page : 0),
        max: parseInt(props.query.max ? props.query.max : 0),
      };
      let keywordBasedResult = [];

      if (paginate.page && paginate.max) {
        try {
          const transactions = val[0].paginatedResults;
          if (props && props.query && props.query.keyword) {
            for (let i = 0; i < transactions.length; i++) {
              let trans = transactions[i];
              if (trans.result) keywordBasedResult.push(trans);
            }
          } else {
            keywordBasedResult = transactions;
          }
          let temp = [];
          let userId = props.userData._id.toString();

          if (props.userData.UserLevel === 1) {
            console.log("admin sending all subscriptions", val);
            res.send({
              transactions: keywordBasedResult,
              total: keywordBasedResult.length,
            });
          } else {
            for (let i = 0; i < keywordBasedResult.length; i++) {
              const trans = keywordBasedResult[i].funds;
              let fundManagers =
                trans.managers && trans.managers.length
                  ? trans.managers.map((item) => {
                      return item.toString();
                    })
                  : [];
              if (
                fundManagers &&
                fundManagers.length &&
                fundManagers.indexOf(userId) >= 0
              ) {
                temp.push(keywordBasedResult[i]);
              }
            }
            res.send({
              transactions: temp,
              total: temp.length,
            });
          }
        } catch (e) {
          console.log("error fetching subscriptions...", e);
        }
      } else {
        if (props && props.query && props.query.keyword) {
          for (let i = 0; i < val.length; i++) {
            let trans = val[i];
            if (trans.result) keywordBasedResult.push(trans);
          }
        } else {
          keywordBasedResult = val;
        }
        try {
          let temp = [];
          const transactions = keywordBasedResult;
          let userId = props.userData._id.toString();

          if (props.userData.UserLevel === 1) {
            console.log("admin sending all subscriptions");
            res.send({
              transactions: keywordBasedResult,
              total: keywordBasedResult.length,
            });
          } else {
            for (let i = 0; i < transactions.length; i++) {
              const trans = transactions[i].funds;
              let fundManagers =
                trans.managers && trans.managers.length
                  ? trans.managers.map((item) => {
                      return item.toString();
                    })
                  : [];
              if (
                fundManagers &&
                fundManagers.length &&
                fundManagers.indexOf(userId) >= 0
              ) {
                temp.push(transactions[i]);
              }
            }
            res.send({
              transactions: temp,
              total: temp.length,
            });
          }
        } catch (e) {
          console.log("error fetching subscriptions...", e);
          res.send({
            transactions: val,
            total: val.length,
          });
        }
      }
    },
};

const isValidPaymentTransactionOperation = {
  //3865000
  requestValidationSchema: generateRequiredSchemaItems(["body.Amount"]),
  request_mapper: (req) => {
    return {
      data: req.body,
      user: req.middleware_auth,
    };
  },
  processor: mergeMap((props) => {
    return of(props).pipe(
      mergeMap(() =>
        transactions.GET({
          fk_User: props.user._id,
          Type: 1,
          Status: { $ne: "S" },
          RefNo: { $ne: null },
        })
      ),
      mergeMap((transactions) => {
        return zip(settings.GET_ONE({ Config_ID: "BXB" }), of(transactions));
      }),
      mergeMap(([settings, transactions]) => {
        if (props.user.Tier == 2) {
          const limit = settings.Tier2_Limit;
          let all_transactions = 0;
          transactions.map((m) => {
            all_transactions += m.Amount;
          });
          console.log(all_transactions);
          if (all_transactions + props.data.Amount <= limit) {
            return of(true);
          } else {
            return throwError(new Error("INVALID_TRANSACTION"));
          }
        } else if (props.user.Tier === 3) {
          return of(true);
        } else {
          return throwError(new Error("INVALID_TRANSACTION"));
        }
      })
    );
  }),
  response_mapper: (req, res) => (val) => {
    res.send({
      isValid: true,
    });
  },
  error_handler: (_req, res) => (err) => {
    let status = 500;

    if (err.message === "INVALID_TRANSACTION") {
      status = 401;
    }

    console.log(err);
    res.status(status).json({
      message: err.message,
    });
  },
};

export const ProcessPostbackController = createController(
  ProcessPostbackOperation
);
export const ProcessReturnURLController = createController(
  ProcessReturnURLOperation
);
export const CreateTransactionController = createController(
  CreateTransactionOperation
);
export const GetProcessorsController = createController(
  getProccessorsOperation
);
export const GetTransactionsController = createController(
  GetTransactionsOperation
);
export const isValidPaymentTransactionController = createController(
  isValidPaymentTransactionOperation
);
