import moment from "moment";
import { forkJoin, of, pipe, throwError, zip } from "rxjs";
import { mergeMap } from "rxjs/operators";
import { FC_ConfigModel } from "../models/fc_config.schema";
import { FundsModel } from "../models/funds.schema";
import { NavModel } from "../models/nav.schema";
import { PartnerCodeModel } from "../models/partner_code.schema";
import { TransactionsFCModel } from "../models/transactions_fc.schema";
import { UserTotalEquityModel } from "../models/user_total_equity.schema";
import { formatDatev2, splitToChunks, subtractDate } from "../utilities";
import { Collection, Collectionv2 } from "../utilities/database";
import {
  getAccessToken,
  getConfig,
  getContractNotes,
  getContractNotes_Summary,
  getDailyNav,
  getDailyNav_PromisedBased,
  getTotalEquity,
  getTradingDates,
  updateConfig,
} from "../utilities/fc";
import { generateCode } from "../utilities/security";
import { uploadFile } from "../utilities/upload";
import { createController, generateRequiredSchemaItems } from "./helper";

var groupBy = require("group-by");
const jwt = require("jsonwebtoken");

const Funds = new Collection(FundsModel);
const FundsConfig = new Collection(FC_ConfigModel);
const Navs = new Collection(NavModel);
const Navs_ = new Collectionv2(NavModel);
const Partners = new Collection(PartnerCodeModel);
const Transactions_FC = new Collection(TransactionsFCModel);
const TotalEquity = new Collection(UserTotalEquityModel);
const navCollection_v2 = new Collectionv2(NavModel);
const getFundList_AdminOperation = {
  request_mapper: (req) => req.body,
  processor: pipe(
    mergeMap((props) => getAccessToken()),
    mergeMap(async (props) => {
      var funds = await getConfig(props.access_token);

      console.log("The backend prod funds is ");
      console.log(funds);

      let observables = [];
      for (let fund of funds.account_nos) {
        // console.log(fund)
        observables.push(
          Funds.UPDATE({
            identifier: {
              FundIdentifier: fund.fund_identifier,
            },
            data: {
              Fund_ID: fund.fund_id,
              AccountNo: fund.account_no,
              DateUpdated: new Date(),
            },
          })
        );
      }
      observables.push(
        FundsConfig.UPDATE({
          identifier: {
            Config_ID: "BXB",
          },
          data: {
            min_holding_period: funds.min_holding_period,
            min_maintaining_bal: funds.min_maintaining_bal,
            min_redemption_val: funds.min_redemption_val,
            min_subscription_val: funds.min_subscription_val,
            richer_exp: funds.richer_exp,
            DateUpdated: new Date(),
          },
        })
      );
      return forkJoin(observables).subscribe((dataArray) => {});
    }),
    mergeMap((props) => Funds.GET())
  ),
  response_mapper: (req, res) => (props) => {
    res.send({
      data: props,
    });
  },
};

const getFundListOperation = {
  request_mapper: (req) => {
    return {
      userData: req.middleware_auth,
      body: req.query,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      const is_get_today =
        moment() > moment(`${moment().format("YYYY-MM-DD")}`).add(12, "hours");

      return zip(
        of(props),
        Funds.AGGREGATE([
          {
            $lookup: {
              from: "nav",
              let: {
                date: formatDatev2(
                  new Date(
                    is_get_today
                      ? moment().format("YYYY-MM-DD")
                      : moment().subtract(1, "day").format("YYYY-MM-DD")
                  )
                ),
                id: "$_id",
              },
              pipeline: [
                { $match: { $expr: { $eq: ["$Date", "$$date"] } } },
                { $match: { $expr: { $eq: ["$fk_Fund", "$$id"] } } },
              ],
              as: "navs",
            },
          },
          {
            $unwind: {
              path: "$navs",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $project: {
              _id: 1,
              FundIdentifier: 1,
              AccountNo: 1,
              DateCreated: 1,
              Fund_ID: 1,
              Logo: 1,
              Name: 1,
              Description: 1,
              managers: 1,
              LockUpPeriod: 1,
              MinInvestment: 1,
              SettlementPeriod: 1,
              PerformanceFee: 1,
              TransactionFee: 1,
              DateUpdated: 1,
              FundType: 1,
              RiskType: 1,
              Prospectus: 1,
              FundClass: 1,
              InceptionDate: 1,
              Market: 1,
              Benchmark: 1,
              BaseCurrency: 1,
              Penalty: 1,
              RedemptionFee: 1,
              SalesFee: 1,
              Website: 1,
              navs: 1,
              FundSize: 1,
              allowImport: 1,
            },
          },
        ])
      );
    }),
    mergeMap(([props, funds]) => {
      let temp = [];
      let userId = props.userData._id.toString();
      if (props.userData.UserLevel === 1) {
        return zip(of(funds));
      }
      for (let i = 0; i < funds.length; i++) {
        let fund = funds[i];
        let fundManagers =
          fund.managers && fund.managers.length
            ? fund.managers.map((item) => {
                return item.toString();
              })
            : [];
        if (
          fundManagers &&
          fundManagers.length &&
          fundManagers.indexOf(userId) >= 0
        ) {
          temp.push(fund);
        }
      }
      return zip(of(temp));
    }),
    mergeMap(([funds]) => {
      const data = of(funds).pipe(
        mergeMap(async () => {
          let temp = [];
          const is_get_today =
            moment() >
            moment(`${moment().format("YYYY-MM-DD")}`).add(12, "hours");
          for (let fund of funds) {
            if (!fund.navs && !is_get_today) {
              const navs = await navCollection_v2
                .GET({
                  fk_Fund: fund._id,
                  $or: [
                    { NavPerShare: { $ne: 0 } },
                    { NavPerShare: { $ne: null } },
                  ],
                  DateCreated: {
                    $lt: new Date(moment().format("YYYY-MM-DD")),
                  },
                })
                .sort({ Date: -1 })
                .limit(1);
              temp.push({ ...fund, navs: navs[0] });
            } else {
              temp.push(fund);
            }
          }
          return temp;
        })
      );
      return zip(data);
    })
  ),
  response_mapper:
    (req, res) =>
    ([funds]) => {
      res.send({
        data: funds,
      });
    },
};

