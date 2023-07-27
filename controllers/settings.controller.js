import moment from "moment";
import { of, pipe, throwError, zip } from "rxjs";
import { mergeMap } from "rxjs/operators";
import { FundsModel } from "../models/funds.schema";
import { NavModel } from "../models/nav.schema";
import { SettingsModel } from "../models/settings.schema";
import { Collection, Collectionv2 } from "../utilities/database";
import { createController } from "./helper";
const jwt = require("jsonwebtoken");

const settingsCollection = new Collection(SettingsModel);
const fundsCollection = new Collection(FundsModel);
const navCollection_v2 = new Collectionv2(NavModel);
const ModuleManagementOTPToggleOperation = {
  request_mapper: (req) => {
    return {
      body: req.body,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(
        of(props),
        settingsCollection.GET_ONE({
          name: props.body.name,
        })
      );
    }),
    mergeMap(([props, settings]) => {
      return zip(
        of(props),
        settingsCollection.UPDATE({
          identifier: {
            name: props.body.name,
          },
          data: {
            temporary: props.body.option,
            allowed: false,
            otp: 1111,
          },
        })
      );
    })
  ),
  response_mapper:
    (req, res) =>
    ([settings]) => {
      res.send({
        message: "success",
        otpRequired: true,
      });
    },
};

