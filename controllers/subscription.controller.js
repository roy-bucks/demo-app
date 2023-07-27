import _ from "lodash";
import moment from "moment";
import { of, pipe, throwError, zip } from "rxjs";
import { mergeMap } from "rxjs/operators";
import { AMLreportsModel } from "../models/aml_reports.schema";
import { FundsModel } from "../models/funds.schema";
import { GeneralSettingsModel } from "../models/general_settings.schema";
import { PartnerCodeModel } from "../models/partner_code.schema";
import { SettingsModel } from "../models/settings.schema";
import { TransactionsModel } from "../models/transactions.schema";
import { Collection } from "../utilities/database";
import {
  createPartnerSetup,
  createSubscription,
  getAccessToken,
} from "../utilities/fc";
import { generateID } from "../utilities/security";
import { createController } from "./helper";
import {NavModel} from "../models/nav.schema";
const jwt = require("jsonwebtoken");

const Funds = new Collection(FundsModel);
const transactions = new Collection(TransactionsModel);
const settingsCollection = new Collection(SettingsModel);
const settings = new Collection(GeneralSettingsModel);
const partners = new Collection(PartnerCodeModel);
const AmlReportCollection = new Collection(AMLreportsModel);
const navCollection = new Collection(NavModel);

const SubscriptionCreateOperation = {
  request_mapper: (req) => {
    return {
      body: req.body,
      bank: req.bank,
      bankUser: req.bankUser,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(
        of(props),
        Funds.GET_ONE({ _id: props.body.fund }),
          settingsCollection.GET_ONE({ name: "subscription" })
      );
    }),
    mergeMap(([props, fund, settings]) => {
      if (!fund) {
        //throw error
      }
      const id = "PY" + generateID(4);
      let amountVoided = parseInt(props.body.amount);

      if (amountVoided > 500000) {
        AmlReportCollection.ADD({
          fk_Fund: fund._id,
          fk_User: props.bankUser._id,
          transaction_type: "subscription",
          updated_at: new Date(),
          created_at: new Date(),
          remarks: "AUTOMATED",
          transaction_ids: [id],
          tagged_by: [
            {
              fk_User: "SYSTEM",
              action: `TAGGED AS CTR`,
              date: new Date(),
            },
          ],
          active: true,
          aml_id: `AML-${moment().format("YYYYMMDD-HHmmssSS")}`,
        });
      }

      return zip(
        of(props),
        of(id),
        of(fund),
        transactions.ADD({
          TransactionID: id,
          RefNo: null,
          fk_User: props.bankUser._id,
          Amount: props.body.amount,
          Fee: settings.option.fee,
          PaymentMethod: "",
          Status: "P",
          Date: new Date(),
          Type: 1,
          Description: props.body.Description,
          fk_Fund: fund._id,
          isFlagged: amountVoided > 500000,
          IsCTR: true,
          IsSTR: false,
        })
      );
    }),
    mergeMap(([props, id, fund, transactionResult]) => {
      return zip(
        of({
          email: props.bankUser.Email,
          transactionID: id,
          amount: props.body.amount,
          currency: "PHP",
          fundIdentifier: fund.FundIdentifier,
          // description: fund.Description,
          fundName: fund.Name,
          verifyLink: `http://localhost:3000/api/transacting/subscription/verify?transactionID=${transactionResult._id}`,
        })
      );
    })
  ),
  response_mapper:
    (req, res) =>
    ([result]) => {
      const signature = jwt.sign({ ...result }, result.transactionID, {
        expiresIn: "60d",
      });
      res.send({
        result: result,
        sampleSignature: signature,
      });
    },
};