const getFilterFunds = {
  request_mapper: (req) => req.query,
  processor: pipe(
    mergeMap((props) => {
      if (Object.keys(props).length === 0) {
        return throwError(new Error("NO DATA"));
      }

      const query = {
        $or: [
          { FundType: props.FundType },
          { RiskType: props.RiskType },
          { FundClass: props.FundClass },
          { Benchmark: props.Benchmark },
        ],
      };
      return zip(Funds.GET(query));
    })
  ),
  response_mapper:
    (req, res) =>
    ([props]) => {
      res.send({
        data: props,
      });
    },
  error_handler: (_req, res) => (err) => {
    let status = 400;
    console.log(err);

    if (err.message === "NO DATA") {
      err.message = "No param found!";
    } else if (err.message === "UNAUTHORIZED") {
      status = 403;
    } else {
      err.message = "Something went wrong";
    }

    res.status(status).json({
      code: status,
      status: "failed",
      message: err.message,
    });
  },
};

const updateFundOperation = {
  requestValidationSchema: generateRequiredSchemaItems([
    "body.AccountNo",
    "body.FundIdentifier",
    "body.Name",
    "body.Description",
    "body._id",
  ]),
  request_mapper: (req) => req.body,
  processor: pipe(
    mergeMap((props) => {
      return Funds.UPDATE({
        identifier: {
          _id: props._id,
        },
        data: {
          AccountNo: props.AccountNo,
          FundIdentifier: props.FundIdentifier,
          Name: props.Name,
          Description: props.Description,
          TransactionFee: props.TransactionFee,
          MinInvestment: props.MinInvestment,
          LockUpPeriod: props.LockUpPeriod,
          SettlementPeriod: props.SettlementPeriod,
          RiskType: props.RiskType,
          FundType: props.FundType,
          ComplementaryFunds: props.ComplementaryFunds,
          PerformanceFee: props.PerformanceFee,
          FundClass: props.FundClass,
          InceptionDate: props.InceptionDate,
          Market: props.Market,
          Benchmark: props.Benchmark,
          BaseCurrency: props.BaseCurrency,
          Penalty: props.Penalty,
          RedemptionFee: props.RedemptionFee,
          SalesFee: props.SalesFee,
          Website: props.Website,
          DateUpdated: new Date(),
        },
      });
    }),
    mergeMap((props) => Funds.GET()),
    mergeMap((props) => {
      return zip(
        of(props),
        FundsConfig.GET_ONE({ Config_ID: "BXB" }),
        getAccessToken()
      );
    }),
    mergeMap(([funds, funds_config, props]) => {
      let config = [];
      for (let fund of funds) {
        config.push({
          account_no: fund.AccountNo,
          fund_id: fund.Fund_ID,
          fund_identifier: fund.FundIdentifier,
        });
      }
      return zip(
        updateConfig(props.access_token, config, funds_config),
        of(funds)
      );
    })
  ),
  response_mapper:
    (req, res) =>
    ([result, funds]) => {
      res.send({
        data: funds,
      });
    },
};

const getDailyNavOperation = {
  request_mapper: (req) => req.query,
  processor: mergeMap((props) =>
    of(props).pipe(
      mergeMap((val) => getAccessToken()),
      mergeMap((token) =>
        getDailyNav(token.access_token, props.FundIdentifier)
      ),
      mergeMap((nav) => {
        console.log("nav: ", nav);
        return of(nav).pipe(
          mergeMap(() =>
            Funds.GET_ONE({ FundIdentifier: props.FundIdentifier })
          ),
          mergeMap((fund) => Navs.GET({ fk_Fund: fund._id }))
        );
      })
    )
  ),
  response_mapper: (req, res) => (result) => {
    res.send({
      data: result,
    });
  },
};

