import fs from "fs";
import json2csv from "json2csv";
import _ from "lodash";
import moment from "moment/moment";
import path from "path";
import { forkJoin, of, pipe, throwError, zip } from "rxjs";
import { mergeMap } from "rxjs/operators";
import { FILES_PATH } from "../config";
import { FundsModel } from "../models/funds.schema";
import { NavModel } from "../models/nav.schema";
import { SettingsModel } from "../models/settings.schema";
import { Collection, Collectionv2 } from "../utilities/database";
import { getAccessToken, getDailyNav_PromisedBased } from "../utilities/fc";
import { addLog } from "../utilities/logs";
import { createController, rescale_nav } from "./helper";
const jwt = require("jsonwebtoken");
const navCollection = new Collection(NavModel);
const Navs_ = new Collectionv2(NavModel);
const fundsCollection = new Collection(FundsModel);
const settingsCollection = new Collection(SettingsModel);
const validator = require("validator");
const Funds = new Collection(FundsModel);

const GetAllNavRateOperation = {
  request_mapper: (req) => {
    return {
      body: req.query,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      const filter = props.body;
      if (filter && filter.fund) {
        return zip(
          of(props),
          of({}),
          fundsCollection.GET_ONE({
            _id: filter.fund,
          })
        );
      } else if (filter && filter.fund_identifier) {
        return zip(
          of(props),
          of({}),
          fundsCollection.GET_ONE({
            FundIdentifier: filter.fund_identifier,
          })
        );
      }
      return zip(of(props), navCollection.GET({}), of({}));
    }),

    mergeMap(([props, nav, funds]) => {
      const filter = props.body;
      let search = {
        $and: [
          { NavPerShare: { $ne: null } },
          { BenchmarkValue: { $ne: null } },
        ],

        $or: [
          { makerChecker: true, allowed: true },
          { allowed: true },
          { makerChecker: false },
        ],
      };
      if (filter && filter.fund) {
        console.log("filter: ", filter);
        search["fk_Fund"] = funds._id;
        if (filter.key) {
          // search[ '$or' ] = [
          // 	{ NavPerShare: { '$regex':parseInt(filter.key) } },
          // 	// { _1dReturn: { '$regex': filter.key, '$options': 'i' } },
          // 	// { _1mReturn: { '$regex': filter.key, '$options': 'i' } },
          // 	// { _1yReturn: { '$regex': filter.key, '$options': 'i' } },
          // 	// { _3mReturn: { '$regex': filter.key, '$options': 'i' } },
          // 	// { _3yReturn: { '$regex': filter.key, '$options': 'i' } },
          // 	// { _5yReturn: { '$regex': filter.key, '$options': 'i' } },
          // 	// { _ytdDate: { '$regex': filter.key, '$options': 'i' } },
          // 	// { _ytdReturn: { '$regex': filter.key, '$options': 'i' } }
          // ];
        }
        if (filter.from && filter.to) {
          search["DateCreated"] = {
            $gte: new Date(filter.from),
            $lte: new Date(moment(filter.to).add(1, "day")),
          };
        }

        if (funds) {
          let aggrquery = [{ $match: search }, { $sort: { DateCreated: 1 } }];

          for (let a = 0; a < aggrquery.length; a++) {
            console.log(aggrquery[a]);
          }

          return zip(navCollection.AGGREGATE(aggrquery));
        } else {
          return throwError(new Error("Fund not found!"));
        }
      }
      return zip(of(nav));
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

const GetNavChartData = {
  request_mapper: (req) => {
    return {
      body: req.query,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      const filter = props.body;
      if (filter && filter.fund) {
        return zip(
          of(props),
          of({}),
          fundsCollection.GET_ONE({
            _id: filter.fund,
          })
        );
      } else if (filter && filter.fund_identifier) {
        return zip(
          of(props),
          of({}),
          fundsCollection.GET_ONE({
            FundIdentifier: filter.fund_identifier,
          })
        );
      }
      return zip(of(props), navCollection.GET({}), of({}));
    }),

    mergeMap(([props, nav, funds]) => {
      const filter = props.body;
      let search = {
        $and: [
          { NavPerShare: { $ne: null } },
          { NavPerShare: { $not: { $type: "undefined" } } },
          { BenchmarkValue: { $ne: null } },
          { BenchmarkValue: { $not: { $type: "undefined" } } },
        ],
        $or: [
          { makerChecker: true, allowed: true },
          { allowed: true },
          { makerChecker: false },
        ],
      };
      if (filter && filter.fund) {
        console.log("filter: ", filter);
        search["fk_Fund"] = funds._id;
        if (filter.key) {
          // search[ '$or' ] = [
          // 	{ NavPerShare: { '$regex':parseInt(filter.key) } },
          // 	// { _1dReturn: { '$regex': filter.key, '$options': 'i' } },
          // 	// { _1mReturn: { '$regex': filter.key, '$options': 'i' } },
          // 	// { _1yReturn: { '$regex': filter.key, '$options': 'i' } },
          // 	// { _3mReturn: { '$regex': filter.key, '$options': 'i' } },
          // 	// { _3yReturn: { '$regex': filter.key, '$options': 'i' } },
          // 	// { _5yReturn: { '$regex': filter.key, '$options': 'i' } },
          // 	// { _ytdDate: { '$regex': filter.key, '$options': 'i' } },
          // 	// { _ytdReturn: { '$regex': filter.key, '$options': 'i' } }
          // ];
        }
        if (filter.from && filter.to) {
          search["DateCreated"] = {
            $gte: new Date(filter.from),
            $lte: new Date(filter.to),
          };
        }

        if (funds) {
          let aggrquery = [{ $match: search }];

          for (let a = 0; a < aggrquery.length; a++) {
            console.log(aggrquery[a]);
          }

          return zip(navCollection.AGGREGATE(aggrquery), of(funds));
        } else {
          return throwError(new Error("Fund not found!"));
        }
      }
      return zip(of(nav), of(funds));
    }),
    mergeMap(([dataForChart, selected_fund]) => {
      let cats = [];
      let ser = [];
      let originalSeriesValues = [];

      // const all_dates = dataForChart.map((obj) => moment(obj.Date));
      // const all_years = _.uniq(all_dates.map((mm) => mm.format("YYYY")));

      const categories = [
        {
          title: selected_fund.FundIdentifier,
          dataIndex: "NavPerShare",
        },
        {
          title: selected_fund.Benchmark,
          dataIndex: "BenchmarkValue",
        },
      ];

      const temp_ = [];
      _.forEach(dataForChart, (obj) => {
        if (obj.NavPerShare && obj.BenchmarkValue) {
          temp_.push(moment(obj.DateCreated));
        }
      });
      cats = temp_;
      cats = cats.sort((a, b) => a.diff(b));
      ser = _.map(categories, (cat, index) => {
        let color = "";

        let series_data = [];
        cats.forEach((day, cat_index) => {
          const item = _.find(dataForChart, (obj) => {
            return (
              day.format("YYYY-MM-DD") ===
              moment(obj.DateCreated).format("YYYY-MM-DD")
            );
          });

          const value = item[cat.dataIndex];
          return series_data.push(value);
        });

        originalSeriesValues.push(series_data);
        if (cat.title === selected_fund.FundIdentifier) {
          color = "#08ACB7";
          const series_copy = series_data;
          const scaled_temp = [];
          series_data.forEach((val, index) => {
            scaled_temp.push(
              rescale_nav(
                scaled_temp[index - 1],
                val,
                series_copy[index - 1],
                index
              )
            );
          });

          series_data = scaled_temp;
        }
        if (cat.title === selected_fund.Benchmark) {
          color = "#5C47FC";
          const b_series_copy = series_data;

          const b_scaled_temp = [];
          b_series_copy.forEach((val, index) => {
            b_scaled_temp.push(
              rescale_nav(
                b_scaled_temp[index - 1],
                val,
                b_series_copy[index - 1],
                index
              )
            );
          });

          series_data = b_scaled_temp;
        }

        return {
          name: cat.title,
          data: series_data,
          color,
        };
      });
      return zip(of({ series: ser, originalSeriesValues, categories: cats }));
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

const exportNavRatesOperation = {
  request_mapper: (req) => {
    return {
      body: req.query,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      console.log("props: ", props);
      const filter = props.body;
      if (filter && filter.fund) {
        return zip(
          of(props),
          of({}),
          fundsCollection.GET_ONE({
            _id: filter.fund,
          })
        );
      } else if (filter && filter.fund_identifier) {
        return zip(
          of(props),
          of({}),
          fundsCollection.GET_ONE({
            FundIdentifier: filter.fund_identifier,
          })
        );
      }
      return zip(of(props), navCollection.GET({}), of({}));
    }),
    mergeMap(([props, nav, funds]) => {
      const filter = props.body;
      let search = {
        $or: [
          { makerChecker: true, allowed: true },
          { allowed: true },
          { makerChecker: false },
        ],
      };
      if (filter && filter.fund) {
        console.log("filter: ", filter);
        search["fk_Fund"] = funds._id;
        if (filter.from && filter.to) {
          search["DateCreated"] = {
            $gte: new Date(filter.from),
            $lte: new Date(filter.to),
          };
        }

        console.log("search: ", JSON.stringify(search));
        if (funds) return zip(navCollection.GET_LATEST(search));
        else return throwError(new Error("Fund not found!"));
      }
      return zip(of(nav));
    })
  ),
  response_mapper:
    (req, res) =>
    ([funds]) => {
      const fields = [
        "Date",
        "Nav",
        "1m",
        "3m",
        "1yr",
        "3yrs",
        "5yrs",
        "Year to Date",
        "Return Since Launch",
        "Day Change",
      ];
      const opts = { fields };
      const parser = new json2csv.Parser(opts);
      const csv = parser.parse(
        funds.map((item, index) => {
          return {
            Date: moment(item.Date).format("MMM DD, YYYY"),
            Nav: isFinite(item.NavPerShare)
              ? parseFloat(item.NavPerShare).toFixed(2)
              : 0,
            "1m": isFinite(item._1mReturn)
              ? parseFloat(item._1mReturn).toFixed(2)
              : 0,
            "3m": isFinite(item._3mReturn)
              ? parseFloat(item._3mReturn).toFixed(2)
              : 0,
            "1yr": isFinite(item._1yReturn)
              ? parseFloat(item._1yReturn).toFixed(2)
              : 0,
            "3yrs": isFinite(item._3yReturn)
              ? parseFloat(item._3yReturn).toFixed(2)
              : 0,
            "5yrs": isFinite(item._5yReturn)
              ? parseFloat(item._5yReturn).toFixed(2)
              : 0,
            "Year to Date": isFinite(item._ytdReturn)
              ? parseFloat(item._ytdReturn).toFixed(2)
              : 0,
            "Return Since Launch": isFinite(item._inceptionReturn)
              ? parseFloat(item._inceptionReturn).toFixed(2)
              : 0,
            "Day Change": isFinite(item._1dReturn)
              ? parseFloat(item._1dReturn).toFixed(2)
              : 0,
          };
        })
      );

      let outputFile = path.join(FILES_PATH, `export-nav_${Date.now()}.csv`);
      fs.writeFile(outputFile, csv, function (error, data) {
        if (error) {
          console.log("error on creating subscription file: ", error);
          // alert admin that subscription file creation failed so no subscription will be uploaded to FC
        } else {
          res.download(outputFile);
        }
      });
    },
};

const GetAllNavRateTodayOperation = {
  request_mapper: (req) => {
    return {
      body: req.query,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      const filter = props.body;
      let search = {
        $or: [
          { makerChecker: true, allowed: true },
          { allowed: true },
          { makerChecker: false, allowed: true },
        ],
        Date: moment().format("YYYY-MM-DD"),
      };
      if (filter && filter.fund) {
        search["fk_Fund"] = filter.fund;
      }
      return zip(of(props), navCollection.GET(search), of({}));
    }),
    mergeMap(([props, nav, funds]) => {
      return zip(of(nav));
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

const GetAllNavRatesDateOperation = {
  request_mapper: (req) => {
    return {
      body: req.query,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      const filter = props.body;
      let search = {
        allowed: true,
        Date: moment(new Date(filter.date)).format("YYYY-MM-DD"),
      };
      if (filter && filter.fund) {
        search["fk_Fund"] = filter.fund;
      }
      return zip(of(props), navCollection.GET_ONE(search), of({}));
    }),
    mergeMap(([props, nav, funds]) => {
      return zip(of(nav));
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

const GetAllNavRateTodayApprovalOperation = {
  request_mapper: (req) => {
    return {
      userData: req.middleware_auth,
      body: req.query,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      const filter = props.body;
      let search = {
        $or: [
          {
            makerChecker: true,
          },
          {
            makerCheckerForDelete: true,
          },
        ],
        fk_User: { $ne: props.userData._id },
        Date: moment().format("YYYY-MM-DD"),
      };
      return zip(of(props), navCollection.GET(search), of({}));
    }),
    mergeMap(([props, nav, funds]) => {
      let fund_ids = nav.map((item) => {
        return item.fk_Fund;
      });
      return zip(
        of(props),
        of(nav),
        fundsCollection.GET({
          _id: {
            $in: fund_ids,
          },
        })
      );
    }),
    mergeMap(([props, navs, funds]) => {
      let temp = [];
      let userId = props.userData._id.toString();
      for (let i = 0; i < navs.length; i++) {
        let nav = navs[i];
        let navFund = funds.filter((item) => {
          return item._id.toString() === nav.fk_Fund.toString();
        });
        let navFundManagers =
          navFund[0] && navFund[0].managers.length
            ? navFund[0].managers.map((item) => {
                return item.toString();
              })
            : [];
        if (
          navFundManagers &&
          navFundManagers.length &&
          navFundManagers.indexOf(userId) >= 0
        ) {
          temp.push(nav);
        }
      }
      return zip(of(temp));
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

const NavCRUDOperation = {
  request_mapper: (req) => {
    return {
      userData: req.middleware_auth,
      body: req.body,
      query: req.query,
      method: req.method,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(
        of(props),
        settingsCollection.GET_ONE({
          name: "makerchecker",
        }),
        settingsCollection.GET_ONE({
          name: "otp",
        }),
        navCollection.GET_ONE({
          Date: moment().format("YYYY-MM-DD").toString(),
          fk_Fund: props.body.fund,
        }),
        fundsCollection.GET_ONE({
          _id: props.body.fund,
        })
      );
    }),
    mergeMap(([props, navSetting, otpSetting, navCheck, fund_]) => {
      switch (props.method) {
        case "POST":
          if (navCheck) {
            console.log("navCheck => ", navCheck);
            fundsCollection.UPDATE({
              identifier: { _id: fund_._id },
              data: { FundSize: props.body.FundSize },
            });
            addLog(props.userData._id, "NAV", "ADD New Nav");
            // return zip(
            //   of({}),
            //   of(navSetting),
            //   of(otpSetting),
            //   addLog(props.userData._id, "NAV", "ADD New Nav")
            // );
          }
        case "PATCH":
          console.log("NAV PATCH");
          return of(props.body).pipe(
            mergeMap((data) => {
              return zip(
                fundsCollection.GET_ONE({
                  _id: data.fund,
                }),
                settingsCollection.GET_ONE({
                  name: "nav",
                }),
                addLog(props.userData._id, "NAV", "UPDATE Current Nav")
              );
            }),
            mergeMap(([fund, settings]) => {
              if (!fund) return throwError(new Error("Fund not found!"));
              return zip(of(fund), of(settings));
            }),
            mergeMap(async ([fund, settings]) => {
              const newNavAmount = props.body.amount;
              const newBenchmarkAmount = props.body.BenchmarkValue;

              let latest_with_nav = await Navs_.GET({
                fk_Fund: fund._id,
                $and: [
                  { NavPerShare: { $ne: 0 } },
                  { NavPerShare: { $ne: null } },
                ],
                DateCreated: {
                  $lte: new Date(moment(new Date()).subtract(1, "day")),
                },
              }).sort({ DateCreated: "desc" });

              latest_with_nav = latest_with_nav[0];

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
              var _ytd = await Navs_.GET_LATEST({
                fk_Fund: fund._id,
                $and: [
                  { NavPerShare: { $ne: 0 } },
                  { NavPerShare: { $ne: null } },
                ],
                DateCreated: {
                  $lt: new Date(moment().startOf("year").subtract(12, "hours")),
                },
              });

              var _inception = await Navs_.GET_TOP({
                fk_Fund: fund._id,
              });

              var _52weekNavResult = await Navs_.GET({
                fk_Fund: fund._id,
                NavPerShare: { $ne: null },
                DateCreated: {
                  $gte: new Date(moment().subtract(52, "weeks")),
                  $lte: new Date(moment()),
                },
              });

              const _52week_shares = _.map(_52weekNavResult, (obj) =>
                obj && obj.NavPerShare ? obj.NavPerShare : 0
              );

              const _52weekNav = {
                min: _.min(_52week_shares),
                max: _.max(_52week_shares),
              };

              const nav_history = {
                _1d:
                  _1d[0] && _1d[0].NavPerShare
                    ? _1d[0].NavPerShare
                    : latest_with_nav.NavPerShare || 0,
                _1m:
                  _1m[0] && _1m[0].NavPerShare
                    ? _1m[0].NavPerShare
                    : latest_with_nav.NavPerShare || 0,
                _3m:
                  _3m[0] && _3m[0].NavPerShare
                    ? _3m[0].NavPerShare
                    : latest_with_nav.NavPerShare || 0,
                _1y:
                  _1y[0] && _1y[0].NavPerShare
                    ? _1y[0].NavPerShare
                    : latest_with_nav.NavPerShare || 0,
                _3y:
                  _3y[0] && _3y[0].NavPerShare
                    ? _3y[0].NavPerShare
                    : latest_with_nav.NavPerShare || 0,
                _5y:
                  _5y[0] && _5y[0].NavPerShare
                    ? _5y[0].NavPerShare
                    : latest_with_nav.NavPerShare || 0,
                _ytd:
                  _ytd[0] && _ytd[0].NavPerShare
                    ? _ytd[0].NavPerShare
                    : latest_with_nav.NavPerShare || 0,
                _inception:
                  _inception[0] && _inception[0].NavPerShare
                    ? _inception[0].NavPerShare
                    : latest_with_nav.NavPerShare || 0,
              };
              const dateToday = moment().format("YYYY-MM-DD").toString();
              const nav_returns = {
                _1dReturn: (newNavAmount / nav_history._1d - 1) * 100,
                _1dDate: _1d[0] ? _1d[0].Date : dateToday,
                _1mReturn: (newNavAmount / nav_history._1m - 1) * 100,
                _1mDate: _1m[0] ? _1m[0].Date : dateToday,
                _3mReturn: (newNavAmount / nav_history._3m - 1) * 100,
                _3mDate: _3m[0] ? _3m[0].Date : dateToday,
                _1yReturn: (newNavAmount / nav_history._1y - 1) * 100,
                _1yDate: _1y[0] ? _1y[0].Date : dateToday,
                _3yReturn: (newNavAmount / nav_history._3y - 1) * 100,
                _3yDate: _3y[0] ? _3y[0].Date : dateToday,
                _5yReturn: (newNavAmount / nav_history._5y - 1) * 100,
                _5yDate: _5y[0] ? _5y[0].Date : dateToday,
                _ytdReturn: (newNavAmount / nav_history._ytd - 1) * 100,
                _ytdDate: _ytd[0] ? _ytd[0].Date : dateToday,
                _inceptionReturn:
                  (newNavAmount / nav_history._inception - 1) * 100,
                _inceptionDate: _inception[0] ? _inception[0].Date : dateToday,
              };

              console.log("nav_returns", nav_returns);

              //BENCHMARK PROCESS

              const benchmark_history = {
                _1d:
                  _1d[0] && _1d[0].BenchmarkValue
                    ? _1d[0].BenchmarkValue
                    : latest_with_nav.BenchmarkValue || 0,
                _1m:
                  _1m[0] && _1m[0].BenchmarkValue
                    ? _1m[0].BenchmarkValue
                    : latest_with_nav.BenchmarkValue || 0,
                _3m:
                  _3m[0] && _3m[0].BenchmarkValue
                    ? _3m[0].BenchmarkValue
                    : latest_with_nav.BenchmarkValue || 0,
                _1y:
                  _1y[0] && _1y[0].BenchmarkValue
                    ? _1y[0].BenchmarkValue
                    : latest_with_nav.BenchmarkValue || 0,
                _3y:
                  _3y[0] && _3y[0].BenchmarkValue
                    ? _3y[0].BenchmarkValue
                    : latest_with_nav.BenchmarkValue || 0,
                _5y:
                  _5y[0] && _5y[0].BenchmarkValue
                    ? _5y[0].BenchmarkValue
                    : latest_with_nav.BenchmarkValue || 0,
                _ytd:
                  _ytd[0] && _ytd[0].BenchmarkValue
                    ? _ytd[0].BenchmarkValue
                    : latest_with_nav.BenchmarkValue || 0,
                _inception:
                  _inception[0] && _inception[0].BenchmarkValue
                    ? _inception[0].BenchmarkValue
                    : latest_with_nav.BenchmarkValue || 0,
              };

              const benchmark_returns = {
                b_1dReturn:
                  (newBenchmarkAmount / benchmark_history._1d - 1) * 100,
                b_1dDate: _1d[0] ? _1d[0].Date : dateToday,
                b_1mReturn:
                  (newBenchmarkAmount / benchmark_history._1m - 1) * 100,
                b_1mDate: _1m[0] ? _1m[0].Date : dateToday,
                b_3mReturn:
                  (newBenchmarkAmount / benchmark_history._3m - 1) * 100,
                b_3mDate: _3m[0] ? _3m[0].Date : dateToday,
                b_1yReturn:
                  (newBenchmarkAmount / benchmark_history._1y - 1) * 100,
                b_1yDate: _1y[0] ? _1y[0].Date : dateToday,
                b_3yReturn:
                  (newBenchmarkAmount / benchmark_history._3y - 1) * 100,
                b_3yDate: _3y[0] ? _3y[0].Date : dateToday,
                b_5yReturn:
                  (newBenchmarkAmount / benchmark_history._5y - 1) * 100,
                b_5yDate: _5y[0] ? _5y[0].Date : dateToday,
                b_ytdReturn:
                  (newBenchmarkAmount / benchmark_history._ytd - 1) * 100,
                b_ytdDate: _ytd[0] ? _ytd[0].Date : dateToday,
                b_inceptionReturn:
                  (newBenchmarkAmount / benchmark_history._inception - 1) * 100,
                b_inceptionDate: _inception[0] ? _inception[0].Date : dateToday,
              };
              let observables = [];
              let otpRequired = !(
                otpSetting &&
                otpSetting.option &&
                otpSetting.option.nav
              );
              let makerCheckerRequired =
                navSetting && navSetting.option && navSetting.option.nav;
              let forUpdatingVal = {
                DateCreated: new Date(),
                otp: !otpRequired ? 1111 : null,
                makerChecker: makerCheckerRequired,
                allowed: otpRequired && !makerCheckerRequired,
                fk_User: props.userData._id,
                userRequestedData: props.userData,
                BenchmarkValue: props.body.BenchmarkValue,
                NavFundSize: props.body.FundSize,
                _52weekNav,
                ...nav_returns,
                ...benchmark_returns,
              };
              if (!!navCheck) {
                if (!(otpRequired && !makerCheckerRequired)) {
                  forUpdatingVal.tempNavPerShare = newNavAmount;
                } else {
                  forUpdatingVal.NavPerShare = newNavAmount;
                }
              } else {
                forUpdatingVal.NavPerShare = newNavAmount;
                forUpdatingVal.tempNavPerShare = newNavAmount;
                if (props.method === "POST" && makerCheckerRequired)
                  forUpdatingVal.NavPerShare = 0;
              }
              if (props.method === "PATCH") {
                if (makerCheckerRequired) {
                  forUpdatingVal.allowed = true;
                }
              }

              observables.push(
                navCollection.UPDATE({
                  identifier: {
                    Date: moment().format("YYYY-MM-DD").toString(),
                    fk_Fund: fund._id,
                  },
                  data: forUpdatingVal,
                })
              );
              observables.push(
                fundsCollection.UPDATE({
                  identifier: { _id: fund._id },
                  data: { FundSize: props.body.FundSize },
                })
              );

              return forkJoin(observables).subscribe((dataArray) => {});
            }),
            mergeMap((settings) => {
              return zip(of(props), of(navSetting), of(otpSetting));
            })
          );

        case "DELETE":
          return of(props.query).pipe(
            mergeMap((data) => {
              return zip(
                fundsCollection.GET_ONE({
                  _id: data.fund,
                }),
                addLog(props.userData._id, "NAV", "DELETE Current Nav")
              );
            }),
            mergeMap(([fund]) => {
              if (!fund) return throwError(new Error("Fund not found!"));
              return zip(
                navCollection.GET_ONE({
                  Date: moment().format("YYYY-MM-DD").toString(),
                  fk_Fund: fund._id,
                })
              );
            }),
            mergeMap(([nav]) => {
              if (!nav)
                return throwError(new Error("Nav for today not found!"));
              let otpRequired = !(
                otpSetting &&
                otpSetting.option &&
                otpSetting.option.nav
              );
              let makerCheckerRequired =
                navSetting && navSetting.option && navSetting.option.nav;
              console.log("otpRequired: ", otpRequired);
              console.log("makerCheckerRequired: ", makerCheckerRequired);
              if (!(otpRequired && !makerCheckerRequired)) {
                let temporary = {
                  toBeDeleted: true,
                  tempNavPerShare: 0,
                };
                if (!otpRequired) temporary.otp = 1111;
                if (makerCheckerRequired) {
                  temporary.makerCheckerForDelete = true;
                }
                return zip(
                  navCollection.UPDATE({
                    identifier: {
                      _id: nav._id,
                    },
                    data: temporary,
                  }),
                  of(navSetting),
                  of(otpSetting)
                );
              } else {
                return zip(
                  navCollection.DELETE_ONE({
                    _id: nav._id,
                  }),
                  of(navSetting),
                  of(otpSetting)
                );
              }
            })
          );
        default:
          return throwError(new Error("Unsupported METHOD!"));
      }
    })
  ),
  response_mapper:
    (req, res) =>
    ([props, navSetting, otpSetting]) => {
      console.log("navSetting: ", navSetting);
      return res.send({
        message: "Success!",
        makerCheckerRequired:
          navSetting && navSetting.option && navSetting.option.nav,
        otpRequired: otpSetting && otpSetting.option && otpSetting.option.nav,
      });
    },
  error_handler: (_req, res) => (err) => {
    let status = 400;
    console.log(err);
    res.status(status).json({
      code: status,
      status: "failed",
      message: err.message,
    });
  },
};

const NavOTPVerificationOperation = {
  request_mapper: (req) => {
    return {
      body: req.body,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      const data = props.body;
      if (data && data.fund) {
        return zip(
          of(props),
          navCollection.GET_ONE({
            Date: moment().format("YYYY-MM-DD").toString(),
            fk_Fund: data.fund,
          })
        );
      }
      return throwError(new Error("Fund not found!"));
    }),
    mergeMap(([props, nav]) => {
      console.log("props.body: ", props.body.otp);
      console.log("nav.otp: ", nav.otp);
      if (parseInt(props.body.otp) === parseInt(nav.otp)) {
        let temporary = {
          otp: null,
        };
        if (nav.makerChecker) {
        } else {
          temporary.allowed = true;
          temporary.NavPerShare = nav.tempNavPerShare;
        }
        return zip(
          navCollection.UPDATE({
            identifier: {
              _id: nav._id,
            },
            data: temporary,
          })
        );
      } else {
        return throwError(new Error("Invalid OTP!"));
      }
    })
  ),
  response_mapper:
    (req, res) =>
    ([funds]) => {
      res.send({
        message: "success",
      });
    },
  error_handler: (_req, res) => (err) => {
    let status = 500;

    console.log(err);
    res.status(status).json({
      code: status,
      status: "failed",
      message: err.message,
    });
  },
};
const NavMakerCheckerVerificationOperation = {
  request_mapper: (req) => {
    return {
      body: req.body,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      const data = props.body;
      if (data && data.fund) {
        return zip(
          of(props),
          navCollection.GET_ONE({
            Date: moment().format("YYYY-MM-DD").toString(),
            fk_Fund: data.fund,
          })
        );
      }
      return throwError(new Error("Fund not found!"));
    }),
    mergeMap(([props, nav]) => {
      let temp = {
        otp: null,
        makerChecker: false,
        allowed: true,
      };
      if (nav.tempNavPerShare && nav.tempNavPerShare > 0)
        temp.NavPerShare = nav.tempNavPerShare;
      return zip(
        navCollection.UPDATE({
          identifier: {
            _id: nav._id,
          },
          data: temp,
        })
      );
    })
  ),
  response_mapper:
    (req, res) =>
    ([funds]) => {
      res.send({
        message: "success",
      });
    },
};

const NavMakerCheckerDeclineOperation = {
  request_mapper: (req) => {
    return {
      body: req.body,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      const data = props.body;
      if (data && data.fund) {
        return zip(
          of(props),
          navCollection.GET_ONE({
            Date: moment().format("YYYY-MM-DD").toString(),
            fk_Fund: data.fund,
          })
        );
      }
      return throwError(new Error("Fund not found!"));
    }),
    mergeMap(([props, nav]) => {
      return zip(
        navCollection.UPDATE({
          identifier: {
            _id: nav._id,
          },
          data: {
            makerChecker: false,
            tempNavPerShare: 0,
          },
        })
      );
    })
  ),
  response_mapper:
    (req, res) =>
    ([funds]) => {
      res.send({
        message: "success",
      });
    },
};

const deleteNavOTPVerificationOperation = {
  request_mapper: (req) => {
    return {
      body: {
        ...req.body,
        ...req.query,
      },
    };
  },
  processor: pipe(
    mergeMap((props) => {
      const data = props.body;
      if (data && data.fund) {
        return zip(
          of(props),
          navCollection.GET_ONE({
            Date: moment().format("YYYY-MM-DD").toString(),
            fk_Fund: data.fund,
          })
        );
      }
      return throwError(new Error("Fund not found!"));
    }),
    mergeMap(([props, nav]) => {
      if (parseInt(props.body.otp) === parseInt(nav.otp)) {
        console.log("nav: ", nav);
        if (nav.makerCheckerForDelete) {
          return zip(
            navCollection.UPDATE({
              identifier: {
                _id: nav._id,
              },
              data: {
                otp: null,
                makerCheckerForDelete: true,
              },
            })
          );
        } else {
          return zip(
            navCollection.DELETE_ONE({
              _id: nav._id,
            })
          );
        }
      } else {
        return throwError(new Error("Invalid OTP!"));
      }
    })
  ),
  response_mapper:
    (req, res) =>
    ([funds]) => {
      res.send({
        message: "success",
      });
    },
  error_handler: (_req, res) => (err) => {
    let status = 500;

    console.log(err);
    res.status(status).json({
      code: status,
      status: "failed",
      message: err.message,
    });
  },
};

const deleteNavMakerCheckerOperation = {
  request_mapper: (req) => {
    return {
      body: {
        ...req.body,
        ...req.query,
      },
    };
  },
  processor: pipe(
    mergeMap((props) => {
      const data = props.body;
      if (data && data.fund) {
        return zip(
          of(props),
          navCollection.GET_ONE({
            Date: moment().format("YYYY-MM-DD").toString(),
            fk_Fund: data.fund,
          })
        );
      }
      return throwError(new Error("Fund not found!"));
    }),
    mergeMap(([props, nav]) => {
      return zip(
        navCollection.DELETE_ONE({
          _id: nav._id,
        })
      );
    })
  ),
  response_mapper:
    (req, res) =>
    ([funds]) => {
      res.send({
        message: "success",
      });
    },
};

const getNavRateOperation = {
  request_mapper: (req) => {
    return req.query;
  },
  processor: pipe(
    //Error handling here
    mergeMap((props) => {
      console.log(props);
      return zip(
        fundsCollection.GET_ONE({ FundIdentifier: props.fundIdentifier }),
        Navs_.GET()
      );
    }),

    mergeMap(([funds, navs]) => {
      if (!funds) return throwError(new Error("NO DATA"));

      let navData = [];

      for (let a = 0; a < navs.length; a++) {
        console.log(funds._id + " = " + navs[a].fk_Fund);
        if (String(funds._id) === String(navs[a].fk_Fund)) {
          navData.push(navs[a]);
        }
      }

      return zip(of(navData));
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

const getAllNavvRateOperation = {
  processor: pipe(
    mergeMap((props) => {
      return zip(Navs_.GET({}));
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

const testNavOperation = {
  processor: pipe(
    mergeMap((props) => {
      return zip(getAccessToken(), Funds.GET());
    }),
    mergeMap(async ([token, funds]) => {
      let observables = [];

      for (let fund of funds) {
        try {
          const dailynav = await getDailyNav_PromisedBased(
            token.access_token,
            fund.FundIdentifier
          );
          if (
            dailynav &&
            dailynav.result &&
            dailynav.result.data &&
            dailynav.result.data.daily_nav
          ) {
            const dailyNavValue = dailynav.result.data.daily_nav;
            console.log(
              "dailyNavValue: ",
              dailyNavValue,
              "fund: ",
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
              _1d: _1d.length === 0 ? 0 : _1d[0].NavPerShare,
              _1m: _1m.length === 0 ? 0 : _1m[0].NavPerShare,
              _3m: _3m.length === 0 ? 0 : _3m[0].NavPerShare,
              _1y: _1y.length === 0 ? 0 : _1y[0].NavPerShare,
              _3y: _3y.length === 0 ? 0 : _3y[0].NavPerShare,
              _5y: _5y.length === 0 ? 0 : _5y[0].NavPerShare,
              _ytd: _ytd.length === 0 ? 0 : _ytd[0].NavPerShare,
              _inception:
                _inception.length === 0 ? 0 : _inception[0].NavPerShare,
            };
            const nav_returns = {
              _1dReturn:
                _1d.length === 0
                  ? 0
                  : (dailyNavValue / nav_history._1d - 1) * 100,
              _1dDate: _1d.Date === undefined ? new Date() : _1d[0].Date,
              _1mReturn:
                _1m.length === 0
                  ? 0
                  : (dailyNavValue / nav_history._1m - 1) * 100,
              _1mDate: _1m.length === 0 ? new Date() : _1m[0].NavPerShare,
              _3mReturn:
                _3m.length === 0
                  ? 0
                  : (dailyNavValue / nav_history._3m - 1) * 100,
              _3mDate: _3m.length === 0 ? new Date() : _3m[0].Date,
              _1yReturn:
                _1y.length === 0
                  ? 0
                  : (dailyNavValue / nav_history._1y - 1) * 100,
              _1yDate: _1y.length === 0 ? new Date() : _1y[0].Date,
              _3yReturn:
                _3y.length === 0
                  ? 0
                  : (dailyNavValue / nav_history._3y - 1) * 100,
              _3yDate: _3y.length === 0 ? new Date() : _3y[0].Date,
              _5yReturn:
                _5y.length === 0
                  ? 0
                  : (dailyNavValue / nav_history._5y - 1) * 100,
              _5yDate: _5y.length === 0 ? new Date() : _5y[0].Date,
              _ytdReturn:
                _ytd.length === 0
                  ? 0
                  : (dailyNavValue / nav_history._ytd - 1) * 100,
              _ytdDate: _ytd.length === 0 ? new Date() : _ytd[0].Date,
              _inceptionReturn:
                _inception.length === 0
                  ? 0
                  : (dailyNavValue / nav_history._inception - 1) * 100,
              _inceptionDate:
                _inception.length === 0 ? new Date() : _inception[0].Date,
            };
            observables.push(
              navCollection.UPDATE({
                identifier: {
                  Date: moment().format("YYYY-MM-DD").toString(),
                  fk_Fund: fund._id,
                },
                data: {
                  NavPerShare: dailyNavValue,
                  DateCreated: new Date(),
                  allowed: true,
                  ...nav_returns,
                },
              })
            );
          }
        } catch (e) {}
      }
      return forkJoin(observables).subscribe((dataArray) => {});
    }),
    mergeMap((c) => {
      return zip(of({ success: true }));
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

    // if (err.message == "payloadError") {
    //   err.message = "Invalid payload";
    // } else if (err.message === "UNAUTHORIZED") {
    //   status = 403;
    // } else {
    //   err.message = "Something went wrong";
    // }

    res.status(status).json({
      code: status,
      status: "failed",
      message: err,
    });
  },
};

const parse_to_float = (num, log) => {
  let x;
  if (typeof num === "string") {
    x = parseFloat(num.replace(/,/g, "").replace(/\W/g, ""));
  } else if (typeof num === "number") {
    x = num;
  } else {
    x = num;
  }
  x = parseFloat(x);
  if (log) console.log(x);
  if (typeof num === "undefined") return 0;
  return x;
};
const importNavRatesOperation = {
  request_mapper: (req) => {
    return {
      ...req.body,
      user: req.middleware_auth,
    };
  },
  processor: pipe(
    mergeMap((props) =>
      of(props).pipe(
        mergeMap((props) => {
          if (props.user.UserLevel !== 1) {
            //throw error here
          }
          return zip(of(props));
        }),
        mergeMap(async () => {
          let observables = [];
          let data = props.data;
          data = _.filter(data, (obj) => obj.date !== null);
          data = _.orderBy(data, (obj) => moment(new Date(obj.date)), "asc");
          let all_navs = await Navs_.GET({
            fk_Fund: props.fund,
            $or: [{ NavPerShare: { $ne: 0 } }, { NavPerShare: { $ne: null } }],
          }).sort({ DateCreated: "asc" });

          let index = 0;

          for (let n of data) {
            all_navs = _.uniqBy(all_navs, "Date");
            let fund = {
              _id: props.fund,
            };
            // let latest_with_nav = await Navs_.GET({
            //   fk_Fund: fund._id,
            //   $or: [
            //     { NavPerShare: { $ne: 0 } },
            //     { NavPerShare: { $ne: null } },
            //   ],
            //   DateCreated: {
            //     $lte: new Date(moment(new Date(n.date)).subtract(1, "day")),
            //   },
            // })
            //   .sort({ DateCreated: "desc" })
            //   .limit(1);

            // // important data
            // latest_with_nav = latest_with_nav[0];

            const newBenchmarkAmount = parse_to_float(n.benchmark_value);
            const newNavAmount = parse_to_float(n.nav_per_share);
            const dateToday = new Date();
            const nav_input_date = new Date(n.date);

            let latest_with_nav = _.filter(
              all_navs,
              (obj) =>
                moment(obj.Date) <= moment(nav_input_date).subtract(1, "day")
            );

            latest_with_nav = _.orderBy(
              latest_with_nav,
              (obj) => moment(obj.Date),
              "desc"
            )[0];

            // var _1d = await Navs_.GET_TOP({
            //   fk_Fund: fund._id,
            //   Date: moment(new Date(n.date))
            //     .subtract(1, "days")
            //     .format("YYYY-MM-DD"),
            // });

            let _1d = latest_with_nav;
            // var _1y = await Navs_.GET_TOP({
            //   fk_Fund: fund._id,
            //   DateCreated: {
            //     $gte: new Date(moment(new Date(n.date)).subtract(1, "years")),
            //     $lte: new Date(moment(new Date(n.date))),
            //   },
            // });

            let _1y = _.filter(all_navs, (obj) =>
              moment(obj.Date).isBetween(
                moment(nav_input_date).subtract(1, "year"),
                moment(nav_input_date)
              )
            );
            _1y = _.orderBy(_1y, (obj) => moment(obj), "desc")[0];

            // var _1m = await Navs_.GET_TOP({
            //   fk_Fund: fund._id,
            //   DateCreated: {
            //     $gte: new Date(moment(new Date(n.date)).subtract(1, "months")),
            //     $lte: new Date(moment(new Date(n.date))),
            //   },
            // });

            var _1m = _.filter(all_navs, (obj) =>
              moment(obj.Date).isBetween(
                moment(nav_input_date).subtract(1, "month"),
                moment(nav_input_date)
              )
            );
            _1m = _.orderBy(_1m, (obj) => moment(obj), "desc")[0];

            // var _3m = await Navs_.GET_TOP({
            //   fk_Fund: fund._id,
            //   DateCreated: {
            //     $gte: new Date(moment(new Date(n.date)).subtract(3, "months")),
            //     $lte: new Date(moment(new Date(n.date))),
            //   },
            // });

            var _3m = _.filter(all_navs, (obj) =>
              moment(obj.Date).isBetween(
                moment(nav_input_date).subtract(3, "months"),
                moment(nav_input_date)
              )
            );
            _3m = _.orderBy(_3m, (obj) => moment(obj), "desc")[0];

            // var _3y = await Navs_.GET_TOP({
            //   fk_Fund: fund._id,
            //   DateCreated: {
            //     $gte: new Date(moment(new Date(n.date)).subtract(3, "years")),
            //     $lte: new Date(moment(new Date(n.date))),
            //   },
            // });

            var _3y = _.filter(all_navs, (obj) =>
              moment(obj.Date).isBetween(
                moment(nav_input_date).subtract(3, "years"),
                moment(nav_input_date)
              )
            );
            _3y = _.orderBy(_3y, (obj) => moment(obj), "desc")[0];

            // var _5y = await Navs_.GET_TOP({
            //   fk_Fund: fund._id,
            //   DateCreated: {
            //     $gte: new Date(moment(new Date(n.date)).subtract(5, "years")),
            //     $lte: new Date(moment(new Date(n.date))),
            //   },
            // });

            var _5y = _.filter(all_navs, (obj) =>
              moment(obj.Date).isBetween(
                moment(nav_input_date).subtract(5, "years"),
                moment(nav_input_date)
              )
            );
            _5y = _.orderBy(_5y, (obj) => moment(obj), "desc")[0];

            // var _ytd = await Navs_.GET_TOP({
            //   fk_Fund: fund._id,
            //   DateCreated: {
            //     $gte: new Date(
            //       moment(moment(new Date(n.date)).format("YYYY"))
            //         .subtract(1, "years")
            //         .endOf("year")
            //         .subtract(3, "days")
            //     ),
            //     $lte: new Date(moment(new Date(n.date))),
            //   },
            // });

            var _ytd = _.filter(
              all_navs,
              (obj) =>
                // moment(obj.Date).isBetween(
                //   moment(moment(nav_input_date).format("YYYY"))
                //     .subtract(1, "years")
                //     .endOf("year")
                //     .subtract(3, "days"),
                //   moment(nav_input_date)

                moment(obj.Date).format("YYYY") ===
                moment(nav_input_date)
                  .startOf("year")
                  .subtract(1, "day")
                  .format("YYYY")
            );
            _ytd = _.orderBy(_ytd, (obj) => moment(obj.Date), "desc")[0];

            // var _inception = await Navs_.GET_TOP({
            //   fk_Fund: fund._id,
            // });

            var _inception = _.orderBy(
              all_navs,
              (obj) => moment(obj),
              "desc"
            )[0];

            // var _52weekNavResult = await Navs_.GET({
            //   fk_Fund: fund._id,
            //   NavPerShare: { $ne: null },
            //   DateCreated: {
            //     $gte: new Date(moment(new Date(n.date)).subtract(52, "weeks")),
            //     $lte: new Date(moment(new Date(n.date))),
            //   },
            // });

            var _52weekNavResult = _.filter(all_navs, (obj) =>
              moment(obj.Date).isBetween(
                moment(nav_input_date).subtract(52, "weeks"),
                moment(nav_input_date)
              )
            );

            const _52week_shares = _.map(
              _52weekNavResult,
              (obj) => obj.NavPerShare
            );

            const _52weekNav = {
              min: _.min(_52week_shares),
              max: _.max(_52week_shares),
            };

            const nav_history = {
              _1d:
                _1d && _1d.NavPerShare
                  ? _1d.NavPerShare
                  : latest_with_nav && latest_with_nav.NavPerShare
                  ? latest_with_nav.NavPerShare
                  : newNavAmount,
              _1m:
                _1m && _1m.NavPerShare
                  ? _1m.NavPerShare
                  : latest_with_nav && latest_with_nav.NavPerShare
                  ? latest_with_nav.NavPerShare
                  : 0,
              _3m:
                _3m && _3m.NavPerShare
                  ? _3m.NavPerShare
                  : latest_with_nav && latest_with_nav.NavPerShare
                  ? latest_with_nav.NavPerShare
                  : 0,
              _1y:
                _1y && _1y.NavPerShare
                  ? _1y.NavPerShare
                  : latest_with_nav && latest_with_nav.NavPerShare
                  ? latest_with_nav.NavPerShare
                  : 0,
              _3y:
                _3y && _3y.NavPerShare
                  ? _3y.NavPerShare
                  : latest_with_nav && latest_with_nav.NavPerShare
                  ? latest_with_nav.NavPerShare
                  : 0,
              _5y:
                _5y && _5y.NavPerShare
                  ? _5y.NavPerShare
                  : latest_with_nav && latest_with_nav.NavPerShare
                  ? latest_with_nav.NavPerShare
                  : 0,
              _ytd:
                _ytd && _ytd.NavPerShare
                  ? _ytd.NavPerShare
                  : latest_with_nav && latest_with_nav.NavPerShare
                  ? latest_with_nav.NavPerShare
                  : 0,
              _inception:
                _inception && _inception.NavPerShare
                  ? _inception.NavPerShare
                  : latest_with_nav && latest_with_nav.NavPerShare
                  ? latest_with_nav.NavPerShare
                  : newNavAmount,
            };

            const nav_returns = {
              _1dReturn: (newNavAmount / nav_history._1d - 1) * 100,
              _1dDate: _1d ? _1d.Date : dateToday,
              _1mReturn: (newNavAmount / nav_history._1m - 1) * 100,
              _1mDate: _1m ? _1m.Date : dateToday,
              _3mReturn: (newNavAmount / nav_history._3m - 1) * 100,
              _3mDate: _3m ? _3m.Date : dateToday,
              _1yReturn: (newNavAmount / nav_history._1y - 1) * 100,
              _1yDate: _1y ? _1y.Date : dateToday,
              _3yReturn: (newNavAmount / nav_history._3y - 1) * 100,
              _3yDate: _3y ? _3y.Date : dateToday,
              _5yReturn: (newNavAmount / nav_history._5y - 1) * 100,
              _5yDate: _5y ? _5y.Date : dateToday,
              _ytdReturn: (newNavAmount / nav_history._ytd - 1) * 100,
              _ytdDate: _ytd ? _ytd.Date : dateToday,
              _inceptionReturn:
                newNavAmount === nav_history._inception
                  ? (latest_with_nav && latest_with_nav._inceptionReturn) || 0
                  : (newNavAmount / nav_history._inception - 1) * 100,
              _inceptionDate: _inception ? _inception.Date : dateToday,
            };

            const benchmark_history = {
              _1d:
                _1d && _1d.BenchmarkValue
                  ? _1d.BenchmarkValue
                  : latest_with_nav && latest_with_nav.BenchmarkValue
                  ? latest_with_nav.BenchmarkValue
                  : newBenchmarkAmount,
              _1m:
                _1m && _1m.BenchmarkValue
                  ? _1m.BenchmarkValue
                  : latest_with_nav && latest_with_nav.BenchmarkValue
                  ? latest_with_nav.BenchmarkValue
                  : 0,
              _3m:
                _3m && _3m.BenchmarkValue
                  ? _3m.BenchmarkValue
                  : latest_with_nav && latest_with_nav.BenchmarkValue
                  ? latest_with_nav.BenchmarkValue
                  : 0,
              _1y:
                _1y && _1y.BenchmarkValue
                  ? _1y.BenchmarkValue
                  : latest_with_nav && latest_with_nav.BenchmarkValue
                  ? latest_with_nav.BenchmarkValue
                  : 0,
              _3y:
                _3y && _3y.BenchmarkValue
                  ? _3y.BenchmarkValue
                  : latest_with_nav && latest_with_nav.BenchmarkValue
                  ? latest_with_nav.BenchmarkValue
                  : 0,
              _5y:
                _5y && _5y.BenchmarkValue
                  ? _5y.BenchmarkValue
                  : latest_with_nav && latest_with_nav.BenchmarkValue
                  ? latest_with_nav.BenchmarkValue
                  : 0,
              _ytd:
                _ytd && _ytd.BenchmarkValue
                  ? _ytd.BenchmarkValue
                  : latest_with_nav && latest_with_nav.BenchmarkValue
                  ? latest_with_nav.BenchmarkValue
                  : 0,
              _inception:
                _inception && _inception.BenchmarkValue
                  ? _inception.BenchmarkValue
                  : latest_with_nav && latest_with_nav.BenchmarkValue
                  ? latest_with_nav.BenchmarkValue
                  : newBenchmarkAmount,
            };

            const benchmark_returns = {
              b_1dReturn:
                (newBenchmarkAmount / benchmark_history._1d - 1) * 100,
              b_1dDate: _1d ? _1d.Date : dateToday,
              b_1mReturn:
                (newBenchmarkAmount / benchmark_history._1m - 1) * 100,
              b_1mDate: _1m ? _1m.Date : dateToday,
              b_3mReturn:
                (newBenchmarkAmount / benchmark_history._3m - 1) * 100,
              b_3mDate: _3m ? _3m.Date : dateToday,
              b_1yReturn:
                (newBenchmarkAmount / benchmark_history._1y - 1) * 100,
              b_1yDate: _1y ? _1y.Date : dateToday,
              b_3yReturn:
                (newBenchmarkAmount / benchmark_history._3y - 1) * 100,
              b_3yDate: _3y ? _3y.Date : dateToday,
              b_5yReturn:
                (newBenchmarkAmount / benchmark_history._5y - 1) * 100,
              b_5yDate: _5y ? _5y.Date : dateToday,
              b_ytdReturn:
                (newBenchmarkAmount / benchmark_history._ytd - 1) * 100,
              b_ytdDate: _ytd ? _ytd.Date : dateToday,
              b_inceptionReturn:
                newBenchmarkAmount === benchmark_history._inception
                  ? (latest_with_nav && latest_with_nav.b_inceptionReturn) || 0
                  : (newBenchmarkAmount / benchmark_history._inception - 1) *
                    100,
              b_inceptionDate: _inception ? _inception.Date : dateToday,
            };

            let temp = {
              ...nav_returns,
              ...benchmark_returns,

              NavPerShare:
                newNavAmount !== 0
                  ? newNavAmount
                  : (latest_with_nav && latest_with_nav.NavPerShare) || 0,
              BenchmarkValue:
                newBenchmarkAmount !== 0
                  ? newBenchmarkAmount
                  : (latest_with_nav &&
                      latest_with_nav.BenchmarkValue &&
                      latest_with_nav.BenchmarkValue) ||
                    0,

              DateCreated: new Date(n.date),
              NavFundSize: parse_to_float(n.fund_size),
              _52weekNav,
              allowed: true,
            };

            Object.keys(temp).forEach((key) => {
              if (moment(temp[key]).isValid()) {
                //key is for date
              } else {
                if (isNaN(temp[key])) {
                  console.log("is NaN", key, temp[key]);
                  temp[key] = 0;
                } else if (!isFinite(temp[key])) {
                  console.log("is infinit", key, temp[key]);
                  temp[key] = 0;
                }
              }
            });
            console.log("date => ", n.date);
            all_navs.push(temp);
            // await Navs_.UPDATE({
            //   identifier: {
            //     Date: moment(new Date(n.date)).format("YYYY-MM-DD").toString(),
            //     fk_Fund: props.fund,
            //   },
            //   data: temp,
            // });

            observables.push(
              navCollection.UPDATE({
                identifier: {
                  Date: moment(new Date(n.date))
                    .format("YYYY-MM-DD")
                    .toString(),
                  fk_Fund: props.fund,
                },
                data: temp,
              })
            );

            index += 1;
          }
          observables.push(
            fundsCollection.UPDATE({
              identifier: { _id: props.fund },
              data: {
                allowImport: false,
              },
            })
          );
          return forkJoin(observables).subscribe((dataArray) => {});
        }),
        mergeMap((z) => {
          return zip(of(props));
        })
      )
    )
  ),
  response_mapper:
    (req, res) =>
    ([data]) => {
      res.send({ success: true });
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

const NavLatestAsOfYesterday = {
  request_mapper: (req) => {
    return {
      ...req.body,
      ...req.query,
    };
  },
  processor: pipe(
    mergeMap(async (props) => {
      let latest_with_nav = await Navs_.GET({
        fk_Fund: props.fund,
        $or: [{ NavPerShare: { $ne: 0 } }, { NavPerShare: { $ne: null } }],
        DateCreated: {
          $lt: new Date(moment().format("YYYY-MM-DD")),
        },
      })
        .sort({ DateCreated: "desc" })
        .limit(1);

      return latest_with_nav;
    }),
    mergeMap((latest) => of(latest))
  ),
  response_mapper:
    (req, res) =>
    ([latest]) => {
      console.log("latest", latest);
      res.send({
        message: "success",
        data: latest,
        title: "Latest of ",
      });
    },
};

export const NavLatestAsOfYesterdayController = createController(
  NavLatestAsOfYesterday
);

export const GetAllNavRatesController = createController(
  GetAllNavRateOperation
);
export const GetAllNavRatesTodayController = createController(
  GetAllNavRateTodayOperation
);
export const GetAllNavRatesDateController = createController(
  GetAllNavRatesDateOperation
);
export const GetAllNavRatesTodayApprovalController = createController(
  GetAllNavRateTodayApprovalOperation
);
export const NavCRUDController = createController(NavCRUDOperation);
export const NavOTPVerificationController = createController(
  NavOTPVerificationOperation
);
export const deleteNavOTPVerificationController = createController(
  deleteNavOTPVerificationOperation
);
export const deleteNavMakerCheckerController = createController(
  deleteNavMakerCheckerOperation
);
export const NavMakerCheckerVerificationController = createController(
  NavMakerCheckerVerificationOperation
);
export const NavMakerCheckerDeclineController = createController(
  NavMakerCheckerDeclineOperation
);

export const getNavvRateController = createController(getNavRateOperation);
export const getAllNavvRateController = createController(
  getAllNavvRateOperation
);
export const importNavRatesController = createController(
  importNavRatesOperation
);
export const exportNavRatesController = createController(
  exportNavRatesOperation
);
export const GetNavChartDataController = createController(GetNavChartData);
export const testNavController = createController(testNavOperation);
