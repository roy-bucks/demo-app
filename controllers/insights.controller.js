import { FundsModel } from "../models/funds.schema";
import { NavModel } from "../models/nav.schema";
import { PayoutRequestModel } from "../models/payout_request.schema";
import { TransactionsModel } from "../models/transactions.schema";
import { UserModel } from "../models/user.schema";
import { Collection, Collectionv2 } from "../utilities/database";
import { createController } from "./helper";

// import { mapfunds} from "../utilities/cashflow"
// import { tokenKey } from "../config"
import _ from "lodash";
import moment from "moment";
import { of, pipe, throwError, zip } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  geAUMData,
  geAUMDataPromiseBased,
  geAUMData_,
  getAccessToken,
} from "../utilities/fc";

const jwt = require("jsonwebtoken");
const validator = require("validator");
const ObjectId = require("mongodb").ObjectId;

const Funds = new Collection(FundsModel);
const funds = new Collection(FundsModel);
const redemption = new Collection(PayoutRequestModel);
const subscription = new Collection(TransactionsModel);
const users = new Collection(UserModel);
const nav = new Collection(NavModel);
const navCollection_v2 = new Collectionv2(NavModel);

//get 52 WEEK NAV
const get52WeeksNav = async (fkFund, props) => {
  var _52weekNavResult = await navCollection_v2.GET({
    fk_Fund: fkFund,
    NavPerShare: { $ne: null },
    DateCreated: {
      $gte: new Date(moment(props.from).subtract(52, "weeks")),
      $lte: new Date(moment(props.to)),
    },
  });

  const _52week_shares = _.map(_52weekNavResult, (obj) =>
    obj && obj.NavPerShare ? obj.NavPerShare : 0
  );

  const _52weekNav = {
    min: _.min(_52week_shares),
    max: _.max(_52week_shares),
  };

  console.log(_52weekNav);

  return _52weekNav;
};