const getTotalEquityOperation = {
  requestValidationSchema: generateRequiredSchemaItems(["body.FundIdentifier"]),
  request_mapper: (req) => {
    return {
      data: req.body,
      user: req.middleware_auth,
    };
  },
  processor: mergeMap((props) => {
    return of(props).pipe(
      mergeMap((val) =>
        Funds.GET_ONE({ FundIdentifier: props.data.FundIdentifier })
      ),
      mergeMap((fund) => {
        return zip(
          getAccessToken(),
          Partners.GET_ONE({ fk_Fund: fund._id, fk_User: props.user._id })
        );
      }),
      mergeMap(([token, partner]) =>
        getTotalEquity(token.access_token, {
          ...props.data,
          PartnerCode: partner.PartnerCode,
        })
      ),
      mergeMap((equity) => {
        console.log("equity: ", equity);
        var temp = Object.values(equity.result.data);
        var result = {
          totalEquity: temp[0],
        };
        return of(result);
      })
    );
  }),
  response_mapper: (req, res) => (val) => {
    res.send({
      data: val,
    });
  },
};

const getContractNotesOperation = {
  requestValidationSchema: generateRequiredSchemaItems([
    "body.FundIdentifier",
    "body.StartDate",
    "body.EndDate",
  ]),
  request_mapper: (req) => {
    return {
      data: req.body,
      user: req.middleware_auth,
    };
  },
  processor: mergeMap((props) => {
    return of(props).pipe(
      mergeMap((val) =>
        Funds.GET_ONE({ FundIdentifier: props.data.FundIdentifier })
      ),
      mergeMap((fund) => {
        return zip(
          getAccessToken(),
          Partners.GET_ONE({ fk_Fund: fund._id, fk_User: props.user._id })
        );
      }),
      mergeMap(([token, partner]) => {
        const data = {
          partner_code: partner.PartnerCode,
          fund_identifier: props.data.FundIdentifier,
          start_date: props.data.StartDate,
          end_date: props.data.EndDate,
        };
        return zip(
          getContractNotes(token.access_token, data),
          getContractNotes_Summary(token.access_token, {
            partner_code: data.partner_code,
            fund_identifier: data.fund_identifier,
          }),
          of(partner)
        );
      }),
      mergeMap(([contract_notes, contract_notes_summary, partner]) => {
        console.log("contract_notes: ", contract_notes);
        console.log("contract_notes_summary: ", contract_notes_summary);
        if (contract_notes.success && contract_notes_summary.success) {
          return zip(
            Partners.UPDATE({
              identifier: {
                _id: partner._id,
              },
              data: {
                Balance:
                  contract_notes.result.data.balance === undefined ||
                  contract_notes.result.data.balance == ""
                    ? 0
                    : parseFloat(
                        contract_notes.result.data.balance.replace(/,/g, "")
                      ),
                TotalEquity:
                  contract_notes_summary.result.data.total_equity === undefined
                    ? 0
                    : parseFloat(
                        contract_notes_summary.result.data.total_equity
                      ),
                TotalPaidIn:
                  contract_notes_summary.result.data.total_paid_in === undefined
                    ? 0
                    : parseFloat(
                        contract_notes_summary.result.data.total_paid_in
                      ),
                TotalUnits:
                  contract_notes_summary.result.data.total_units === undefined
                    ? 0
                    : parseFloat(
                        contract_notes_summary.result.data.total_units
                      ),
              },
            }),
            of(contract_notes),
            Partners.GET_ONE({
              fk_Fund: partner.fk_Fund,
              fk_User: props.user._id,
            })
            // TotalEquity.UPDATE({
            //   identifier: {
            //     Date: moment().format('YYYY-MM-DD').toString(),
            //     fk_Fund: partner.fk_Fund,
            //     fk_User: partner.fk_User
            //   },
            //   data: {
            //     TotalEquity: (contract_notes_summary.data.total_equity === undefined) ? 0 : parseFloat(contract_notes_summary.data.total_equity),
            //     PartnerCode: partner.PartnerCode,
            //     DateCreated: new Date()
            //   }
            // })
          );
        } else {
          return zip(
            of(contract_notes),
            of({ data: { transaction: [] } }),
            Partners.GET_ONE({
              fk_Fund: partner.fk_Fund,
              fk_User: props.user._id,
            })
          );
        }
      }),
      mergeMap(([temp, contract_notes, partner]) => {
        let transactions;
        return of(transactions).pipe(
          mergeMap(async () => {
            var observables = [];
            for (let transaction of contract_notes.result.data.transaction) {
              console.log("transaction: ", transaction);
              console.log("capital: ", transaction.capital);
              observables.push(
                Transactions_FC.UPDATE({
                  identifier: {
                    Date: transaction.date,
                    fk_Partner: partner._id,
                    fk_Fund: partner.fk_Fund,
                    fk_User: props.user._id,
                    series: transaction.series,
                    Type: transaction.transaction,
                  },
                  data: {
                    amount:
                      transaction.amount === "" || transaction.amount == null
                        ? 0
                        : parseFloat(transaction.amount),
                    capital:
                      transaction.capital === "" || transaction.capital == null
                        ? 0
                        : parseFloat(transaction.capital),
                    fee:
                      transaction.fee == "" || transaction.fee == null
                        ? 0
                        : parseFloat(transaction.fee.replace(/,/g, "")),
                    net_proceeds:
                      transaction.net_proceeds === "" ||
                      transaction.net_proceeds == null
                        ? 0
                        : parseFloat(
                            transaction.net_proceeds.replace(/,/g, "")
                          ),
                    Type: transaction.transaction,
                    unit_price:
                      transaction.unit_price === "" ||
                      transaction.unit_price == null
                        ? 0
                        : parseFloat(transaction.unit_price),
                    units:
                      transaction.units === "" || transaction.units == null
                        ? 0
                        : parseFloat(transaction.units),
                    units_ending_values:
                      transaction.units_ending_values === "" ||
                      transaction.units_ending_values == null
                        ? 0
                        : parseFloat(transaction.units_ending_values),
                  },
                })
              );
              console.log("data: ", {
                amount:
                  transaction.amount === "" || transaction.amount == null
                    ? 0
                    : parseFloat(transaction.amount),
                capital:
                  transaction.capital === "" || transaction.capital == null
                    ? 0
                    : parseFloat(transaction.capital),
                fee:
                  transaction.fee == "" || transaction.fee == null
                    ? 0
                    : parseFloat(transaction.fee.replace(/,/g, "")),
                net_proceeds:
                  transaction.net_proceeds === "" ||
                  transaction.net_proceeds == null
                    ? 0
                    : parseFloat(transaction.net_proceeds.replace(/,/g, "")),
                Type: transaction.transaction,
                unit_price:
                  transaction.unit_price === "" ||
                  transaction.unit_price == null
                    ? 0
                    : parseFloat(transaction.unit_price),
                units:
                  transaction.units === "" || transaction.units == null
                    ? 0
                    : parseFloat(transaction.units),
                units_ending_values:
                  transaction.units_ending_values === "" ||
                  transaction.units_ending_values == null
                    ? 0
                    : parseFloat(transaction.units_ending_values),
              });
            }
            return forkJoin(observables).subscribe((dataArray) => {});
          }),
          mergeMap(() =>
            Transactions_FC.GET_LATEST({
              fk_Partner: partner._id,
              fk_User: props.user._id,
            })
          ),
          mergeMap((transactions_fc) => {
            var result = {
              ...partner._doc,
              transactions: transactions_fc,
            };
            return of(result);
          })
        );
      })
    );
  }),
  response_mapper: (req, res) => (val) => {
    console.log("GET_CONTRACT_NOTES: SUCCESS");
    res.send({
      data: val,
    });
  },
};