const SubscriptionVerifyOperation = {
  request_mapper: (req) => {
    return {
      body: req.body,
      bank: req.bank,
      bankUser: req.bankUser,
      verificationSignature: req.verificationSignature,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      if (!props.verificationSignature) {
        //throw error
      }
      return zip(
        of(props),
        transactions.GET_ONE({
          TransactionID: props.body.transactionID,
          // Status: 'P'
        })
      );
    }),
    mergeMap(([props, transaction, settings]) => {
      if (!transaction) {
        //throw error
      }
      const decodeTransactionData = jwt.decode(
        props.verificationSignature,
        transaction.transactionID
      );
      if (
        decodeTransactionData &&
        decodeTransactionData.transactionID === transaction.TransactionID
      )
        return zip(
          of(props),
          of(transaction),
          Funds.GET_ONE({ _id: transaction.fk_Fund }),
          navCollection.GET_ONE_LATEST({ fk_Fund: transaction.fk_Fund, Date: moment().format('YYYY-MM-DD') }),
          getAccessToken(),
          transactions.UPDATE({
            identifier: {
              _id: transaction._id,
            },
            data: {
              Status: "S",
              isFlagged: transaction.Amount > 500000,
              IsCTR: transaction.Amount > 500000,
              IsSTR: false,
            },
          })
        );
      else {
        console.log("incorrect signature!");
        //throw error
        return throwError(new Error("incorrect signature!"));
      }
    }),
    mergeMap(([props, transaction, fund, nav, fc_token, transactionResult]) => {
      return zip(
        of(props),
        of(transaction),
        of(fund),
        of(nav),
        of(fc_token),
        partners.GET_ONE({ fk_Fund: fund._id, fk_User: props.bankUser._id })
      );
    }),
    mergeMap(([props, transaction, fund, nav, fc_token, partnerData]) => {
      if (partnerData && partnerData.PartnerCode) {
        return zip(
          of(props),
          of(transaction),
          of(fund),
          of(nav),
          of(partnerData),
          of(fc_token)
        );
      } else {
        return zip(
          of(props),
          of(transaction),
          of(fund),
          of(nav),
          createPartnerSetup(fc_token.access_token, props.bankUser, fund),
          of(fc_token)
        );
      }
    }),
    mergeMap(([props, transaction, fund, nav, partner, fc_token]) => {
      if (partner && partner.PartnerCode) {
        return zip(
          of(props),
          of(transaction),
          of(fund),
          of(nav),
          of(partner),
          of(true),
          of(fc_token)
        );
      } else if (partner.data && partner.data.result) {
        return zip(
          of(props),
          of(transaction),
          of(fund),
          of(nav),
          partners.ADD({
            fk_User: props.bankUser._id,
            fk_Fund: fund._id,
            PartnerCode: partner.data.result.data["Partner Code"],
            DateCreated: new Date(),
            lastSubscriptionDate: new Date(),
            Series: 1
          }),
          of(true),
          of(fc_token)
        );
      } else {
        console.log("FUND PARTNER CODE ERROR: ", partner);
        return throwError(new Error("Adding of partner code failed"));
      }
    }),
    mergeMap(([props, transaction, fund, nav, partner, fc_token]) => {
        let lastSubscriptionDate = partner.lastSubscriptionDate
            ? new Date(partner.lastSubscriptionDate)
            : new Date();
        let currentDate = new Date();
        let isLastSubscriptionDateIsToday = false;
        let currentSeries = parseInt(partner.Series);
        let forPartnerUpdate = {
            lastSubscriptionDate: new Date()
        }
        console.log('currentSeries: ', currentSeries)
        console.log('-----------------------------------------------')
        console.log('lastSubscriptionDate.getFullYear(): ', lastSubscriptionDate.getFullYear())
        console.log('lastSubscriptionDate.getMonth(): ', lastSubscriptionDate.getMonth())
        console.log('lastSubscriptionDate.getDate(): ', lastSubscriptionDate.getDate())
        console.log('-----------------------------------------------')
        console.log('currentDate.getFullYear(): ', currentDate.getFullYear())
        console.log('currentDate.getMonth(): ', currentDate.getMonth())
        console.log('currentDate.getDate(): ', currentDate.getDate())
        console.log('-----------------------------------------------')
        if (
            lastSubscriptionDate.getFullYear() === currentDate.getFullYear() &&
            lastSubscriptionDate.getMonth() === currentDate.getMonth() &&
            lastSubscriptionDate.getDate() === currentDate.getDate()
        ) {
            isLastSubscriptionDateIsToday = true;
        } else {
            isLastSubscriptionDateIsToday = false;
        }
        console.log('isLastSubscriptionDateIsToday: ', isLastSubscriptionDateIsToday)

        if(isLastSubscriptionDateIsToday){

        }else{
            currentSeries += 1;
            forPartnerUpdate.Series = currentSeries.toString();
        }

        console.log('partner._id: ', partner._id)
        console.log('forPartnerUpdate: ', forPartnerUpdate)

        return zip(
            of(props),
            of(transaction),
            of(fund),
            of(nav),
            of(partner),
            of(true),
            of(fc_token),
            of(currentSeries),
            partners.UPDATE({
                identifier: {
                    _id: partner._id
                },
                data: forPartnerUpdate
            })
        )
    }),
    mergeMap(([props, transaction, fund, nav, partner, result, fc_token, currentSeries, partnerUpdateIgnore]) => {
        console.log('partnerUpdateIgnore: ', partnerUpdateIgnore);
      if (partner == null) {
        return throwError(new Error("Adding of partner code failed"));
      }
      let fc_subscription_data = {
        Amount: transaction.Amount,
        FundIdentifier: fund.FundIdentifier,
        Fund_ID: fund._id.toString(),
        PartnerCode: partner.PartnerCode,
        Series: currentSeries,
        nav: (nav && nav.NavPerShare && nav.NavPerShare > 0) ? nav.NavPerShare : 0,
      };
      let firstDaySubscription = fund.firstDaySubscription
        ? new Date(fund.firstDaySubscription)
        : new Date();
      let currentDate = new Date();
      if (
        firstDaySubscription.getFullYear() === currentDate.getFullYear() &&
        firstDaySubscription.getMonth() === currentDate.getMonth() &&
        firstDaySubscription.getDate() === currentDate.getDate()
      ) {
        fc_subscription_data.firstDaySubscription = true;
      } else {
        fc_subscription_data.firstDaySubscription = false;
      }
      return zip(
        of(props),
        of(transaction),
        of(fund),
        of(nav),
        of(fc_subscription_data.firstDaySubscription),
        createSubscription(fc_token.access_token, fc_subscription_data)
      );
    }),
    mergeMap(
      ([props, transaction, fund, nav, firstDaySubscription, fc_subscription]) => {
        console.log("fc_subscription: ", fc_subscription);
        if (fc_subscription.result && fc_subscription.result.code == 0) {
          if (firstDaySubscription) {
            return zip(
              of(props),
              transactions.UPDATE({
                identifier: {
                  _id: transaction._id,
                },
                data: {
                  SubscriptionData: fc_subscription.result,
                },
              }),
              Funds.UPDATE({
                identifier: {
                  _id: fund._id,
                },
                data: {
                  firstDaySubscription: new Date(),
                },
              })
            );
          } else {
            return zip(
              of(props),
              transactions.UPDATE({
                identifier: {
                  _id: transaction._id,
                },
                data: {
                  SubscriptionData: fc_subscription.result,
                },
              })
            );
          }
        } else {
          return throwError(new Error("Subscription to FC failed!"));
        }
      }
    )
  ),
  response_mapper:
    (req, res) =>
    ([result]) => {
      res.send({
        success: true,
      });
    },
  error_handler: (_req, res) => (err) => {
    console.log("");
    console.log("");
    console.log("");
    console.log("err: ", err);
    console.log("");
    console.log("");
    console.log("");
    console.log(
      "END--------------------------------------(PROCESSING SUBSCRIPTION)--------------------------------------END"
    );
    res.status(400).json({
      code: 7,
      message: "Missing or invalid parameters",
      status: 400,
    });
  },
};

