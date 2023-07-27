import _ from "lodash";
import moment from "moment";
import { forkJoin, of, pipe, throwError, zip } from "rxjs";
import { mergeMap } from "rxjs/operators";
import { AMLreportsModel } from "../models/aml_reports.schema";
import { FundsModel } from "../models/funds.schema";
import { TransactionsModel } from "../models/transactions.schema";
import { Collection, Collectionv2 } from "../utilities/database";
import { createController } from "./helper";
const TransactionsCollection = new Collection(TransactionsModel);
const AmlReportCollection = new Collection(AMLreportsModel);
const TransactionsCollectionV2 = new Collectionv2(TransactionsModel);
const AmlReportCollectionV2 = new Collectionv2(AMLreportsModel);
const FundsCollectionV2 = new Collectionv2(FundsModel);
const AMLReportCRUD = {
  request_mapper: (req) => {
    return {
      ...req.body,
      ...req.query,
      method: req.method,
      tagger: req.middleware_auth._id,
      user: req.middleware_auth,
    };
  },
  processor: pipe(
    mergeMap((body) => {
      return zip(of(body));
    }),
    mergeMap(([body]) => {
      console.log(body);

      if (body.method === "POST") {
        let observables = [];
        for (let ID of body.TransactionIDS) {
          observables.push(
            TransactionsCollection.GET_ONE({ TransactionID: ID })
          );
        }
        const transacs = forkJoin(observables);
        return zip(transacs, of(body));
      } else if (body.method === "PATCH" || body.method === "DELETE") {
        if (body.aml_id) {
          const report = AmlReportCollection.GET_ONE({
            aml_id: body.aml_id,
          });

          return zip(report, of(body));
        } else {
          return throwError(new Error("aml_id is required"));
        }
      }
      return zip(of([]), of(body));
    }),
    mergeMap(([data, body]) => zip(of(data), of(body))),
    mergeMap(async ([transactions, body]) => {
      const method = body.method;
      //GET AML REPORTS

      if (method === "GET") {
        let funds = await FundsCollectionV2.GET({
          managers: { $in: body.tagger },
        });
        funds = _.map(funds, (obj) => obj._id);

        let match = {
          transaction_type: body.type,
          active: true,
        };

        if (body.user.UserLevel !== 1) {
          match["$expr"] = {
            $in: ["$fk_Fund", funds],
          };
        }
        const reports = await AmlReportCollectionV2.AGGREGATE([
          {
            $match: match,
          },
          {
            $lookup: {
              from: "transactions",
              let: { t_ids: "$transaction_ids" },
              pipeline: [
                { $match: { $expr: { $in: ["$TransactionID", "$$t_ids"] } } },
                // Add additional stages here
              ],
              as: "transactions",
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
            $lookup: {
              from: "funds",
              localField: "fk_Fund",
              foreignField: "_id",
              as: "fund",
            },
          },
          {
            $addFields: {
              total: {
                $sum: "$transactions.Amount",
              },
              user: { $arrayElemAt: ["$user", 0] },
              fund: { $arrayElemAt: ["$fund", 0] },
              key: "$aml_id",
            },
          },
          { $sort: { created_at: -1 } },
        ]);
        return reports;
      }

      if (method === "POST") {
        if (transactions.length === body.TransactionIDS.length) {
          //checks if all transactions matched in the collection
          let new_aml = {
            fk_Fund: null,
            fk_User: null,
            transaction_type: null,
          };
          if (transactions.length > 0) {
            const updatable = [];
            transactions.forEach((transaction, index) => {
              new_aml.fk_Fund = transaction.fk_Fund;
              new_aml.fk_User = transaction.fk_User;
              updatable.push(
                TransactionsCollection.UPDATE({
                  identifier: { TransactionID: transaction.TransactionID },
                  data: {
                    IsSTR: true,
                    IsFlagged: false,
                  },
                })
              );
              if (transaction.Type === 2) {
                new_aml.transaction_type = "redemption";
              }
              if (transaction.Type === 1) {
                new_aml.transaction_type = "subscription";
              }
            });

            forkJoin(updatable).subscribe();
          }

          return AmlReportCollection.ADD({
            fk_Fund: new_aml.fk_Fund,
            fk_User: new_aml.fk_User,
            transaction_type: new_aml.transaction_type,
            updated_at: new Date(),
            created_at: new Date(),
            remarks: body.remarks,
            transaction_ids: body.TransactionIDS,
            tagged_by: [
              {
                fk_User: body.tagger,
                action: `ADDED WITH REMARKS: ${body.remarks}`,
                date: new Date(),
              },
            ],
            active: true,
            aml_id: `AML-${moment().format("YYYYMMDD-HHmmssSS")}`,
          });
        } else {
          return throwError(new Error("transactions did not exists"));
        }
      }
      if (method === "PATCH") {
        if (transactions && transactions.aml_id) {
          AmlReportCollection.UPDATE({
            identifier: { aml_id: transactions.aml_id },
            data: {
              remarks: body.remarks,
              tagged_by: [
                ...transactions.tagged_by,
                {
                  fk_User: body.tagger,
                  action: `UPDATED WITH REMARKS: ${body.remarks}`,
                  date: new Date(),
                },
              ],
              updated_at: new Date(),
            },
          }).subscribe();
          return [];
        } else {
          throwError(new Error("AML does not exist"));
        }
        return [];
      }

      if (method === "DELETE") {
        if (transactions && transactions.aml_id) {
          AmlReportCollection.UPDATE({
            identifier: { aml_id: transactions.aml_id },
            data: {
              tagged_by: [
                ...transactions.tagged_by,
                {
                  fk_User: body.tagger,
                  action: `AML DELETED`,
                  date: new Date(),
                },
              ],
              active: false,
              updated_at: new Date(),
              IsFlagged: false,
            },
          }).subscribe();
          return [];
        }
      } else {
        return throwError(new Error("Method not recognized"));
      }
    })
  ),
  error_handler: (_req, res) => (err) => {
    console.log(err);
    res.send({
      status: "failed",
      message: err.message,
    });
  },
  response_mapper: (req, res) => (result) => {
    res.send({ status: "success", result });
  },
};

const ProcessUntaggedTransactions = async () => {
  let ctr_transactions = await TransactionsCollectionV2.GET({
    Amount: { $gte: 500000 },
  });
  const aml_collections = await AmlReportCollectionV2.GET({});

  const aml_t_ids = _.flatten(
    _.map(aml_collections, (obj) => obj.transaction_ids)
  );

  const updatable = [];

  ctr_transactions.forEach(async (transaction, index) => {
    let new_aml = {};
    new_aml.fk_Fund = transaction.fk_Fund;
    new_aml.fk_User = transaction.fk_User;

    if (!aml_t_ids.includes(transaction.TransactionID)) {
      new_aml.fk_Fund = transaction.fk_Fund;
      new_aml.fk_User = transaction.fk_User;
      updatable.push(
        TransactionsCollection.UPDATE({
          identifier: { TransactionID: transaction.TransactionID },
          data: {
            IsCTR: true,
            IsFlagged: false,
          },
        })
      );
      if (transaction.Type === 2) {
        new_aml.transaction_type = "redemption";
      }
      if (transaction.Type === 1) {
        new_aml.transaction_type = "subscription";
      }

      await AmlReportCollectionV2.ADD({
        fk_Fund: new_aml.fk_Fund,
        fk_User: new_aml.fk_User,
        transaction_type: new_aml.transaction_type,
        updated_at: new Date(),
        created_at: new Date(transaction.Date),
        remarks: "AUTOMATED",
        transaction_ids: [transaction.TransactionID],
        tagged_by: [
          {
            fk_User: "SYSTEM",
            action: `TAGGED AS CTR`,
            date: new Date(),
          },
        ],
        active: true,
        aml_id: `AML-${moment(transaction.Date).format("YYYYMMDD-HHmmssSS")}`,
      });
    }
  });

  forkJoin(updatable).subscribe();
};

export const AMLReportCRUDController = createController(AMLReportCRUD);