const getTradingDatesOperation = {
  request_mapper: (req) => req.query,
  processor: mergeMap((props) =>
    of(props).pipe(
      mergeMap((val) => getAccessToken()),
      mergeMap((token) => getTradingDates(token.access_token))
    )
  ),
  response_mapper: (req, res) => (result) => {
    console.log("result: ", result);
    res.send({
      dates: result,
    });
  },
};

const addNavRatesOperation = {
  requestValidationSchema: generateRequiredSchemaItems([
    "body.Navs",
    "body.fk_Fund",
  ]),
  request_mapper: (req) => req.body,
  processor: mergeMap((props) => {
    let results;
    return of(results).pipe(
      mergeMap(async () => {
        let observables = [];
        console.log(props);
        for (let prop of props.Navs) {
          observables.push(
            Navs.UPDATE({
              identifier: {
                fk_Fund: props.fk_Fund,
                Date: moment(prop.Date).format("YYYY-MM-DD").toString(),
              },
              data: {
                NavPerShare: prop.NavPerShare,
                DateCreated: new Date(
                  moment(prop.Date).format("YYYY-MM-DD").toString()
                ),
              },
            })
          );
        }
        return forkJoin(observables).subscribe((dataArray) => {});
      }),
      mergeMap(() => Navs.GET_LATEST({ fk_Fund: props.fk_Fund }))
    );
  }),
  response_mapper: (req, res) => (navs) => {
    res.send({
      data: navs,
    });
  },
};