const ModuleManagementOTPVerifyOperation = {
  request_mapper: (req) => {
    return {
      body: req.body,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      const data = props.body;
      if (data && data.name) {
        return zip(
          of(props),
          settingsCollection.GET_ONE({
            name: props.body.name,
          })
        );
      }
      return throwError(new Error("Settings not found!"));
    }),
    mergeMap(([props, settings]) => {
      console.log("otp: ", parseInt(props.body.otp));
      console.log("otp: ", parseInt(props.body.otp));
      console.log("sett: ", parseInt(settings.otp));
      if (parseInt(props.body.otp) === parseInt(settings.otp)) {
        return zip(
          settingsCollection.UPDATE({
            identifier: {
              _id: settings._id,
            },
            data: {
              option: settings.temporary,
              temporary: null,
              allowed: true,
              otp: null,
            },
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
};

const NAVToggleOperation = {
  request_mapper: (req) => {
    return {
      body: req.body,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      const option = props.body.option;
      return zip(
        settingsCollection.UPDATE({
          identifier: {
            name: "nav",
          },
          data: {
            option,
          },
        })
      );
    })
  ),
  response_mapper:
    (req, res) =>
    ([settings]) => {
      res.send({
        message: "success",
      });
    },
};
const SubscriptionFeeOperation = {
  request_mapper: (req) => {
    return {
      body: req.body,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      const option = props.body.option;
      return zip(
        settingsCollection.UPDATE({
          identifier: {
            name: "subscription",
          },
          data: {
            option,
          },
        })
      );
    })
  ),
  response_mapper:
    (req, res) =>
    ([settings]) => {
      res.send({
        message: "success",
      });
    },
};
const RedemptionFeeOperation = {
  request_mapper: (req) => {
    return {
      body: req.body,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      const option = props.body.option;
      return zip(
        settingsCollection.UPDATE({
          identifier: {
            name: "redemption",
          },
          data: {
            option,
          },
        })
      );
    })
  ),
  response_mapper:
    (req, res) =>
    ([settings]) => {
      res.send({
        message: "success",
      });
    },
};

const GetSettingsOperation = {
  request_mapper: (req) => {
    return {
      query: req.query,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      const query = props.query;
      return zip(
        settingsCollection.GET_ONE({
          name: query.type,
        })
      );
    })
  ),
  response_mapper:
    (req, res) =>
    ([settings]) => {
      res.send({
        settings: settings.option,
      });
    },
};

//const test_current_date = "2023-02-02 12:01:00"; // FOR TESTING! set to "undefined" to get current datetime
const test_current_date = undefined;
const _12TH_HOUR = 12; // CUT_OFF OF DAILY NAV:  if current datetime exceeds 12th hour of day. NAV update will take effect on CURRENT DATE
const GetNavCutOff = {
  request_mapper: (req) => {
    return {
      query: req.query,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      const query = props.query;
      return zip(
        settingsCollection.GET_ONE({
          name: "nav",
        }),
        of(query)
      );
    }),
    mergeMap(([nav_settings, query]) => {
      const current_time = moment(test_current_date);
      const options = nav_settings.option;
      let settings = {
        show_edit: false,
        show_add: false,
        show_delete: false,
      };
      const {
        delete_cutoff_end,
        delete_cutoff_start,
        add_cut_off_end,
        add_cut_off_start,
        is_add_end_next_day,
        edit_cutoff_tomorrow_end,
        edit_cutoff_tomorrow_start,
      } = options;

      //ADD
      const add_start = moment(
        `${current_time.format("YYYY-MM-DD")} ${add_cut_off_start}`
      );
      let add_end = moment(
        `${current_time.format("YYYY-MM-DD")} ${add_cut_off_end}`
      );
      if (is_add_end_next_day) add_end.add(1, "day");
      const show_add = current_time.isBetween(add_start, add_end)
        ? true
        : false;
      settings.show_add = show_add;

      //EDIT
      const edit_start = moment(
        `${current_time.format("YYYY-MM-DD")} ${edit_cutoff_tomorrow_start}`
      );
      let edit_end = moment(
        `${current_time.format("YYYY-MM-DD")} ${edit_cutoff_tomorrow_end}`
      );
      const show_edit = current_time.isBetween(edit_start, edit_end)
        ? true
        : false;
      settings.show_edit = show_edit;

      //DELETE
      const delete_start = moment(
        `${current_time.format("YYYY-MM-DD")} ${delete_cutoff_start}`
      );
      let delete_end = moment(
        `${current_time.format("YYYY-MM-DD")} ${delete_cutoff_end}`
      );
      const show_delete = current_time.isBetween(delete_start, delete_end)
        ? true
        : false;
      settings.show_delete = show_delete;

      return zip(of({ ...options, settings }), of(query));
    }),
    mergeMap(([settings, query]) => {
      const is_get_today =
        moment(test_current_date) >
        moment(`${moment().format("YYYY-MM-DD")}`).add(_12TH_HOUR, "hours");

      const navs = of(settings).pipe(
        mergeMap(async () => {
          let current;
          let yesterday;
          if (is_get_today) {
            console.log("fetching today");
            yesterday = await navCollection_v2
              .GET({
                fk_Fund: query.fund,
                $or: [
                  { NavPerShare: { $ne: 0 } },
                  { NavPerShare: { $ne: null } },
                ],
                DateCreated: {
                  $lt: new Date(moment().format("YYYY-MM-DD")),
                },
              })
              .sort({ DateCreated: "desc" })
              .limit(1);
            yesterday = yesterday[0];

            current = await navCollection_v2.GET_ONE({
              fk_Fund: query.fund,
              $or: [
                { NavPerShare: { $ne: 0 } },
                { NavPerShare: { $ne: null } },
              ],
              Date: moment().format("YYYY-MM-DD"),
            });
          } else {
            console.log("fetching yesterday");
            const latest_with_nav = await navCollection_v2
              .GET({
                fk_Fund: query.fund,
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
            current = latest_with_nav[0];
            yesterday = latest_with_nav[1];
          }

          return { current, yesterday };
        })
      );
      return zip(of(settings), navs, of(is_get_today));
    }),
    mergeMap(([option, navs, is_show_today]) => {
      let { settings } = option;
      const nav = navs.current;
      console.log("before", settings);
      if (!!nav) {
        //current conditions
        if (nav.NavPerShare && is_show_today && settings.show_add) {
          settings.show_edit = true;
          settings.show_delete = true;
        }
        if (nav.NavPerShare && is_show_today) settings.show_add = false;

        // show edit conditions
        if (nav.NavPerShare && is_show_today && settings.show_edit) {
          settings.show_edit = true;
        }
        if (nav.NavPerShare && is_show_today && !settings.show_edit) {
          settings.show_edit = false;
        }

        //show delete conidtions
        if (nav.NavPerShare && settings.show_delete && !is_show_today) {
          settings.show_delete = true;
          settings.show_edit = false;
        }
      } else {
        settings.show_delete = false;

        //show add conditions
        if (is_show_today) settings.show_add = true;
        if (settings.show_edit && !is_show_today) {
          settings.show_add = true;
        }

        if (settings.show_delete) {
          settings.show_delete = false;
        }
      }
      console.log("after", settings);
      const nav_date = is_show_today
        ? moment().format("YYYY-MM-DD")
        : moment().subtract(1, "day").format("YYYY-MM-DD");
      return zip(of({ settings, navs, nav_date }));
    })
  ),

  response_mapper:
    (req, res) =>
    ([settings]) => {
      res.send(settings);
    },
};

const GetAllSettingsOperation = {
  request_mapper: (req) => {
    return {
      query: req.query,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      const query = props.query;
      return zip(settingsCollection.GET({}));
    }),
    mergeMap(([settings]) => {
      let temp = {};
      settings.forEach((setting, index) => {
        temp[setting.name] = { option: setting.option };
      });
      return zip(of(temp));
    })
  ),
  response_mapper:
    (req, res) =>
    ([settings]) => {
      res.send(settings);
    },
};

const UpdateFundSettings = {
  request_mapper: (req) => {
    return {
      ...req.query,
      ...req.body,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(fundsCollection.GET_ONE({ _id: props._id }), of(props));
    }),
    mergeMap(([fund, props]) => {
      if (fund._id) {
        return zip(
          fundsCollection.UPDATE({
            identifier: { _id: fund._id },
            data: { allowImport: props.allowImport },
          })
        );
      } else {
        return throwError(new Error("Fund not found"));
      }
    })
  ),
  error_handler: (_req, re) => (err) => {
    console.log("Error found => ", err.message);
    re.send(err.message);
  },
  response_mapper:
    (req, res) =>
    ([data]) =>
      res.send(data),
};

export const GetSettingsController = createController(GetSettingsOperation);
export const GetAllSettingsController = createController(
  GetAllSettingsOperation
);
export const ModuleManagementOTPToggleController = createController(
  ModuleManagementOTPToggleOperation
);
export const ModuleManagementOTPVerifyController = createController(
  ModuleManagementOTPVerifyOperation
);
export const NAVToggleController = createController(NAVToggleOperation);
export const SubscriptionFeeController = createController(
  SubscriptionFeeOperation
);
export const RedemptionFeeController = createController(RedemptionFeeOperation);
export const UpdateFundSettingsController =
  createController(UpdateFundSettings);

export const GetNavCutOffController = createController(GetNavCutOff);