const FlagSubscriptionOperation = {
  request_mapper: (req) => {
    return {
      body: req.body,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(
        of(props),
        transactions.GET_ONE({
          _id: props.body.subscriptionId,
        })
      );
    }),
    mergeMap(([props, result]) => {
      if (!result) {
        //throw error
      }
      return zip(
        transactions.UPDATE({
          identifier: {
            _id: result._id,
          },
          data: {
            Status: "V",
          },
        })
      );
    })
  ),
  response_mapper:
    (req, res) =>
    ([result]) => {
      console.log("result: ", result);
      res.send({
        success: true,
      });
    },
};

const GetFlaggedSubscriptionOperation = {
  request_mapper: (req) => {
    return {
      body: req.body,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      if (!props.verificationSignature) {
        //throw error
      }
      return zip(
        of(props),
        transactions.GET({
          Status: "V",
        })
      );
    }),
    mergeMap(([props, transaction]) => {
      return zip(of(transaction));
    })
  ),
  response_mapper:
    (req, res) =>
    ([result]) => {
      res.send({
        transactions: result,
      });
    },
};

const AMLSubscriptionOperation = {
  request_mapper: (req) => {
    return {
      body: req.body,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(
        of(props),
        transactions.GET_ONE({
          _id: props.body.subscriptionId,
        })
      );
    }),
    mergeMap(([props, result]) => {
      if (!result) {
        //throw error
      }
      return zip(
        transactions.UPDATE({
          identifier: {
            _id: result._id,
          },
          data: {
            Status: "AML",
          },
        })
      );
    })
  ),
  response_mapper:
    (req, res) =>
    ([result]) => {
      res.send({
        success: true,
      });
    },
};