const getNavGraphOperation = {
  requestValidationSchema: generateRequiredSchemaItems([
    "body.fk_Fund",
    "body.Category",
  ]),
  request_mapper: (req) => req.body,
  processor: mergeMap((props) => {
    console.log("props: ", props);
    return of(props).pipe(
      mergeMap(() => {
        if (props.Category == "1week") {
          return Navs.GET_LATEST({
            fk_Fund: props.fk_Fund,
            DateCreated: {
              $gte: new Date(moment().subtract(6, "days")),
              $lte: new Date(),
            },
          });
        } else if (props.Category == "1month") {
          return Navs.GET_LATEST({
            fk_Fund: props.fk_Fund,
            DateCreated: {
              $gte: new Date(moment().subtract(1, "months")),
              $lte: new Date(),
            },
          });
        } else if (props.Category == "3months") {
          return Navs.GET_LATEST({
            fk_Fund: props.fk_Fund,
            DateCreated: {
              $gte: new Date(moment().subtract(3, "months")),
              $lte: new Date(),
            },
          });
        } else if (props.Category == "1year") {
          return Navs.GET_LATEST({
            fk_Fund: props.fk_Fund,
            DateCreated: {
              $gte: new Date(moment().subtract(1, "years")),
              $lte: new Date(),
            },
          });
        } else if (props.Category == "3years") {
          return Navs.GET_LATEST({
            fk_Fund: props.fk_Fund,
            DateCreated: {
              $gte: new Date(moment().subtract(3, "years")),
              $lte: new Date(),
            },
          });
        } else if (props.Category == "5years") {
          return Navs.GET_LATEST({
            fk_Fund: props.fk_Fund,
            DateCreated: {
              $gte: new Date(moment().subtract(5, "years")),
              $lte: new Date(),
            },
          });
        } else if (props.Category == "inception") {
          return Navs.GET_LATEST({
            fk_Fund: props.fk_Fund,
          });
        } else {
          return throwError(new Error("Not yet supported"));
        }
      }),
      mergeMap((navs) => {
        let navgraph;
        if (props.Category != "1week" && navs.length > 6) {
          var perChunk = navs.length / 6;
          navgraph = splitToChunks(navs, perChunk).map((chunk) => {
            // let sum = 0
            // chunk.map((val) => {
            //   sum+= val.NavPerShare
            // })
            // const avg = (sum/chunk.length)
            return {
              NavPerShare: chunk[0].NavPerShare,
              DateCreated: chunk[0].DateCreated,
              Date: chunk[0].Date,
              fk_Fund: chunk[0].fk_Fund,
            };
          });
          return of(navgraph);
        } else return of(navs);
      })
    );
  }),
  response_mapper: (req, res) => (navs) => {
    res.send({
      data: navs,
    });
  },
};

const getMarketValueGraphOperation = {
  requestValidationSchema: generateRequiredSchemaItems(["body.Category"]),
  request_mapper: (req) => {
    return {
      ...req.body,
      user: req.middleware_auth,
    };
  },
  processor: mergeMap((props) => {
    return of(props).pipe(
      mergeMap(() => {
        return Partners.GET({ fk_User: props.user._id });
      }),
      mergeMap(async (partner_codes) => {
        let observables = [];
        for (let partner of partner_codes) {
          if (props.Category == "1week") {
            observables.push(
              TotalEquity.GET_LATEST({
                fk_User: props.user._id,
                fk_Fund: partner.fk_Fund,
                DateCreated: {
                  $gte: new Date(moment().subtract(6, "days")),
                  $lte: new Date(),
                },
              })
            );
          } else if (props.Category == "1month") {
            observables.push(
              TotalEquity.GET_LATEST({
                fk_User: props.user._id,
                fk_Fund: partner.fk_Fund,
                DateCreated: {
                  $gte: new Date(moment().subtract(1, "months")),
                  $lte: new Date(),
                },
              })
            );
          } else if (props.Category == "3months") {
            observables.push(
              TotalEquity.GET_LATEST({
                fk_User: props.user._id,
                fk_Fund: partner.fk_Fund,
                DateCreated: {
                  $gte: new Date(moment().subtract(3, "months")),
                  $lte: new Date(),
                },
              })
            );
          } else if (props.Category == "1year") {
            observables.push(
              TotalEquity.GET_LATEST({
                fk_User: props.user._id,
                fk_Fund: partner.fk_Fund,
                DateCreated: {
                  $gte: new Date(moment().subtract(1, "years")),
                  $lte: new Date(),
                },
              })
            );
          } else if (props.Category == "inception") {
            observables.push(
              TotalEquity.GET_LATEST({
                fk_User: props.user._id,
                fk_Fund: partner.fk_Fund,
              })
            );
          }
        }

        return forkJoin(observables);
      }),
      mergeMap((val) => val),
      mergeMap((data) => {
        const totalequities = [].concat(...data);
        var mvgraph = Object.values(groupBy(totalequities, "Date"));
        mvgraph = mvgraph.map((val) => {
          let total = 0;
          let temp;
          val.map((m) => {
            total += m.TotalEquity;
          });
          return {
            Date: val[0].Date,
            fk_Fund: val[0].fk_Fund,
            fk_User: val[0].fk_User,
            PartnerCode: val[0].PartnerCode,
            DateCreated: val[0].DateCreated,
            TotalEquity: total,
          };
        });
        if (mvgraph.length == 0) {
          return throwError(new Error("NOT_YET_AVAILABLE"));
        }
        if (mvgraph.length < 6) {
          let toAdd = 6 - mvgraph.length;
          for (var i = 1; i <= toAdd; i++) {
            mvgraph.push({
              Date: subtractDate(mvgraph[0].Date, i),
              fk_Fund: 0,
              fk_User: mvgraph[0].fk_User,
              PartnerCode: mvgraph[0].PartnerCode,
              DateCreated: new Date(subtractDate(mvgraph[0].DateCreated, i)),
              TotalEquity: 0,
            });
          }
        }
        return of(mvgraph);
      }),
      mergeMap((totalequities) => {
        let mvgraph;
        if (props.Category != "1week" && totalequities.length > 6) {
          var perChunk = totalequities.length / 6;
          mvgraph = splitToChunks(totalequities, perChunk).map((chunk) => {
            // let sum = 0
            // chunk.map((val) => {
            //   sum+= val.TotalEquity
            // })
            // const avg = (sum/chunk.length)
            return {
              TotalEquity: chunk[0].TotalEquity,
              DateCreated: chunk[0].DateCreated,
              Date: chunk[0].Date,
              fk_Fund: chunk[0].fk_Fund,
              fk_User: chunk[0].fk_User,
              PartnerCode: chunk[0].PartnerCode,
            };
          });
          return of(mvgraph);
        } else return of(totalequities);
      })
    );
  }),
  response_mapper: (req, res) => (totalequities) => {
    res.send({
      data: totalequities,
    });
  },
};

