import moment from "moment";
import { forkJoin, of, pipe, throwError, zip } from "rxjs";
import { mergeMap } from "rxjs/operators";
import { TransactionsModel } from "../models/transactions.schema";
import { Collection } from "../utilities/database";
import { createController } from "./helper";
const transactions = new Collection(TransactionsModel);

const TransactionUpdate = {
  request_mapper: (req) => {
    return {
      ...req.body,
    };
  },
  processor: pipe(
    mergeMap((body) => {
      return zip(
        of(body),
        transactions.GET_ONE({
          TransactionID: String(body.TransactionID),
        })
      );
    }),

    mergeMap(([body, transaction]) => {
      if (transaction) {
        const transact_doc_id = transaction._id;

        let group_id = transaction.group_id;

        if (Boolean(body.IsFlagged) === false) group_id = undefined;
        let update_data = {
          IsFlagged: !!Boolean(body.IsSTR) ? false : Boolean(body.IsFlagged),
          IsSTR: Boolean(body.IsSTR),
          group_id,
        };
        if (body.Status) update_data.Status = body.Status;
        return zip(
          of(body),
          transactions.UPDATE({
            identifier: { _id: transact_doc_id },
            data: {
              ...update_data,
            },
          })
        );
      } else {
        return throwError(new Error("Transaction not found"));
      }
    })
    // mergeMap((updated_data) => {
    //   console.log("updated_data", updated_data);
    //   return of(updated_data);
    // })
  ),
  response_mapper:
    (req, res) =>
    ([body, data]) => {
      res.send({ message: "Updated", data });
    },
  error_handler: (_req, res) => (err) => {
    res.send({
      status: "failed",
      message: err.message,
    });
  },
};

const BulkTransactionUpdate = {
  request_mapper: (req) => {
    return {
      ...req.body,
    };
  },
  processor: pipe(
    mergeMap((body) => {
      return zip(of(body));
    }),

    mergeMap(async ([body]) => {
      let results = [];

      for (let ID of body.TransactionIDS) {
        var data = await transactions.GET_TOP({ TransactionID: ID });
        results.push(data[0]);
      }
      if (results.length > 0) {
        let transactions_to_update = [];
        let g_id = `AML-${moment().format("YYYYMMDD-HHmmssSS")}`;
        for (let tran of results) {
          let group_id = tran.group_id || [];
          if (body.group_id && body.status === false) {
            const ind = group_id.indexOf(body.group_id);
            group_id.splice(ind, 1);
          } else {
            if (body.status === true && !body.group_id) {
              group_id.push(g_id);
            }
          }

          if (group_id.length === 0 || body.TransactionIDS.length === 1) {
            group_id = undefined;
          }
          let data_to_updsate = {
            IsFlagged: !!body.status ? false : true,
            IsSTR: !!group_id ? true : body.status,
            group_id,
            aml_updated_at: new Date(),
            remarks: body.status === false ? undefined : body.remarks,
          };

          transactions_to_update.push(
            transactions.UPDATE({
              identifier: { TransactionID: tran.TransactionID },
              data: data_to_updsate,
            })
          );
        }

        console.log("updating");

        return zip(
          of(body),
          of(forkJoin(transactions_to_update).subscribe((dataArray) => {}))
        );
      } else {
        return throwError(new Error("Transaction not found"));
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
  response_mapper: (req, res) => {
    res.send({ message: "Updated" });
  },
};

export const TransactionUpdateController = createController(TransactionUpdate);
export const BulkTransactionUpdateController = createController(
  BulkTransactionUpdate
);
