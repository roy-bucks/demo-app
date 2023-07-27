import chalk from "chalk";
import _ from "lodash";
import moment from "moment";
import { of, pipe, throwError, zip } from "rxjs";
import { mergeMap } from "rxjs/operators";
import { AMLreportsModel } from "../models/aml_reports.schema";
import { FundsModel } from "../models/funds.schema";
import { GeneralSettingsModel } from "../models/general_settings.schema";
import { PartnerCodeModel } from "../models/partner_code.schema";
import { PayoutRequestModel } from "../models/payout_request.schema";
import { SettingsModel } from "../models/settings.schema";
import { TransactionsModel } from "../models/transactions.schema";
import { Collection } from "../utilities/database";
import { createRedemption, getAccessToken } from "../utilities/fc";
import { generateID } from "../utilities/security";
import { createController } from "./helper";
const jwt = require("jsonwebtoken");

const Funds = new Collection(FundsModel);
const transactions = new Collection(TransactionsModel);
const settingsCollection = new Collection(SettingsModel);
const settings = new Collection(GeneralSettingsModel);
const partners = new Collection(PartnerCodeModel);
const payout_request = new Collection(PayoutRequestModel);
const AmlReportCollection = new Collection(AMLreportsModel);
const RedemptionOperation = {
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
          settingsCollection.GET_ONE({ name: "redemption" })
      );
    }),
    mergeMap(([props, fund, settings]) => {
      if (!fund) {
        //throw error
      }
      const id = "PO" + generateID(4);
      let amountVoided = parseInt(props.body.amount);
      console.log("props.body: ", props.body);
      console.log("props.amountVoided: ", amountVoided);
      return zip(
        of(props),
        of(id),
        of(fund),
        transactions.ADD({
          TransactionID: id,
          RefNo: null,
          fk_User: props.bankUser._id,
          Amount: props.body.Amount || props.body.amount,
          Fee: settings.option.fee,
          PaymentMethod: "",
          Status: "P",
          Date: new Date(),
          Type: 2,
          Description: "",
          fk_Fund: fund._id,
        }),
        partners.GET_ONE({ fk_Fund: fund._id, fk_User: props.bankUser._id })
      );
    }),
    mergeMap(([props, id, fund, transactionResult, partner]) => {
      let amountVoided = parseInt(props.body.amount);
      if (amountVoided > 500000) {
        AmlReportCollection.ADD({
          fk_Fund: fund._id,
          fk_User: props.bankUser._id,
          transaction_type: "redemption",
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
      const data = {
        TransactionID: id,
        FirstName: props.bankUser.FirstName,
        MiddleName: props.bankUser.MiddleName,
        LastName: props.bankUser.LastName,
        Amount: props.body.amount,
        Currency: "PHP",
        Description: "",
        ProcId: "",
        ProcDetail: "",
        Email: props.bankUser.Email,
        MobileNo: props.bankUser.MobileNo,
      };
      return zip(
        of(data),
        payout_request.ADD({
          fk_User: props.bankUser._id,
          fk_Transaction: transactionResult._id,
          fk_Fund: fund._id,
          fk_Partner: partner._id,
          Date: new Date(),
          Type: 2,
          Status: amountVoided > 500000 ? "P" : "P", //P - PENDING PROCESS FOR EOD | S - PROCESSED
          data: data,
        })
      );
    })
  ),
  response_mapper:
    (req, res) =>
    ([result, payout]) => {
      console.log("result: ", result);
      const signature = jwt.sign({ ...result }, result.TransactionID, {
        expiresIn: "60d",
      });
      res.send({
        result: result,
        sampleSignature: signature,
      });
    },
};

const RedemptionVerifyOperation = {
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
      console.log("props: ", props);
      if (!props.verificationSignature) {
        //throw error
      }
      return zip(
        of(props),
        transactions.GET_ONE({
          TransactionID: props.body.transactionID,
          Type: 2,
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
      console.log("decodeTransactionData: ", decodeTransactionData);
      console.log("transaction: ", decodeTransactionData.TransactionID);
      console.log("transaction: ", transaction.TransactionID);
      console.log(
        "verifying signature: ",
        decodeTransactionData
          ? decodeTransactionData.TransactionID === transaction.TransactionID
          : false
      );
      let amountVoided = parseInt(props.body.amount);
      if (
        decodeTransactionData &&
        decodeTransactionData.TransactionID === transaction.TransactionID
      )
        return zip(
          of(props),
          of(transaction),
          Funds.GET_ONE({ _id: transaction.fk_Fund }),
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
          }),
          payout_request.UPDATE({
            identifier: {
              fk_Transaction: transaction._id,
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
    mergeMap(
      ([
        props,
        transaction,
        fund,
        fc_token,
        transactionResult,
        payoutResult,
      ]) => {
        return zip(
          of(props),
          of(transaction),
          of(fund),
          of(fc_token),
          partners.GET_ONE({ fk_Fund: fund._id, fk_User: props.bankUser._id })
        );
      }
    ),
    mergeMap(([props, transaction, fund, fc_token, partnerData]) => {
      console.log("accessToken: ", fc_token);
      console.log("partnerData: ", partnerData);
      if (partnerData && partnerData.PartnerCode) {
        const fc_redemption_data = {
          Amount: transaction.Amount,
          FundIdentifier: fund.FundIdentifier,
          FundID: fund._id.toString(),
          PartnerCode: partnerData.PartnerCode,
          LeadTime:
            fund.LeadTime && parseInt(fund.LeadTime) > 0
              ? parseInt(fund.LeadTime)
              : 1,
        };
        return zip(
          of(transaction),
          createRedemption(fc_token.access_token, fc_redemption_data)
        );
      } else {
        console.log("FUND PARTNER CODE ERROR: ", partnerData);
        return throwError(new Error("Adding of partner code failed"));
      }
    }),
    mergeMap(([transaction, fc_redemption]) => {
      console.log("fc_redemption: ", fc_redemption);
      if (fc_redemption.result && fc_redemption.result.code == 0) {
        return zip(
          transactions.UPDATE({
            identifier: {
              _id: transaction._id,
            },
            data: {
              RedemptionData: fc_redemption.result,
            },
          }),
          payout_request.UPDATE({
            identifier: {
              fk_Transaction: transaction._id,
            },
            data: {
              RedemptionData: fc_redemption.result,
            },
          })
        );
      } else {
        return throwError(new Error("Subscription to FC failed!"));
      }
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

const GetAMLRedemptionOperation = {
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
        payout_request.AGGREGATE([
          {
            $lookup: {
              from: "transactions",
              localField: "fk_Transaction",
              foreignField: "_id",
              as: "transaction",
            },
          },
          {
            $lookup: {
              from: "funds",
              localField: "fk_Fund",
              foreignField: "_id",
              as: "fund",
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
          {
            $match: {
              $or: [
                { "transaction.IsSTR": true },
                { "transaction.IsCTR": true },
              ],
            },
          },

          {
            $set: {
              transaction: { $arrayElemAt: ["$transaction", 0] },
              fund: { $arrayElemAt: ["$fund", 0] },
            },
          },
        ])
      );
    }),
    mergeMap(([props, transaction]) => {
      //grouped by group_id
      const CTRs = [];
      const ungrouped_STRs = [];
      let group_ids = [];
      transaction.forEach((payout_req) => {
        const tran = payout_req.transaction;
        console.log("payout transaction  ===> ", payout_req);
        if (tran.IsCTR)
          CTRs.push({ ...tran, IsSTR: false, user: payout_req.user });
        if (tran.IsSTR && !tran.group_id)
          ungrouped_STRs.push({
            ...tran,
            user: payout_req.user,
            ...payout_req,
            IsCTR: false,
          });
        if (!!tran.group_id) {
          tran.group_id.forEach((g_id) => {
            group_ids.push({
              group_id: g_id,
              user: payout_req.user,
              Date: tran.aml_updated_at,
              fund_identifier:
                tran.RedemptionData && tran.RedemptionData.data.fund_identifier,
              Status: tran.Status,
              remarks: tran.remarks,
            });
          });
        }
      });

      group_ids = _.compact(group_ids); // remove null arrays
      group_ids = _.uniqBy(group_ids, "group_id");

      group_ids = group_ids.map((group) => {
        return {
          ...group,
          transactions: _.filter(transaction, (obj) => {
            console.log("req obj => ", obj.transaction);
            return (
              obj.transaction.group_id &&
              obj.transaction.group_id.includes(group.group_id)
            );
          }),
          total: _.sumBy(
            _.filter(
              transaction,
              (obj) =>
                obj.transaction.group_id &&
                obj.transaction.group_id.includes(group.group_id)
            ),
            "RedemptionData.data.amount"
          ),
        };
      });
      group_ids = [...group_ids, ...CTRs, ...ungrouped_STRs];

      group_ids = _.orderBy(group_ids, "Date", "desc");

      console.log(chalk.bgYellowBright(" group by group_id => "));
      console.log("by froup ids == ", group_ids);

      let holders = transaction.map((tran) => {
        return { user_id: tran.fk_User, user: tran.user[0], fund: tran.fund };
      });

      holders = _.uniqWith(holders, _.isEqual);

      holders = holders.map((holder) => {
        return {
          ...holder,
          transactions: _.map(
            _.filter(transaction, { fk_User: holder.user_id }),
            (obj) => {
              return { ...obj.transaction, fund: obj.fund };
            }
          ),
          total: _.sumBy(
            _.map(_.filter(transaction, { fk_User: holder.user_id }), (obj) => {
              return obj.transaction;
            }),
            "Amount"
          ),
        };
      });

      return zip(of(props), of(transaction), of(holders), of(group_ids));
    })
  ),
  response_mapper:
    (req, res) =>
    ([body, result, grouped, by_group_id]) => {
      res.send({
        transactions: result,
        grouped_by_investor: grouped,
        by_group_id,
        query: body,
      });
    },
};

export const RedemptionController = createController(RedemptionOperation);
export const RedemptionVerifyController = createController(
  RedemptionVerifyOperation
);
export const GetAMLRedemptionController = createController(
  GetAMLRedemptionOperation
);