const getNavRatesOperation = {
  requestValidationSchema: generateRequiredSchemaItems(["body.fk_Fund"]),
  request_mapper: (req) => req.body,
  processor: mergeMap((props) => Navs.GET_LATEST({ fk_Fund: props.fk_Fund })),
  response_mapper: (req, res) => (navs) => {
    res.send({
      data: navs,
    });
  },
};

const uploadFundLogoOperation = {
  requestValidationSchema: generateRequiredSchemaItems(["body._id"]),
  request_mapper: (req) => {
    return {
      ...req.body,
      image: req.file,
      user: req.middleware_auth,
    };
  },
  processor: mergeMap((props) =>
    of(props).pipe(
      mergeMap(() => {
        const image = {
          path: `fund/${props._id}/logo/thumbnail.jpg`,
          body: props.image.buffer,
        };
        return uploadFile(image);
      }),
      mergeMap((image) =>
        Funds.UPDATE({
          identifier: {
            _id: props._id,
          },
          data: {
            Logo: `${image.path}?random=${generateCode()}`,
          },
        })
      ),
      mergeMap(() => Funds.GET())
    )
  ),
  response_mapper: (req, res) => (funds) => {
    res.send({
      data: funds,
    });
  },
};

const uploadFundProspectusOperation = {
  requestValidationSchema: generateRequiredSchemaItems(["body._id"]),
  request_mapper: (req) => {
    return {
      ...req.body,
      image: req.file,
      user: req.middleware_auth,
    };
  },
  processor: mergeMap((props) =>
    of(props).pipe(
      mergeMap(() => {
        const image = {
          path: `fund/${props._id}/prospectus/prospectus.pdf`,
          body: props.image.buffer,
        };
        return uploadFile(image, "application/pdf");
      }),
      mergeMap((image) =>
        Funds.UPDATE({
          identifier: {
            _id: props._id,
          },
          data: {
            Prospectus: `${image.path}?random=${generateCode()}`,
          },
        })
      ),
      mergeMap(() => Funds.GET())
    )
  ),
  response_mapper: (req, res) => (funds) => {
    res.send({
      data: funds,
    });
  },
};