const GetAMLSubscriptionOperation = {
  request_mapper: (req) => {
    return {
      body: req.body,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      if (!props.verificationSignature) {
        //throw error
      }
      return zip(
        of(props),
        transactions.AGGREGATE([
          {
            $lookup: {
              from: "transactions",
              localField: "transactions",
              foreignField: "_id",
              as: "transactions",
            },
          },
          {
            $match: {
              $or: [
                {
                  IsCTR: true,
                },
                {
                  IsSTR: true,
                },
              ],
            },
          },
          {
            $lookup: {
              from: "user",
              localField: "fk_User",
              foreignField: "_id",
              as: "user",
            },
          },
          //   {
          //     $set: { user: { $arrayElemAt: ["$user", 0] } },
          //   },
        ])
      );
    }),
    mergeMap(([props, transaction]) => {
      let holders = transaction.map((tran) => {
        return { user_id: tran.fk_User, user: tran.user[0] };
      });

      holders = _.uniqWith(holders, _.isEqual);

      holders = holders.map((holder) => {
        return {
          ...holder,
          transactions: _.filter(transaction, { fk_User: holder.user_id }),
          total: _.sumBy(
            _.filter(transaction, { fk_User: holder.user_id }),
            "Amount"
          ),
        };
      });

      //grouped by group_id
      const CTRs = [];
      const STRs = [];
      let group_ids = [];
      transaction.forEach((tran) => {
        if (tran.IsCTR) CTRs.push({ ...tran, IsSTR: false });
        if (tran.IsSTR) STRs.push({ ...tran });
        if (!!tran.group_id) {
          tran.group_id.forEach((g_id) => {
            group_ids.push({
              group_id: g_id,
              user: tran.user,
              Date: tran.aml_updated_at ? tran.aml_updated_at : tran.Date,
              fund_identifier:
                tran.SubscriptionData &&
                tran.SubscriptionData.data.fund_identifier,
              Status: tran.Status,
              remarks: tran.remarks,
            });
          });
        }
      });

      group_ids = _.compact(group_ids);
      group_ids = _.uniqBy(group_ids, "group_id");

      group_ids = group_ids.map((group) => {
        return {
          ...group,
          transactions: _.filter(transaction, (obj) => {
            return obj.group_id && obj.group_id.includes(group.group_id);
          }),
          total: _.sumBy(
            _.filter(
              transaction,
              (obj) => obj.group_id && obj.group_id.includes(group.group_id)
            ),
            "Amount"
          ),
        };
      });
      group_ids = [...group_ids, ...CTRs, ...STRs];
      group_ids = _.orderBy(group_ids, "Date", "desc");
      //end group_id

      return zip(of(transaction), of(holders), of(group_ids));
    })
  ),
  response_mapper:
    (req, res) =>
    ([result, grouped, group_ids]) => {
      res.send({
        transactions: result,
        grouped_by_investor: grouped,
        by_group_id: group_ids,
      });
    },
};

export const SubscriptionCreateController = createController(
  SubscriptionCreateOperation
);
export const SubscriptionVerifyController = createController(
  SubscriptionVerifyOperation
);
export const FlagSubscriptionController = createController(
  FlagSubscriptionOperation
);
export const GetFlaggedSubscriptionController = createController(
  GetFlaggedSubscriptionOperation
);
export const AMLSubscriptionController = createController(
  AMLSubscriptionOperation
);
export const GetAMLSubscriptionController = createController(
  GetAMLSubscriptionOperation
);
