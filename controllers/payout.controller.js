import moment from "moment";
import mongoose from "mongoose";
import { of, pipe, throwError, zip } from "rxjs";
import { mergeMap } from "rxjs/operators";
import { AMLreportsModel } from "../models/aml_reports.schema";
import { FundsModel } from "../models/funds.schema";
import { GeneralSettingsModel } from "../models/general_settings.schema";
import { NavModel } from "../models/nav.schema";
import { NotificationModel } from "../models/notifications.schema";
import { PartnerCodeModel } from "../models/partner_code.schema";
import { PayoutRequestModel } from "../models/payout_request.schema";
import { TransactionsModel } from "../models/transactions.schema";
import { UserModel } from "../models/user.schema";
import { UserDeviceModel } from "../models/user_device_token.schema";
import { Collection, Collectionv2 } from "../utilities/database";
import {
  getAvailableProcessors_Payout,
  requestPayout,
  voidPayout,
} from "../utilities/dragonpay";
import { sendNotification } from "../utilities/notifications";
import { generateID } from "../utilities/security";
import { createController, generateRequiredSchemaItems } from "./helper";
const jwt = require("jsonwebtoken");

const transactions = new Collection(TransactionsModel);
const users = new Collection(UserModel);
const payout_request = new Collection(PayoutRequestModel);
const userDeviceToken = new Collection(UserDeviceModel);
const funds = new Collection(FundsModel);
const partners = new Collection(PartnerCodeModel);
const notifications = new Collection(NotificationModel);
const settings = new Collection(GeneralSettingsModel);
const AmlReportCollection = new Collection(AMLreportsModel);
const nav_v2 = new Collectionv2(NavModel);
const getProccessorsOperation = {
  request_mapper: (req) => req.body,
  processor: pipe(
    mergeMap((props) => {
      return getAvailableProcessors_Payout();
    })
  ),
  response_mapper: (req, res) => (val) => {
    res.send({
      data: val,
      message: "Successfully requested for available dragonpay processors!",
    });
  },
};
const RequestPayoutOperation = {
  requestValidationSchema: generateRequiredSchemaItems([
    "body.Type",
    "body.Amount",
    "body.Fee",
    "body.Description",
    "body.FundIdentifier",
    "body.procId",
    "body.procName",
  ]),
  request_mapper: (req) => {
    // console.log(req.middleware_auth)
    return {
      data: req.body,
      user: req.middleware_auth,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      // console.log(props)
      return zip(
        of(props),
        funds.GET_ONE({ FundIdentifier: props.data.FundIdentifier }),
        settings.GET_ONE({ Config_ID: "BXB" })
      );
    }),
    mergeMap(([props, fund, settings]) => {
      const id = "PO" + generateID(4);
      // console.log(props)
      return zip(
        of(props),
        transactions.ADD({
          TransactionID: id,
          RefNo: null,
          fk_User: props.user._id,
          Amount: props.data.Amount,
          Fee: settings.enableTransactionFees ? props.data.Fee : 0,
          PaymentMethod: props.data.procName,
          Status: "P1", //P1 - PENDING PROCESS APP SIDE | P2 - PENDING PROCESS DRAGONPAY SIDE (meaning already posted in dragonpay)
          Date: new Date(),
          Type: props.data.Type,
          Description: props.data.Description,
          fk_Fund: fund._id,
        }),
        of(id),
        of(fund),
        partners.GET_ONE({ fk_Fund: fund._id, fk_User: props.user._id })
      );
    }),
    mergeMap(([props, transaction, id, fund, partner]) => {
      var data = {
        TxnId: id,
        FirstName: props.user.FirstName,
        MiddleName: props.user.MiddleName,
        LastName: props.user.LastName,
        Amount: transaction.Amount,
        Currency: "PHP",
        Description: props.data.Description,
        ProcId: props.data.procId,
        ProcDetail: props.data.ProcDetail,
        Email: props.user.Email,
        MobileNo: props.user.MobileNo,
        Nationality: props.user.Nationality,
        Address: props.data.AddressDetails,
      };
      return payout_request.ADD({
        fk_User: props.user._id,
        fk_Transaction: transaction._id,
        fk_Fund: fund._id,
        fk_Partner: partner._id,
        Date: new Date(),
        Status: "P", //P - PENDING PROCESS FOR EOD | S - PROCESSED
        data: data,
      });
    })
  ),
  response_mapper: (req, res) => (val) => {
    res.send({
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

    if (data.merchantTxnId === undefined) {
      return undefined;
    } else {
      return {
        TransactionID: data.merchantTxnId,
        RefNo: data.refNo,
        Status: data.status,
        Message: data.message,
        Digest: data.digest,
      };
    }
  },
  processor: pipe(
    mergeMap((props) => {
      // console.log(props)
      return zip(
        of(props),
        transactions.UPDATE({
          identifier: {
            TransactionID: props.TransactionID,
          },
          data: {
            RefNo: props.RefNo,
            Status: props.Status, // S - Success; F - Failed; P - Pending; H - On Hold; G - In Progress; V - Voided
          },
        }),
        transactions.GET_ONE({
          TransactionID: props.TransactionID,
        })
      );
    }),
    mergeMap(([props, temp, transaction]) => {
      return zip(
        of(props),
        of(transaction),
        userDeviceToken.GET({ fk_User: transaction.fk_User })
      );
    }),
    mergeMap(([props, transaction, userdevicetoken]) => {
      if (props.Status == "S") {
        let tokens = [];
        userdevicetoken.map((token) => tokens.push(token.DeviceToken));
        // console.log(tokens)
        var title = `Your redemption via dragonpay is successful!`;
        var body = `Your redemption transaction (${transaction.TransactionID}) with the reference number ${transaction.RefNo} is successful`;
        return zip(
          notifications.ADD({
            ReceiverId: transaction.fk_User,
            Type: "Payout",
            ModuleName: "Investments",
            Title: title,
            Content: body,
            isRead: 0,
            DateCreated: new Date(),
            DateUpdated: new Date(),
          }),
          sendNotification(title, body, tokens)
        );
      } else {
        return of(props);
      }
    })
  ),
  response_mapper: (req, res) => (val) => {
    res.send("result=OK");
  },
};
const VoidPayoutOperation = {
  requestValidationSchema: generateRequiredSchemaItems(["body.TransactionID"]),
  request_mapper: (req) => req.body,
  processor: pipe(
    mergeMap((props) => {
      return voidPayout(props.TransactionID);
    })
  ),
  response_mapper: (req, res) => (val) => {
    res.send({
      data: val,
    });
  },
};
const GetTransactionsOperation = {
  request_mapper: (req) => {
    return {
      Type: 2,
      query: req.query,
      userData: req.middleware_auth,
    };
  },
  processor: mergeMap((props) => {
    return of(props).pipe(
      mergeMap(() => {
        let query = {
          Type: 2,
        };
        let transaction_query = {};
        if (props.query.status) {
          const q_stat = props.query.status;

          if (q_stat === "P" || q_stat === "S") {
            query = {
              ...query,
              "transaction.Status": q_stat,
            };
          }

          console.log("redemption query", query);
        }
        if (props.query.fund) {
          query["fk_Fund"] = mongoose.Types.ObjectId(props.query.fund);
        }
        if (props.query.start && props.query.end) {
          query["Date"] = {
            $gte: new Date(props.query.start),
            $lte: new Date(props.query.end + " 23:59:59"),
          };
        }
        if (props.query.key) {
          // query[ '$or' ] = [
          // 	{ _1dReturn: { '$regex': filter.key, '$options': 'i' } },
          // ]
        }
        let paginate = {
          page: parseInt(props.query.page ? props.query.page : 0),
          max: parseInt(props.query.max ? props.query.max : 0),
        };
        let aggregateQuery = [
          {
            $lookup: {
              from: "transactions",
              localField: "fk_Transaction",
              foreignField: "_id",
              as: "transaction",
            },
          },
          { $unwind: "$transaction" },

          {
            $lookup: {
              from: "user",
              localField: "fk_User",
              foreignField: "_id",
              as: "user",
            },
          },
          { $unwind: "$user" },
          {
            $lookup: {
              from: "funds",
              localField: "fk_Fund",
              foreignField: "_id",
              as: "fund",
            },
          },
          { $unwind: "$fund" },
          {
            $lookup: {
              from: "partner_codes",
              localField: "fk_Partner",
              foreignField: "_id",
              as: "partner_code",
            },
          },
          { $unwind: "$partner_code" },
          { $match: query },
        ];
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
        return zip(of(props), payout_request.AGGREGATE(aggregateQuery));
      }),

      mergeMap(([props, payout_req]) => {
        const res = of(payout_req).pipe(
          mergeMap(async (payouts) => {
            const data = [];
            for (let payout of payouts) {
              const nav = await nav_v2.GET_ONE({
                fk_Fund: payout.transaction.fk_Fund,
                Date: moment(payout.transaction.Date).format("YYYY-MM-DD"),
              });
              data.push({ ...payout, nav });
            }
            return data;
          })
        );

        return zip(of(props), res);
      }),
      mergeMap(([props, results]) => zip(of(props), of(results))),

      mergeMap(([props, result]) => {
        let paginate = {
          page: parseInt(props.query.page ? props.query.page : 0),
          max: parseInt(props.query.max ? props.query.max : 0),
        };
        if (paginate.page && paginate.max) {
          return zip(
            of({
              transactions: result[0].paginatedResults,
              total: result[0].totalCount[0].count,
            })
          );
        }
        if (props.query.key) {
          const temp = result.map((item, i) => {
            item.tempName = item.user.FirstName + " " + item.user.LastName;
            item.tempTransactionId = item.transaction.TransactionID;
            item.tempAccountNumber = item.user.AccountNo;
            return item;
          });
          const search = (str) => {
            const keyword = str.toLowerCase();
            return temp.filter(
              (x) =>
                x.tempAccountNumber.toLowerCase().includes(keyword) ||
                x.tempName.toLowerCase().includes(keyword) ||
                x.tempTransactionId.toLowerCase().includes(keyword)
            );
          };
          let searchResult = search(props.query.key);
          try {
            console.log("1");
            let temp = [];
            const transactions = searchResult;
            let userId = props.userData._id.toString();

            if (props.userData.UserLevel === 1) {
              console.log("admin sending all subscriptions");
              return zip(
                of({
                  transactions: searchResult,
                  total: searchResult.length,
                })
              );
            } else {
              console.log("2");
              for (let i = 0; i < transactions.length; i++) {
                const trans = transactions[i].fund;
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
              return zip(
                of({
                  transactions: temp,
                  total: temp.length,
                })
              );
            }
          } catch (e) {
            console.log("error fetching subscriptions...", e);
            return zip(
              of({
                transactions: searchResult,
                total: searchResult.length,
              })
            );
          }
        } else {
          try {
            console.log("1");
            let temp = [];
            let transactions = result;

            let userId = props.userData._id.toString();
            if (props.userData.UserLevel === 1) {
              console.log("admin sending all redemptions", transactions.length);
              return zip(
                of({
                  transactions: result,
                  total: result.length,
                })
              );
            } else {
              console.log("2");
              console.log("user id: ", userId);
              for (let i = 0; i < transactions.length; i++) {
                const trans = transactions[i].fund;
                console.log("fund: ", trans.managers);
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
              return zip(
                of({
                  transactions: temp,
                  total: temp.length,
                })
              );
            }
          } catch (e) {
            console.log("error fetching subscriptions...", e);
            return zip(
              of({
                transactions: result,
                total: result.length,
              })
            );
          }
        }
      })
    );
  }),
  response_mapper:
    (req, res) =>
    ([val]) => {
      res.send(val);
    },
};
const GetPayoutRequestsOperation = {
  request_mapper: (req) => {
    return { Status: "P" };
  },
  processor: mergeMap((query) => {
    return payout_request.AGGREGATE([
      {
        $lookup: {
          from: "transactions",
          localField: "fk_Transaction",
          foreignField: "_id",
          as: "transaction",
        },
      },
      { $unwind: "$transaction" },
      { $match: query },
      {
        $lookup: {
          from: "user",
          localField: "fk_User",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      {
        $lookup: {
          from: "funds",
          localField: "fk_Fund",
          foreignField: "_id",
          as: "fund",
        },
      },
      { $unwind: "$fund" },
      {
        $lookup: {
          from: "partner_codes",
          localField: "fk_Partner",
          foreignField: "_id",
          as: "partner_code",
        },
      },
      { $unwind: "$partner_code" },
      {
        $project: {
          _id: 1,
          fk_User: 1,
          fk_Transaction: 1,
          fk_Fund: 1,
          fk_Partner: 1,
          Date: 1,
          Status: 1,
          data: 1,
          __v: 1,
          "transaction.TransactionID": 1,
          "transaction.RefNo": 1,
          "transaction.Amount": 1,
          "transaction.Fee": 1,
          "transaction.Status": 1,
          "user.Email": 1,
          "user.AccountNo": 1,
          "user.FirstName": 1,
          "user.LastName": 1,
          "user.MobileNo": 1,
          "fund.FundIdentifier": 1,
          "partner_code.PartnerCode": 1,
        },
      },
    ]);
  }),
  response_mapper: (req, res) => (val) => {
    val;
    res.send({
      requests: val,
    });
  },
};
const GetPayoutProcessedOperation = {
  request_mapper: (req) => {
    return { Status: "S" };
  },
  processor: mergeMap((query) => {
    return payout_request.AGGREGATE([
      {
        $lookup: {
          from: "transactions",
          localField: "fk_Transaction",
          foreignField: "_id",
          as: "transaction",
        },
      },
      { $unwind: "$transaction" },
      { $match: query },
      {
        $lookup: {
          from: "user",
          localField: "fk_User",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      {
        $project: {
          _id: 1,
          fk_User: 1,
          fk_Transaction: 1,
          Date: 1,
          Status: 1,
          data: 1,
          __v: 1,
          "transaction.TransactionID": 1,
          "transaction.RefNo": 1,
          "transaction.Amount": 1,
          "transaction.Fee": 1,
          "transaction.Status": 1,
          "user.Email": 1,
          "user.AccountNo": 1,
          "user.FirstName": 1,
          "user.LastName": 1,
          "user.MobileNo": 1,
        },
      },
    ]);
  }),
  response_mapper: (req, res) => (val) => {
    // console.log(val)
    res.send({
      requests: val,
    });
  },
};
const GetPayoutVoidedOperation = {
  request_mapper: (req) => {
    return { Status: "V" };
  },
  processor: mergeMap((query) => {
    return payout_request.AGGREGATE([
      {
        $lookup: {
          from: "transactions",
          localField: "fk_Transaction",
          foreignField: "_id",
          as: "transaction",
        },
      },
      { $unwind: "$transaction" },
      { $match: query },
      {
        $lookup: {
          from: "user",
          localField: "fk_User",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      {
        $project: {
          _id: 1,
          fk_User: 1,
          fk_Transaction: 1,
          Date: 1,
          Status: 1,
          data: 1,
          __v: 1,
          "transaction.TransactionID": 1,
          "transaction.RefNo": 1,
          "transaction.Amount": 1,
          "transaction.Fee": 1,
          "transaction.Status": 1,
          "user.Email": 1,
          "user.AccountNo": 1,
          "user.FirstName": 1,
          "user.LastName": 1,
          "user.MobileNo": 1,
        },
      },
    ]);
  }),
  response_mapper: (req, res) => (val) => {
    // console.log(val)
    res.send({
      requests: val,
    });
  },
};
const ProcessPayoutRequestsOperation = {
  request_mapper: (req) => req.body,
  processor: pipe(
    mergeMap(async (props) => {
      let results = [];
      for (let request of props) {
        var request_date = moment(request.Date).utcOffset(8);
        var dateToday = moment().format("YYYY-MM-DD").toString();
        var time = "21:00";
        var cutoff_time = moment(dateToday + " " + time);
        if (request_date.isSameOrBefore(cutoff_time)) {
          var result = await requestPayout(request.data);
          var data = {
            Code: result.Code,
            Message: result.Message,
          };
          if (data.Code == 0) {
            transactions.UPDATE({
              identifier: {
                TransactionID: data.TransactionID,
              },
              data: {
                RefNo: data.RefNo,
                Status: data.Status, // S - Success; F - Failed; P - Pending; H - On Hold; G - In Progress; V - Voided
              },
            });
            payout_request.UPDATE({
              identifier: {
                _id: request._id,
              },
              data: {
                Status: "S", //SUCCESSFULLY POSTED TO DRAGONPAY
              },
            });
            results.push({
              TransactionID: request.transaction.TransactionID,
              Name: request.user.FirstName + " " + request.user.LastName,
              Amount: request.data.Amount,
              isSuccessful: true,
              code: data.Code,
              message: data.Message,
            });
          } else {
            results.push({
              TransactionID: request.transaction.TransactionID,
              Name: request.user.FirstName + " " + request.user.LastName,
              Amount: request.data.Amount,
              isSuccessful: false,
              code: data.Code,
              errorMessage: data.Message,
              message: "Unable to post transaction to DragonPay",
            });
          }
        }
      }
      return results;
    })
  ),
  response_mapper: (req, res) => (val) => {
    // console.log(val)
    res.send({
      results: val,
    });
  },
};

const isValidPayoutTransactionOperation = {
  requestValidationSchema: generateRequiredSchemaItems([
    "body.Amount",
    "body.fk_Fund",
  ]),
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
          fk_Fund: props.data.fk_Fund,
          fk_User: props.user._id,
          Type: 2,
          Status: { $ne: "S" },
        })
      ),
      mergeMap((transactions) => {
        return zip(
          partners.GET_ONE({
            fk_Fund: props.data.fk_Fund,
            fk_User: props.user._id,
          }),
          of(transactions)
        );
      }),
      mergeMap(([partner, transactions]) => {
        const totalEquity = partner.TotalEquity;
        let pendingTransactions = 0;
        transactions
          .filter((x) => x.Status !== "V")
          .map((m) => {
            pendingTransactions += m.Amount;
          });
        if (pendingTransactions + props.data.Amount <= totalEquity) {
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
export const RequestPayoutController = createController(RequestPayoutOperation);
export const GetProcessorsController = createController(
  getProccessorsOperation
);
export const VoidPayoutController = createController(VoidPayoutOperation);
export const GetTransactionsController = createController(
  GetTransactionsOperation
);
export const GetPayoutRequestsController = createController(
  GetPayoutRequestsOperation
);
export const ProcessPayoutRequestsController = createController(
  ProcessPayoutRequestsOperation
);
export const GetPayoutProcessedController = createController(
  GetPayoutProcessedOperation
);
export const GetPayoutVoidedController = createController(
  GetPayoutVoidedOperation
);
export const isValidPayoutTransactionController = createController(
  isValidPayoutTransactionOperation
);