const getDailyNavOperation_TEST = {
  processor: pipe(
    mergeMap(() => Funds.GET()),
    mergeMap((props) =>
      of(props).pipe(
        mergeMap((val) => getAccessToken()),
        mergeMap(async (token) => {
          let observables = [];
          let results = [];
          for (let fund of props) {
            var dailynav = await getDailyNav_PromisedBased(
              token.access_token,
              fund.FundIdentifier
            );
            var _1d = await Navs_.GET_TOP({
              fk_Fund: fund._id,
              Date: moment().subtract(1, "days").format("YYYY-MM-DD"),
            });
            var _1y = await Navs_.GET_TOP({
              fk_Fund: fund._id,
              DateCreated: {
                $gte: new Date(moment().subtract(1, "years")),
                $lte: new Date(moment()),
              },
            });

            var _1m = await Navs_.GET_TOP({
              fk_Fund: fund._id,
              DateCreated: {
                $gte: new Date(moment().subtract(1, "months")),
                $lte: new Date(moment()),
              },
            });

            var _3m = await Navs_.GET_TOP({
              fk_Fund: fund._id,
              DateCreated: {
                $gte: new Date(moment().subtract(3, "months")),
                $lte: new Date(moment()),
              },
            });

            var _3y = await Navs_.GET_TOP({
              fk_Fund: fund._id,
              DateCreated: {
                $gte: new Date(moment().subtract(3, "years")),
                $lte: new Date(moment()),
              },
            });
            var _5y = await Navs_.GET_TOP({
              fk_Fund: fund._id,
              DateCreated: {
                $gte: new Date(moment().subtract(5, "years")),
                $lte: new Date(moment()),
              },
            });
            var _ytd = await Navs_.GET_TOP({
              fk_Fund: fund._id,
              DateCreated: {
                $gte: new Date(
                  moment(moment().format("YYYY"))
                    .subtract(1, "years")
                    .endOf("year")
                    .subtract(3, "days")
                ),
                $lte: new Date(moment()),
              },
            });
            var _inception = await Navs_.GET_TOP({
              fk_Fund: fund._id,
            });
            const nav_history = {
              _1d: _1d[0].NavPerShare,
              _1m: _1m[0].NavPerShare,
              _3m: _3m[0].NavPerShare,
              _1y: _1y[0].NavPerShare,
              _3y: _3y[0].NavPerShare,
              _5y: _5y[0].NavPerShare,
              _ytd: _ytd[0].NavPerShare,
              _inception: _inception[0].NavPerShare,
            };
            const nav_returns = {
              _1dReturn: (dailynav.data.daily_nav / nav_history._1d - 1) * 100,
              _1dDate: _1d[0].Date,
              _1mReturn: (dailynav.data.daily_nav / nav_history._1m - 1) * 100,
              _1mDate: _1m[0].Date,
              _3mReturn: (dailynav.data.daily_nav / nav_history._3m - 1) * 100,
              _3mDate: _3m[0].Date,
              _1yReturn: (dailynav.data.daily_nav / nav_history._1y - 1) * 100,
              _1yDate: _1y[0].Date,
              _3yReturn: (dailynav.data.daily_nav / nav_history._3y - 1) * 100,
              _3yDate: _3y[0].Date,
              _5yReturn: (dailynav.data.daily_nav / nav_history._5y - 1) * 100,
              _5yDate: _5y[0].Date,
              _ytdReturn:
                (dailynav.data.daily_nav / nav_history._ytd - 1) * 100,
              _ytdDate: _ytd[0].Date,
              _inceptionReturn:
                (dailynav.data.daily_nav / nav_history._inception - 1) * 100,
              _inceptionDate: _inception[0].Date,
            };
            // console.log(nav_returns)
            observables.push(
              Navs.UPDATE({
                identifier: {
                  Date: moment().format("YYYY-MM-DD").toString(),
                  fk_Fund: fund._id,
                },
                data: {
                  NavPerShare: dailynav.data.daily_nav,
                  DateCreated: new Date(),
                  ...nav_returns,
                },
              })
            );
          }
          return forkJoin(observables).subscribe((dataArray) => {});
        })
        // mergeMap(() => {
        //   return Navs.GET({
        //     Date: moment().format('YYYY-MM-DD').toString()
        //   })
        // }),
        // mergeMap(async(navs) => {
        //   for (let fund)
        // })
      )
    )
  ),
  response_mapper: (req, res) => (result) => {
    console.log("Successful updating daily nav!");
    res.send("ok");
  },
  error_handler: (req, res, next) => (err) => {
    console.error(err.message);
    console.error("Error: ", err);
    console.log("Error in getting daily nav!");
  },
};

