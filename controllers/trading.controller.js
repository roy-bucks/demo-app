import moment from "moment";
import request from "request-promise";
import { of, pipe, zip } from "rxjs";
import { mergeMap } from "rxjs/operators";
import { config } from "../config/fc_config";
import { createController } from "./helper";

//return for backend

const GetTradingDateOperation = {
  request_mapper: (req) => {
    return {
      authData: req.middleware_auth,
      body: req.query,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      const BASE_CALENDAR_URL =
        "https://www.googleapis.com/calendar/v3/calendars";
      const BASE_CALENDAR_ID_FOR_PUBLIC_HOLIDAY =
        "holiday@group.v.calendar.google.com";
      const API_KEY = config.GOOGLE_API_KEY;
      const CALENDAR_REGION = "en.philippines";
      const url = `${BASE_CALENDAR_URL}/${CALENDAR_REGION}%23${BASE_CALENDAR_ID_FOR_PUBLIC_HOLIDAY}/events?key=${API_KEY}`;
      const options = {
        method: "GET",
        url: url,
      };
      return zip(request(options), of(props));
    }),
    mergeMap(([result, props]) => {
      const holidays = JSON.parse(result);
      let retVal = [];
      if (holidays.items)
        for (let i = 0; i < holidays.items.length; i++) {
          let holiday = holidays.items[i];
          let holidayYear = holiday.start.date.split("-")[0];
          let currentDate = new Date();
          if (holidayYear === currentDate.getFullYear().toString())
            retVal.push({
              name: holiday.summary,
              description: holiday.description,
              date: holiday.start.date,
            });
        }
      return zip(
        of(retVal.sort((a, b) => new Date(a.date) - new Date(b.date)))
      );
    }),
    mergeMap(([holidays, props]) => {
      let curr = new Date();
      let week = [];
      let non_trading_dates = {};
      let day1 = moment().startOf("year");
      for (
        let i = 0;
        i <= moment().endOf("year").diff(moment().startOf("year"), "days");
        i++
      ) {
        let day = new Date(
          moment(day1.format("YYYY-MM-DD")).add(i, "days").format("YYYY-MM-DD")
        )
          .toISOString()
          .slice(0, 10);
        let holiday_details = null;
        let currentDate = new Date(day);
        if (currentDate.getDay() === 6 || currentDate.getDay() === 0) {
          // console.log('day is weekend: ', day);
          non_trading_dates[day] = "weekend";
        } else {
          if (
            holidays.some((holiday) => {
              holiday_details = holiday;
              return holiday.date === day;
            })
          ) {
            non_trading_dates[day] = holiday_details;
            // console.log('day is holiday: ', day);
          } else {
            week.push(day);
          }
        }
      }
      return zip(of(week), of(non_trading_dates));
    })
  ),
  response_mapper:
    (req, res) =>
    ([result, non_trading_dates]) => {
      res.send({
        code: 0,
        data: { trading_dates: result, non_trading_dates },
        message: "Success",
      });
    },
  error_handler: (_req, res) => (err) => {
    let status = 400;
    console.log(err);

    if (err.message === "UNAUTHORIZED") {
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

export const getTradingDateController = createController(
  GetTradingDateOperation
);