const insightsFundsOperation = {
  request_mapper: (req) => {
    return {
      ...req.query,
      user: req.middleware_auth,
    };
  },
  processor: pipe(
    //validate the data here
    mergeMap((props) => {
      if (props.fund && props.fund !== "All") {
        return zip(
          of(props),
          redemption.GET({}),
          subscription.GET({ SubscriptionData: { $ne: null } }),
          funds.GET({ FundIdentifier: props.fund })
        );
      }
      return zip(
        of(props),
        redemption.GET({}),
        subscription.GET({ SubscriptionData: { $ne: null } }),
        funds.GET({})
      );
    }),

    mergeMap(([date, redemption, subscription, funds]) => {
      const monthsManagement = (months, monthsDiff) => {
        let workDate = moment(new Date(date.fromDate)).add(months, "months");
        let firstdayOfMonth = moment(new Date(workDate)).startOf("month");
        let endofMonth = moment(new Date(workDate)).endOf("month");
        if (months == 0) firstdayOfMonth = moment(new Date(date.fromDate));
        if (months == monthsDiff) endofMonth = moment(new Date(date.toDate));

        return {
          start: firstdayOfMonth,
          end: endofMonth,
        };
      };

      let monthsDiff = Math.floor(
        moment(new Date(date.toDate)).diff(
          moment(new Date(date.fromDate)),
          "months",
          true
        )
      );
      let arrangeDate = [];

      for (let a = 0; a <= monthsDiff; a++) {
        arrangeDate.push(monthsManagement(a, monthsDiff));
      }

      let temp = [];
      let userId = date.user._id.toString();
      if (date.user.UserLevel === 1) {
        temp = funds;
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

      return zip(
        of(arrangeDate),
        of(redemption),
        of(subscription),
        of(temp),
        getAccessToken()
      );
    }),

    mergeMap(([arrangeDate, redemption, subscription, funds, token]) => {
      let returnValue = [];
      return of({}).pipe(
        mergeMap(async (nothing) => {
          const dataManagement = async (date) => {
            let totalRedemption = 0;
            let totalSubscription = 0;
            let fkUsers = [];

            //get the redemption
            for (let a = 0; a < redemption.length; a++) {
              if (
                redemption[a] &&
                redemption[a].RedemptionData &&
                redemption[a].RedemptionData.data
              ) {
                if (
                  moment(
                    redemption[a].RedemptionData.data.processing_dt
                  ).isBefore(date.end) &&
                  moment(
                    redemption[a].RedemptionData.data.processing_dt
                  ).isAfter(date.start)
                ) {
                  totalRedemption += parseInt(
                    redemption[a].RedemptionData.data.amount
                  );
                  fkUsers.push(String(redemption[a].fk_User));
                }
              } else {
              }
            }

            //get the total  subscription
            for (let a = 0; a < subscription.length; a++) {
              if (
                moment(subscription[a].Date).isBefore(date.end) &&
                moment(subscription[a].Date).isAfter(date.start)
              ) {
                totalSubscription += parseInt(subscription[a].Amount);
                fkUsers.push(String(subscription[a].fk_User));
              }
            }

            let uniqueUser = [...new Set(fkUsers)];

            const thisMonthAUM = await geAUMDataPromiseBased(
              token.access_token,
              date.end.format("YYYYMMDD")
            );

            let temp = 0;

            const aumResult = thisMonthAUM.result;
            if (aumResult && aumResult.length) {
              for (let i = 0; i < aumResult.length; i++) {
                const aumData = aumResult[i];
                const aumInFunds = funds.find((val) => {
                  return val.FundIdentifier === aumData.fund_identifier;
                });
                if (aumInFunds) temp += parseFloat(aumData.aum);
              }
            }

            return {
              net_sr: {
                redemption: totalRedemption,
                subscription: totalSubscription,
                total: totalSubscription - totalRedemption,
              },
              users: uniqueUser.length,
              aum: temp, //test only
              month: date.start.format("MMM"),
              year: date.start.format("YYYY"),
            };
          };
          for (let a = 0; a < arrangeDate.length; a++) {
            let rawdata = await dataManagement(arrangeDate[a]);
            returnValue.push(rawdata);
          }

          return zip(of(returnValue));
        }),
        mergeMap((nothing) => {
          return zip(of(returnValue));
        })
      );
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
const insightsGraphFundsOperation = {
  request_mapper: (req) => {
    return req.middleware_auth;
  },
  processor: mergeMap((props) => {
    return of(props).pipe(
      mergeMap((props) => {
        return zip(of(props), funds.GET({}));
      }),

      mergeMap(([user, funds]) => {
        let fund = [];
        if (user.UserLevel == 1) {
          fund = funds;
        } else {
          for (let a = 0; a < funds.length; a++) {
            for (let b = 0; b < funds[a].managers.length; b++) {
              if (user._id.toString() == funds[a].managers[b].toString()) {
                fund.push(funds[a]);
              }
            }
          }
        }

        return zip(of(user), of(fund), getAccessToken());
      }),

      mergeMap(([props, funds, token]) => {
        return zip(
          of(funds),
          geAUMData_(token.access_token, moment().format("YYYYMMDD"))
        );
      }),

      mergeMap(([funds, aum]) => {
        let returnVal = [];
        for (let i = 0; i < funds.length; i++) {
          let fund = funds[i];
          let aum_ = aum.result.find(
            (o) => o.fund_identifier === fund.FundIdentifier
          );
          if (aum_) returnVal.push(aum_);
        }
        return zip(
          of({
            result: returnVal,
          })
        );
      })
    );
  }),
  response_mapper:
    (req, res) =>
    ([data]) => {
      res.send(data);
    },
  error_handler: (_req, res) => (err) => {
    let status = 400;
    console.log(err);

    if (err && err.message == "payloadError") {
      err.message = "Invalid payload";
    } else if (err && err.message === "UNAUTHORIZED") {
      status = 403;
    } else {
      err = {};
      err.message = "Something went wrong";
    }

    res.status(status).json({
      code: status,
      status: "failed",
      message: err && err.message ? err.message : err,
    });
  },
};

const insightsTotalAumOperation = {
  request_mapper: (req) => {
    return req.query;
  },
  processor: pipe(
    mergeMap((props) => {
      console.log("props: ", props);
      return zip(of("ok"));
    })
  ),
  response_mapper:
    (req, res) =>
    ([data]) => {
      //response static data as per lead dev. pat
      res.send({
        total: 18880,
        growth: 7.4,
      });
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

const insightsUsersOperation = {
  request_mapper: (req) => {
    return req.query;
  },
  processor: pipe(
    mergeMap((props) => {
      console.log("props: ", props);
      return zip(of("ok"));
    })
  ),
  response_mapper:
    (req, res) =>
    ([data]) => {
      //response static data as per lead dev. pat
      res.send({
        user_growth: {
          user: 4862,
          growth: 9.2,
        },
        new_users: {
          user: 2671,
          growth: 6.6,
        },
      });
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

const insightsFundsBreakdownOperation = {
  //get the funds
  //get the subscription
  processor: pipe(
    mergeMap((props) => {
      return zip(funds.GET({}), subscription.GET({}));
    }),

    //merge data
    mergeMap(([funds, subscription]) => {
      let fundData = [];
      let fundDataWithTransac = [];
      let fundDataWithArray = [];
      for (let a = 0; a < funds.length; a++) {
        fundData.push({
          fund_id: String(funds[a]._id),
          fund_class: funds[a].FundClass,
        });
      }

      for (let a = 0; a < fundData.length; a++) {
        for (let b = 0; b < subscription.length; b++) {
          if (fundData[a].fund_id == String(subscription[b].fk_Fund)) {
            fundDataWithTransac.push({
              fund_id: String(fundData[a].fund_id),
              fund_class: funds[a].FundClass,
              fk_user: String(subscription[b].fk_User),
            });
          }
        }
      }

      const uniqueFundClass = [
        ...new Set(fundData.map((item) => item.fund_class)),
      ];
      for (let a = 0; a < uniqueFundClass.length; a++) {
        let users = [];
        for (let b = 0; b < fundDataWithTransac.length; b++) {
          if (uniqueFundClass[a] == fundDataWithTransac[b].fund_class) {
            users.push(fundDataWithTransac[b].fk_user);
          }
        }
        let uniq = [...new Set(users)];
        fundDataWithArray.push({
          fund_class: uniqueFundClass[a],
          users: uniq.length,
        });
      }
      return zip(of(fundDataWithArray));
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

const insightsFundTypeOperation = {
  request_mapper: (req) => {
    return req.middleware_auth;
  },
  processor: pipe(
    mergeMap((userLevel) => {
      return zip(of(userLevel), funds.GET({}));
    }),
    mergeMap(([user, funds]) => {
      let fund = [];
      if (user.UserLevel == 1) {
        fund = funds;
      } else {
        for (let a = 0; a < funds.length; a++) {
          for (let b = 0; b < funds[a].managers.length; b++) {
            if (user._id == funds[a].managers[b].toString()) {
              fund.push(funds[a]);
            }
          }
        }
      }

      //admin
      return zip(
        users.GET({}),
        of(fund),
        subscription.GET({ SubscriptionData: { $ne: null } })
      );
    }),
    //group the funds
    mergeMap(([users, funds, subscription]) => {
      const fundClass = [...new Set(funds.map((item) => item.FundClass))];
      let data = [];
      for (let a = 0; a < fundClass.length; a++) {
        data.push({
          name: fundClass[a],
          funds: [],
        });
        for (let b = 0; b < funds.length; b++) {
          if (fundClass[a] === funds[b].FundClass) {
            data[a].funds.push(funds[b]);
          }
        }
      }

      let fundsIdentifier = [];
      //another loop to get all distinct funds identifier
      for (let c = 0; c < funds.length; c++) {
        fundsIdentifier.push(funds[c].FundIdentifier);
      }
      let fundsIdentifierUnique = fundsIdentifier.filter(
        (v, i, a) => a.indexOf(v) === i
      );
      return zip(
        of(users),
        of(data),
        of(subscription),
        of(fundsIdentifierUnique),
        of(fundClass)
      );
    }),

    //get the distinct funds identifier
    mergeMap(
      ([users, funds, subscription, fundsIdentifierUnique, fundClass]) => {
        let data = [];
        for (let a = 0; a < funds.length; a++) {
          let fIdentifierData = [];
          for (let b = 0; b < funds[a].funds.length; b++) {
            for (let c = 0; c < fundsIdentifierUnique.length; c++) {
              if (
                fundsIdentifierUnique[c] == funds[a].funds[b].FundIdentifier
              ) {
                let usersCount = [];
                for (let d = 0; d < subscription.length; d++) {
                  if (
                    String(funds[a].funds[b]._id) ==
                    String(subscription[d].fk_Fund)
                  ) {
                    usersCount.push(String(subscription[d].fk_User));
                  }
                }

                fIdentifierData.push({
                  fundIdentifer: fundsIdentifierUnique[c],
                  users: usersCount.filter((v, i, a) => a.indexOf(v) === i),
                });
              }
            }
          }

          data.push({
            fundClass: funds[a].name,
            data: fIdentifierData,
          });
        }

        return zip(of(data));
      }
    ),
    mergeMap(([res]) => {
      let data = [];
      for (let a = 0; a < res.length; a++) {
        let fundsIdentifier = [];
        let totalUsers = 0;
        for (let b = 0; b < res[a].data.length; b++) {
          totalUsers += res[a].data[b].users.length;
          fundsIdentifier.push({
            name: res[a].data[b].fundIdentifer,
            users: res[a].data[b].users.length,
          });
        }
        data.push({
          fundClass: res[a].fundClass,
          data: fundsIdentifier,
          total: {
            users: totalUsers,
          },
        });
      }

      return zip(of(data));
    })
  ),
  response_mapper:
    (req, res) =>
    ([data]) => {
      //response static data as per lead dev. pat
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

const insightsNetSROperation = {
  request_mapper: (req) => {
    console.log(req.middleware_auth);
    return {
      query: req.query,
      user: req.middleware_auth,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(of(props), funds.GET());
    }),

    mergeMap(([props, funds]) => {
      if (props.user.UserLevel == 1) {
        return zip(
          of(props.query),
          subscription.GET({ SubscriptionData: { $ne: null } }),
          redemption.GET({ RedemptionData: { $ne: null } })
        );
      } else {
        let userId = props.user._id;
        let fundId = [];
        for (let a = 0; a < funds.length; a++) {
          for (let b = 0; b < funds[a].managers.length; b++) {
            if (userId == funds[a].managers[b].toString()) {
              fundId.push(funds[a]._id.toString());
            }
          }
        }
        const subsquery = {
          SubscriptionData: { $ne: null },
          fk_Fund: { $in: fundId },
        };

        const redempquery = {
          RedemptionData: { $ne: null },
          fk_Fund: { $in: fundId },
        };
        return zip(
          of(props.query),
          subscription.GET(subsquery),
          redemption.GET({ redempquery })
        );
      }
    }),
    mergeMap(([props, subscription, redemption]) => {
      const mapComputation = (date) => {
        const startOfDate = moment(date).startOf("month");
        const endOfDate = moment(date).endOf("month");

        let redemptionTotal = 0;
        let subscriptionTotal = 0;
        //redemption
        for (let a = 0; a < redemption.length; a++) {
          if (
            moment(
              new Date(redemption[a].RedemptionData.data.processing_dt)
            ).isBefore(endOfDate) &&
            moment(
              new Date(redemption[a].RedemptionData.data.processing_dt)
            ).isAfter(startOfDate)
          ) {
            redemptionTotal += parseInt(
              redemption[a].RedemptionData.data.amount
            );
          }
        }

        //subscription
        for (let a = 0; a < subscription.length; a++) {
          if (
            moment(new Date(subscription[a].Date)).isBefore(endOfDate) &&
            moment(new Date(subscription[a].Date)).isAfter(startOfDate)
          ) {
            subscriptionTotal += parseInt(subscription[a].Amount);
          }
        }

        return {
          redemption: redemptionTotal,
          subscription: subscriptionTotal,
          month: moment(date).format("YYYY/MM/DD"),
        };
      };

      const mapComputationV2 = (date) => {
        console.log("date: ", date);

        const startOfDate = moment(date).startOf("day");
        const endOfDate = moment(date).endOf("day");

        let redemptionTotal = 0;
        let subscriptionTotal = 0;
        //redemption
        for (let a = 0; a < redemption.length; a++) {
          if (
            moment(
              new Date(redemption[a].RedemptionData.data.processing_dt)
            ).isBefore(endOfDate) &&
            moment(
              new Date(redemption[a].RedemptionData.data.processing_dt)
            ).isAfter(startOfDate)
          ) {
            redemptionTotal += parseInt(
              redemption[a].RedemptionData.data.amount
            );
          }
        }
        //subscription
        for (let a = 0; a < subscription.length; a++) {
          if (
            moment(new Date(subscription[a].Date)).isBefore(endOfDate) &&
            moment(new Date(subscription[a].Date)).isAfter(startOfDate)
          ) {
            subscriptionTotal += parseInt(subscription[a].Amount);
          }
        }
        return {
          redemption: redemptionTotal,
          subscription: subscriptionTotal,
          day: moment(date).format("YYYY/MM/DD"),
        };
      };

      const data = [];
      //all months
      if (props.month == 0) {
        for (let a = 0; a < 12; a++) {
          let date = moment(String(props.year + "0101"), "YYYY/MM/DD");
          data.push(mapComputation(date.add(a, "months")));
        }
      }
      //specific date
      else {
        let date = moment(
          String(props.year + "-" + props.month + "-" + "01"),
          "YYYY/MM/DD"
        );
        let daysInMonth = date.daysInMonth();

        for (let a = 0; a < daysInMonth; a++) {
          const startOfDate = moment(date).startOf("month");
          let newDate = startOfDate.add(a, "days");
          data.push(mapComputationV2(newDate));
        }
      }
      return zip(of(data));
    })
  ),
  response_mapper:
    (req, res) =>
    ([data]) => {
      //response static data as per lead dev. pat
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

const fundsSummaryOperation = {
  request_mapper: (req) => {
    return {
      query: req.query,
      user: req.middleware_auth,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(of(props.query), of(props.user), funds.GET({}));
    }),
    mergeMap(([props, user, funds]) => {
      if (user.UserLevel == 1) {
        //all funds
        return zip(of(props), subscription.GET(), of(funds), getAccessToken());
      } else {
        //process the funds
        const fund = [];
        for (let a = 0; a < funds.length; a++) {
          for (let b = 0; b < funds[a].managers.length; b++) {
            if (user._id.toString() == funds[a].managers[b].toString()) {
              fund.push(funds[a]);
            }
          }
        }

        return zip(of(props), subscription.GET(), of(fund), getAccessToken());
      }
    }),
    mergeMap(([props, subscription, funds, token]) => {
      return zip(
        of(props),

        of(subscription),
        of(funds),
        geAUMData_(
          token.access_token,
          moment().subtract(1, "day").format("YYYYMMDD")
        )
      );
    }),
    //get the funds and the funds id
    mergeMap(([props, subscription, funds, aum]) => {
      console.log("props: ", props);

      let fundsData = [];
      for (let a = 0; a < funds.length; a++) {
        fundsData.push({
          fk_Fund: funds[a]._id,
          fundsIdentifier: funds[a].FundIdentifier,
          type: funds[a].FundType,
        });
      }
      const getNumberOfInvestor = (fkFund) => {
        let investors = 0;
        let users = [];
        //there is date filter
        if (validator.isDate(props.from) && validator.isDate(props.to)) {
          for (let b = 0; b < subscription.length; b++) {
            let transacDate = moment(new Date(subscription[b].Date));
            if (
              transacDate.isBefore(moment(new Date(props.to))) &&
              transacDate.isAfter(moment(new Date(props.from)))
            ) {
              if (fkFund == String(subscription[b].fk_Fund)) {
                users.push(String(subscription[b].fk_User));
              }
            }
          }
        } else {
          for (let b = 0; b < subscription.length; b++) {
            if (fkFund == String(subscription[b].fk_Fund)) {
              users.push(String(subscription[b].fk_User));
            }
          }
        }
        let usersunique = [...new Set(users)];
        return (investors = usersunique.length);
      };

      for (let a = 0; a < fundsData.length; a++) {
        fundsData[a]["investors"] = getNumberOfInvestor(fundsData[a].fk_Fund); //date filter implemented
        let aumData = aum.result.find(
          (o) => o.fund_identifier === funds[a].FundIdentifier
        );
        fundsData[a]["aum"] =
          aumData && aumData.aum ? parseFloat(aumData.aum).toFixed(2) : 0;
      }
      return zip(of(props), of(fundsData));
    }),
    mergeMap(([props, fundsData]) => {
      const res = of(fundsData).pipe(
        mergeMap(async (funds) => {
          const data = [];
          for (let fund of funds) {
            let latest_with_nav = await navCollection_v2
              .GET({
                fk_Fund: fund.fk_Fund,
                $or: [
                  { NavPerShare: { $ne: 0 } },
                  { NavPerShare: { $ne: null } },
                ],
                DateCreated: {
                  $lt: new Date(moment().format("YYYY-MM-DD")),
                },
              })
              .sort({ DateCreated: "desc" })
              .limit(2);

            latest_with_nav = latest_with_nav[0];
            console.log("latest => ", latest_with_nav);
            data.push({
              ...fund,
              nav: latest_with_nav,
            });
          }
          return data;
        })
      );

      return zip(of(props), res);
    }),
    mergeMap(([props, results]) => zip(of(props), of(results))),

    //apply the other filter
    mergeMap(([props, result]) => {
      let resultFilter = [];
      if (typeof props.key !== "undefined" && !validator.isEmpty(props.key)) {
        for (let a = 0; a < result.length; a++) {
          if (
            validator.contains(result[a].fundsIdentifier, props.key, {
              ignoreCase: true,
            })
          ) {
            resultFilter.push(result[a]);
          }
        }
        return zip(of(props), of(resultFilter));
      } else {
        return zip(of(props), of(result));
      }
    }),

    //apply the pagination filter
    mergeMap(([props, result]) => {
      if (
        !validator.isEmpty(props.max || "") &&
        !validator.isEmpty(props.page || "")
      ) {
        console.log("With filter: ");
        let resData = [];
        if (parseInt(props.max) >= result.length) {
          return zip(of(result));
        } else {
          for (let a = 0; a < result.length; a++) {
            if (
              a >= parseInt(props.page) * parseInt(props.max) &&
              a <= parseInt(props.max)
            ) {
              resData.push(result[a]);
            }
          }
          return zip(of(resData));
        }
      } else {
        console.log("Without filter: ");
        return zip(of(result));
      }
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

const performanceInsightOperation = {
  request_mapper: (req) => {
    // return req.query;
    return {
      payload: req.query,
      user: req.middleware_auth,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(of(props), nav.GET(), funds.GET(), nav.GET_TOP());
    }),
    mergeMap(([props, nav, funds, navtop]) => {
      let fund = [];
      if (props.user.UserLevel == 1) {
        fund = funds;
      } else {
        for (let a = 0; a < funds.length; a++) {
          for (let b = 0; b < funds[a].managers.length; b++) {
            if (props.user._id.toString() == funds[a].managers[b].toString()) {
              fund.push(funds[a]);
            }
          }
        }
      }

      return zip(of(props.payload), of(nav), of(fund), of(navtop));
    }),
    //fix the fund here
    mergeMap(([props, nav, fund, firstNav]) => {
      //Date filter
      let date = new Date();
      if (validator.isDate(props.date)) {
        date = new Date(props.date);
      }

      let fundData = [];
      let uniqueFundClass = [...new Set(fund.map((item) => item.FundClass))];

      for (let a = 0; a < uniqueFundClass.length; a++) {
        let fundsUnderFundClass = [];
        for (let b = 0; b < fund.length; b++) {
          if (uniqueFundClass[a] == fund[b].FundClass) {
            fundsUnderFundClass.push({
              fund_identifier: fund[b].FundIdentifier,
              fk_fund: String(fund[b]._id),
            });
          }
        }
        fundData.push({
          fundClass: uniqueFundClass[a],
          data: fundsUnderFundClass,
        });
      }

      return zip(
        of(props),
        of(nav),
        of(fundData),
        //get the most oldest dat from mongodb
        of(firstNav)
      );
    }),

    mergeMap(([props, nav, fund, firstNav]) => {
      //1 day
      //3 months
      //6 months
      // ytp
      //1 year
      // 3 year
      // since inception

      const dateAdjustable = (date) => {
        let dayOfWeek = date.getDay();
        if (dayOfWeek === 5) {
          return moment(new Date(date)).subtract(1, "d");
        }
        if (dayOfWeek === 6) {
          return moment(new Date(date)).subtract(2, "d");
        }
        return moment(new Date(date));
      };

      const getNav = (datePass, fkFund) => {
        let date = dateAdjustable(new Date(datePass));

        // console.log("date adjust: ", date);
        // console.log("Fk fund: ", fkFund);

        let startof = moment(date).startOf("day");
        let endof = moment(date).endOf("day");
        let navPerShare = 0;

        for (let a = 0; a < nav.length; a++) {
          // console.log(fkFund +" = "+ nav[a].fk_Fund);

          if (String(fkFund) === String(nav[a].fk_Fund)) {
            if (
              startof.isBefore(moment(new Date(nav[a].DateCreated))) &&
              endof.isAfter(moment(new Date(nav[a].DateCreated)))
            ) {
              navPerShare += parseInt(nav[a].NavPerShare);
            }
          }
        }

        return navPerShare;
      };

      const dateArrange = (date, fkFund) => {
        let FirstNav = getNav(date, fkFund);

        let day1 = getNav(date.subtract(1, "d"), fkFund);
        let months3 = getNav(date.subtract(3, "months"), fkFund);
        let month6 = getNav(date.subtract(6, "months"), fkFund);
        let ytd = getNav(date.startOf("year"), fkFund);
        let year1 = getNav(date.subtract(1, "years"), fkFund);
        let year3 = getNav(date.subtract(3, "years"), fkFund);
        let sinceInception = parseInt(firstNav[0].NavPerShare);

        let day1Res = (FirstNav - day1) / day1;
        let months3Res = (FirstNav - months3) / months3;
        let months6Res = (FirstNav - month6) / month6;
        let ytdRes = (FirstNav - ytd) / ytd;
        let year1Res = (FirstNav - year1) / year1;
        let year3Res = (FirstNav - year3) / year3;
        let sinceInceptionRes = (FirstNav - sinceInception) / sinceInception;

        return {
          day1: !isNaN(day1Res) && isFinite(day1Res) ? day1Res : 0,
          months3: !isNaN(months3Res) && isFinite(months3Res) ? months3Res : 0,
          months6: !isNaN(months6Res) && isFinite(months6Res) ? months6Res : 0,
          ytd: !isNaN(ytdRes) && isFinite(ytdRes) ? ytdRes : 0,
          year1: !isNaN(year1Res) && isFinite(year1Res) ? year1Res : 0,
          year3: !isNaN(year3Res) && isFinite(year3Res) ? year3Res : 0,
          sinceInception:
            !isNaN(sinceInceptionRes) && isFinite(sinceInceptionRes)
              ? sinceInceptionRes
              : 0,
        };
      };

      const date = new Date(props.date);
      if (validator.isDate(date)) {
        for (let a = 0; a < fund.length; a++) {
          for (let b = 0; b < fund[a].data.length; b++) {
            fund[a].data[b]["nav"] = dateArrange(
              moment(date),
              fund[a].data[b].fk_fund
            );
          }
        }
      } else {
        return throwError(new Error("INVALID DATE"));
      }

      return zip(of(props), of(fund));
    }),

    //apply the filter
    mergeMap(([props, fund]) => {
      let fundsResponse = [];

      if (typeof props.keyword != "undefined") {
        for (let a = 0; a < fund.length; a++) {
          let temp = false;
          for (let b = 0; b < fund[a].data.length; b++) {
            if (
              validator.contains(
                fund[a].data[b].fund_identifier,
                props.keyword,
                { ignoreCase: true }
              )
            ) {
              temp = fund[a];
            }
          }

          temp ? fundsResponse.push(temp) : (temp = false);
        }
      } else {
        fundsResponse = fund;
      }
      return zip(of(fundsResponse));
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

    if (err.message == "INVALID DATE") {
      err.message = "Invalid Date payload";
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

const statisticsInsightOperation = {
  request_mapper: (req) => {
    return req.middleware_auth;
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(
        of(props),
        funds.GET(),
        subscription.GET({ SubscriptionData: { $ne: null } })
      );
    }),

    mergeMap(([user, funds, subs]) => {
      let fund = [];
      if (user.UserLevel == 1) {
        fund = funds;
      } else {
        for (let a = 0; a < funds.length; a++) {
          for (let b = 0; b < funds[a].managers.length; b++) {
            if (user._id.toString() == funds[a].managers[b].toString()) {
              fund.push(funds[a]);
            }
          }
        }
      }

      return zip(of(fund), of(subs));
    }),

    mergeMap(([funds, subscription]) => {
      //step 1 arrange thefunds
      const fundsData = [];
      for (let a = 0; a < funds.length; a++) {
        fundsData.push({
          fk_Fund: String(funds[a]._id),
          fund_identifier: funds[a].FundIdentifier,
        });
      }

      const getTransactions = (fkFund) => {
        let transactions = [];
        for (let a = 0; a < subscription.length; a++) {
          if (fkFund === String(subscription[a].fk_Fund)) {
            transactions.push(parseInt(subscription[a].Amount));
          }
        }
        return transactions;
      };

      const getStatistics = (transactions) => {
        const medianCalc = (numbers) => {
          const sorted = Array.from(numbers).sort((a, b) => a - b);
          const middle = Math.floor(sorted.length / 2);
          if (sorted.length % 2 === 0) {
            return (sorted[middle - 1] + sorted[middle]) / 2;
          }
          return sorted[middle];
        };

        const modeCalc = (a) => {
          a = a.slice().sort((x, y) => x - y);

          var bestStreak = 1;
          var bestElem = a[0];
          var currentStreak = 1;
          var currentElem = a[0];

          for (let i = 1; i < a.length; i++) {
            if (a[i - 1] !== a[i]) {
              if (currentStreak > bestStreak) {
                bestStreak = currentStreak;
                bestElem = currentElem;
              }

              currentStreak = 0;
              currentElem = a[i];
            }

            currentStreak++;
          }

          return currentStreak > bestStreak ? currentElem : bestElem;
        };

        let highest = 0;
        let lowest = 0;
        let mean = 0;
        let median = 0;
        let mode = 0;

        if (transactions.length) {
          highest = Math.max.apply(null, transactions);
          lowest = Math.min.apply(null, transactions);
          mean =
            transactions.reduce((partialSum, a) => partialSum + a, 0) /
            transactions.length;
          median = medianCalc(transactions);
          mode = modeCalc(transactions);
        }
        return {
          mean: mean.toFixed(2),
          median: median.toFixed(2),
          mode: mode.toFixed(2),
          highest: highest,
          lowest: lowest,
        };
      };

      let allFunds = [];
      for (let a = 0; a < fundsData.length; a++) {
        fundsData[a]["statistics"] = getStatistics(
          getTransactions(fundsData[a].fk_Fund)
        );
        let fundsArray = getTransactions(fundsData[a].fk_Fund);
        for (let b = 0; b < fundsArray.length; b++) {
          allFunds.push(fundsArray[b]);
        }
      }

      fundsData.push({
        fund_identifier: "ALL",
        statistics: getStatistics(allFunds),
      });

      return zip(of(fundsData));
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

const totalAumUsersOperation = {
  request_mapper: (req) => {
    return {
      param: req.query,
      user: req.middleware_auth,
    };
  },
  processor: pipe(
    //prepare the data
    mergeMap((data) => {
      return zip(
        of(data.param),
        users.GET({ bankId: { $ne: null } }),
        users.GET(),
        funds.GET(),
        subscription.GET({ SubscriptionData: { $ne: null } }),
        getAccessToken(),
        of(data.user)
      );
    }),
    //arrangange the date
    mergeMap(([props, investors, users, funds, subs, token, active_user]) => {
      let temp = [];
      let userId = active_user._id.toString();
      if (active_user.UserLevel === 1) {
        temp = funds;
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

      let durationHrs = moment(new Date(props.toDate)).diff(
        moment(new Date(props.fromDate)),
        "hours"
      );

      let workDate = [
        {
          fromDate: moment(new Date(props.fromDate)).startOf("day"),
          toDate: moment(new Date(props.toDate)).endOf("day"),
        },
        {
          fromDate: moment(new Date(props.fromDate))
            .subtract(durationHrs, "hours")
            .startOf("day"),
          toDate: moment(new Date(props.toDate))
            .subtract(durationHrs, "hours")
            .endOf("day"),
        },
        {
          fromDate: moment(new Date(props.fromDate))
            .subtract(durationHrs + durationHrs, "hours")
            .startOf("day"),
          toDate: moment(new Date(props.toDate))
            .subtract(durationHrs + durationHrs, "hours")
            .endOf("day"),
        },
      ];

      let parameterDate = !!props.fromDate
        ? moment(props.fromDate).format("YYYYMMDD")
        : new Date();

      //props, investors, users, funds, token, subs active_user

      return zip(
        of(investors),
        of(users),
        of(workDate),
        of(temp),
        of(active_user),
        of(subs),
        geAUMData(
          token.access_token,
          "ALL",
          moment(parameterDate).format("YYYYMMDD")
        )
      );
    }),

    //complex computation
    mergeMap(([investors, users, workDate, funds, active_user, subs, aum]) => {
      let temp = 0;

      const aumResult = aum.result;
      if (aumResult && aumResult.length) {
        for (let i = 0; i < aumResult.length; i++) {
          const aumData = aumResult[i];
          const aumInFunds = funds.find((val) => {
            return val.FundIdentifier === aumData.fund_identifier;
          });
          if (aumInFunds) temp += parseFloat(aumData.aum);
        }
      }

      let activeFunds = [];

      //mostly admin use
      const getInvestorsNoFilter = (date) => {
        let count = 0;
        let fkUsers = [];
        for (let a = 0; a < investors.length; a++) {
          if (
            moment(investors[a].DateCreated).isBefore(date.toDate) &&
            moment(investors[a].DateCreated).isAfter(date.fromDate)
          ) {
            fkUsers.push(investors[a]._id.toString());
          }
        }

        let uniqueUsers = [...new Set(fkUsers)];

        console.log("fkUsers: ", fkUsers);
        console.log("uniqueusers: ", uniqueUsers);

        return {
          totalClient: uniqueUsers.length,
          totralInvestor: fkUsers.length,
        };
      };

      //fm provider use
      const getInvestorsWithBankId = (date, bankId) => {
        let count = 0;

        let fkUsers = [];
        for (let a = 0; a < investors.length; a++) {
          if (
            moment(investors[a].DateCreated).isBefore(date.toDate) &&
            moment(investors[a].DateCreated).isAfter(date.fromDate) &&
            bankId == investors[a].bankId.toString()
          ) {
            fkUsers.push(investors[a]._id.toString());
          }
        }
        let uniqueUsers = [...new Set(fkUsers)];
        return {
          totalClient: uniqueUsers.length,
          totralInvestor: fkUsers.length,
        };
      };

      //Fund manager
      const getInvestorsFunds = (date, userId) => {
        /*  1. get all funds id under fund manager
         */

        let fkfunds = [];
        for (let a = 0; a < funds.length; a++) {
          let temp = false;
          for (let b = 0; b < funds[a].managers.length; b++) {
            if (userId == funds[a].managers[b].toString()) {
              temp = funds[a]._id.toString();
              activeFunds.push(funds[a]._id.toString());
            }
          }
          temp ? fkfunds.push(temp) : (temp = false);
        }

        let fkUsers = [];
        for (let a = 0; a < subs.length; a++) {
          for (let b = 0; b < fkfunds.length; b++) {
            if (
              moment(subs[a].Date).isBefore(date.toDate) &&
              moment(subs[a].Date).isAfter(date.fromDate) &&
              subs[a].fk_Fund.toString() == fkfunds[b]
            ) {
              fkUsers.push(subs[a].fk_User.toString());
            }
          }
        }

        let uniqueUsers = [...new Set(fkUsers)];
        return {
          totalClient: uniqueUsers.length,
          totralInvestor: fkUsers.length,
        };
      };

      const userCount = [];
      //admin
      if (active_user.UserLevel == 1) {
        for (let a = 0; a < workDate.length; a++) {
          userCount.push(getInvestorsNoFilter(workDate[a]));
        }
      }

      //fmprovider
      if (active_user.UserLevel == 3) {
        for (let a = 0; a < workDate.length; a++) {
          userCount.push(
            getInvestorsWithBankId(workDate[a], active_user.FkBankId.toString())
          );
        }
      }

      //fundmanager
      if (active_user.UserLevel == 2) {
        for (let a = 0; a < workDate.length; a++) {
          userCount.push(
            getInvestorsFunds(workDate[a], active_user._id.toString())
          );
        }
      }

      console.log("userCount: ", userCount);

      // let newuserGrowth = (
      //   ((parseInt(userCount[0]) - parseInt(userCount[1])) /
      //     parseInt(userCount[1])) *
      //   100
      // ).toFixed(1);
      // let newuserGrowth = (parseInt(userCount[0]) / investors.length) * 100;
      // let userGrowth = (parseInt(userCount[1]) / investors.length) * 100;
      // let userGrowth = (
      //   ((parseInt(userCount[1]) - parseInt(userCount[2])) /
      //     parseInt(userCount[2])) *
      //   100
      // ).toFixed(1);

      console.log("activeFunds: ", activeFunds);

      const resData = {
        new_users: {
          user: userCount[0].totalClient,
          // growth: isFinite(newuserGrowth)
          //   ? parseInt(newuserGrowth).toFixed(1)
          //   : 0,
        },
        user_growth: {
          user: userCount[1].totralInvestor,
          // growth: isFinite(userGrowth) ? parseInt(userGrowth).toFixed(1) : 0,
        },
        total_aum: {
          amount: temp,
          growth: 7.4,
        },
      };

      return zip(of(resData));
    })
  ),
  response_mapper:
    (req, res) =>
    ([data]) => {
      //response static data as per lead dev. pat
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

export const insightsFundsController = createController(insightsFundsOperation);
export const insightsGraphFundsController = createController(
  insightsGraphFundsOperation
);
export const insightsTotatAumController = createController(
  insightsTotalAumOperation
);
export const insightsUsersController = createController(insightsUsersOperation);
export const insightsFundsBreakdownController = createController(
  insightsFundsBreakdownOperation
);
export const insightsFundTypeController = createController(
  insightsFundTypeOperation
);
export const insightsNetSRController = createController(insightsNetSROperation);
export const fundsSummaryController = createController(fundsSummaryOperation);
export const performanceInsightController = createController(
  performanceInsightOperation
);
export const statisticsInsightController = createController(
  statisticsInsightOperation
);
export const totalAumUsersController = createController(totalAumUsersOperation);