//this function modify the funds
const modifyFunds = {
  request_mapper: (req) => {
    return {
      user: req.middleware_auth,
      body: req.body,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(of(props), Funds.GET_ONE({ _id: props.body.Fund_ID }));
    }),
    mergeMap(([props, check]) => {
      if (!check) return throwError(new Error("InvalidFundID"));

      if (props.user.UserLevel !== 2)
        return throwError(new Error("Only Fund Manager Can Update Funds"));

      let navFundManagers =
        check && check.managers.length
          ? check.managers.map((item) => {
              return item.toString();
            })
          : [];

      if (
        navFundManagers &&
        navFundManagers.length &&
        navFundManagers.indexOf(props.user._id.toString()) >= 0
      ) {
        return zip(
          of(props),
          Funds.UPDATE_MANY({
            identifier: {
              _id: props.body.Fund_ID,
            },
            data: {
              FundIdentifier: props.body.FundIdentifier,
              AccountNo: props.body.AccountNo,
              DateCreated: props.body.DateCreated,
              Logo: props.body.Logo,
              Name: props.body.Name,
              Description: props.body.Description,
              ComplementaryFunds: props.body.ComplementaryFunds,
              LockUpPeriod: props.body.LockUpPeriod,
              MinInvestment: props.body.MinInvestment,
              SettlementPeriod: props.body.SettlementPeriod,
              TransactionFee: props.body.TransactionFee,
              DateUpdated: new Date(),
              FundType: props.body.FundType,
              RiskType: props.body.RiskType,
              Prospectus: props.body.Prospectus,
              PerformanceFee: props.body.PerformanceFee,
              BaseCurrency: props.body.BaseCurrency,
              Benchmark: props.body.Benchmark,
              FundClass: props.body.FundClass,
              InceptionDate: props.body.InceptionDate,
              Market: props.body.Market,
              Penalty: props.body.Penalty,
              RedemptionFee: props.body.RedemptionFee,
              SalesFee: props.body.SalesFee,
              Website: props.body.Website,
              CutOff: props.body.CutOff,
              ManagementFee: props.body.ManagementFee,
              MinHoldingPeriod: props.body.MinHoldingPeriod,
              EarlyRedemptionFee: props.body.EarlyRedemptionFee,
              InvestmentHorizon: props.body.InvestmentHorizon,
              FundSize: props.body.FundSize,
              Top5Holdings: props.body.Top5Holdings,
              InvestmentMix: props.body.InvestmentMix,
              Beta: props.body.Beta,
              Volatility: props.body.Volatility,
              SharpeRatio: props.body.SharpeRatio,
              MinSubscription: props.body.MinSubscription,
              MinRedemption: props.body.MinRedemption,
              MinTopup: props.body.MinTopup,
              LeadTime: props.body.LeadTime,
            },
          })
        );
      } else {
        return throwError(new Error("Invalid Fund for this User/Manager"));
      }
    }),
    mergeMap(([props, check]) => {
      return zip(Funds.GET_ONE({ _id: props.body.Fund_ID }));
    })
  ),
  response_mapper: (req, res) => (result) => {
    res.send({
      data: result,
    });
  },
  error_handler: (_req, res) => (err) => {
    let status = 400;
    console.log(err);

    if (err.message === "InvalidFundID") {
      err.message = "Invalid Fund ID!";
    } else if (err.message === "UNAUTHORIZED") {
      status = 403;
    } else {
      // err.message = 'Something went wrong'
    }

    res.status(status).json({
      code: status,
      status: "failed",
      message: err.message,
    });
  },
};

const paginationFunds = {
  request_mapper: (req) => {
    return {
      user: req.middleware_auth,
      body: req.query,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(
        of(props.body.page),
        Funds.GET_PAGE({
          page: parseInt(props.body.page),
          max: parseInt(props.body.max),
        })
      );
    })
  ),
  response_mapper:
    (req, res) =>
    ([page, response]) => {
      res.send({
        page: page,
        data: response,
      });
    },
};

const getSpecificFund = {
  request_mapper: (req) => {
    return {
      body: req.query,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      console.log("props: ", props);

      if (!props.body.FundIdentifier) {
        return throwError(new Error("NO DATA"));
      }
      return zip(
        of(props),
        Funds.GET_ONE({ FundIdentifier: props.body.FundIdentifier })
      );
    })
  ),
  response_mapper:
    (req, res) =>
    ([props, response]) => {
      res.send({
        data: response,
      });
    },
  error_handler: (_req, res) => (err) => {
    let status = 400;
    console.log(err);

    if (err.message === "NO DATA") {
      err.message = "No param found!";
    } else if (err.message === "UNAUTHORIZED") {
      status = 403;
    } else {
      err.message = "Something went wrong";
    }

    res.status(status).json({
      code: status,
      status: "failed",
      message: err.message,
    });
  },
};

const getAllFundsOperation = {
  processor: pipe(
    mergeMap((props) => {
      return zip(Funds.GET({}));
    })
  ),
  response_mapper:
    (req, res) =>
    ([data]) => {
      res.send(data);
    },
  error_handler: (_req, res) => (err) => {
    let status = 400;
    console.log(err);

    if (err.message == "payloadError") {
      err.message = "Invalid payload";
    } else if (err.message === "UNAUTHORIZED") {
      status = 403;
    } else {
      err.message = "Something went wrong";
    }

    res.status(status).json({
      code: status,
      status: "failed",
      message: err.message,
    });
  },
};

export const getFundListAdminController = createController(
  getFundList_AdminOperation
);
export const updateFundController = createController(updateFundOperation);
export const getDailyNavController = createController(getDailyNavOperation);
export const getTotalEquityController = createController(
  getTotalEquityOperation
);
export const getContractNotesController = createController(
  getContractNotesOperation
);
export const getTradingDatesController = createController(
  getTradingDatesOperation
);
export const addNavRatesController = createController(addNavRatesOperation);
export const getNavRatesController = createController(getNavRatesOperation);
export const getNavGraphController = createController(getNavGraphOperation);
export const getMarketValueGraphController = createController(
  getMarketValueGraphOperation
);
export const uploadFundLogoController = createController(
  uploadFundLogoOperation
);
export const uploadFundProspectusController = createController(
  uploadFundProspectusOperation
);
export const getDailyNavController_Test = createController(
  getDailyNavOperation_TEST
);
export const getFundListController = createController(getFundListOperation);

//roy end point
export const getAllFundListController = createController(getAllFundsOperation);
export const modifyFundController = createController(modifyFunds);
export const getSpecificFundListController = createController(getSpecificFund);
export const getFilterFundsController = createController(getFilterFunds);
export const paginationFundsController = createController(paginationFunds);
