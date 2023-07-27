import _ from "lodash";
import moment from "moment/moment";
import mongoose from "mongoose";
import { forkJoin, of, pipe, throwError, zip } from "rxjs";
import { mergeMap } from "rxjs/operators";
import { tokenKey } from "../config";
import { FundsModel } from "../models/funds.schema";
import { LogsModel } from "../models/logs_schema";
import { NavModel } from "../models/nav.schema";
import { PartnerCodeModel } from "../models/partner_code.schema";
import { TransactionsModel } from "../models/transactions.schema";
import { TransactionsFCModel } from "../models/transactions_fc.schema";
import { UserModel } from "../models/user.schema";
import { UserDeviceModel } from "../models/user_device_token.schema";
import { UserFundsModel } from "../models/user_funds.schema";
import { formatDatev2, getDateYesterday } from "../utilities";
import { Collection, Collectionv2 } from "../utilities/database";
import { geAUMData_, getAccessToken, getPortfolioData } from "../utilities/fc";
import { addLog } from "../utilities/logs";
import { sendMessage, sendSMS_PTX } from "../utilities/messaging";
import {
  generateCode,
  generateID,
  generatePassword,
  validPassword,
} from "../utilities/security";
import { uploadFile } from "../utilities/upload";
import { createController, generateRequiredSchemaItems } from "./helper";

const jwt = require("jsonwebtoken");

const user = new Collection(UserModel);
const transactions = new Collection(TransactionsModel);
const userDeviceToken = new Collection(UserDeviceModel);
const partner_codes = new Collection(PartnerCodeModel);
const transactions_FC = new Collection(TransactionsFCModel);
const Funds = new Collection(FundsModel);
const transactionDB = new Collection(TransactionsModel);
const userFundsDB = new Collection(UserFundsModel);
const logs_collection = new Collection(LogsModel);
const NavCollection_v2 = new Collectionv2(NavModel);
const LoginOperation = {
  request_mapper: (req) => {
    return {
      user: req.user,
      ...req.body,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(
        userDeviceToken.DELETE({
          DeviceToken: props.DeviceToken,
        }),
        of(props)
      );
    }),
    mergeMap(([temp, props]) => {
      return userDeviceToken.UPDATE({
        identifier: {
          DeviceToken: props.DeviceToken,
        },
        data: {
          fk_User: props.user._id,
          DeviceToken: props.DeviceToken,
          DateUpdated: new Date(),
        },
      });
    })
  ),
  response_mapper: (req, res) => {
    // console.log(req)
    const user = req.user;

    if (user.UserLevel < 3) {
      res.sendStatus(403);
    } else {
      if (user.Active) {
        const token = jwt.sign({ ...user }, tokenKey);
        res.send({
          token,
          message: "Login Successful",
          AccountNo: user.AccountNo,
          Image: user.Image,
          Email: user.Email,
          FirstName: user.FirstName,
          LastName: user.LastName,
          MiddleName: user.MiddleName,
          MobileNo: user.MobileNo,
          Nationality: user.Nationality,
          Gender: user.Gender,
          DateOfBirth: user.DateOfBirth,
          UserLevel: user.UserLevel,
          RiskProfile: user.RiskProfile,
          Tier: user.Tier,
          MasterInvestorCode: user.MasterInvestorCode,
          DateCreated: user.DateCreated,

          //tier 2

          Address: user.Address,
          TypeOfID: user.TypeOfID,
          IDNumber: user.IDNumber,
          ExpirationOfID: user.ExpirationOfID,
          SourceOfIncome: user.SourceOfIncome,
          NatureOfWork: user.NatureOfWork,
          NameOfEmployer: user.NameOfEmployer,
          OfficeAddress: user.OfficeAddress,
          TransactionAmount: user.TransactionAmount,
          Active: user.Active,
        });
      } else {
        res.status(503).send();
      }
    }
  },
};
const Login_AdminOperation = {
  response_mapper: (req, res) => {
    const user = req.user;
    const token = jwt.sign({ ...user }, tokenKey);
    if (!req.user.UserLevel || req.user.UserLevel > 3) res.sendStatus(403);
    else {
      addLog(user._id, "Authentication", "Login");
      res.send({
        token,
        Name: user.Firstname + " " + user.LastName,
        Email: user.Email,
        message: "Login Successful",
        UserLevel: req.user.UserLevel,
        _id: req.user._id,
      });
    }
  },
};
const GetUserDetailsOperation = {
  request_mapper: (req) => {
    return {
      user: req.middleware_auth,
    };
  },
  processor: mergeMap((props) => {
    if (props.user === null) {
      return throwError(new Error("User is not found!"));
    }
    return of(props.user);
  }),
  response_mapper: (req, res) => (user) => {
    res.send({
      AccountNo: user.AccountNo,
      Image: user.Image,
      Email: user.Email,
      FirstName: user.FirstName,
      LastName: user.LastName,
      MiddleName: user.MiddleName,
      MobileNo: user.MobileNo,
      Nationality: user.Nationality,
      Gender: user.Gender,
      DateOfBirth: user.DateOfBirth,
      UserLevel: user.UserLevel,
      RiskProfile: user.RiskProfile,
      Tier: user.Tier,
      MasterInvestorCode: user.MasterInvestorCode,
      DateCreated: user.DateCreated,

      //tier 2

      Address: user.Address,
      TypeOfID: user.TypeOfID,
      IDNumber: user.IDNumber,
      ExpirationOfID: user.ExpirationOfID,
      SourceOfIncome: user.SourceOfIncome,
      NatureOfWork: user.NatureOfWork,
      NameOfEmployer: user.NameOfEmployer,
      OfficeAddress: user.OfficeAddress,

      TransactionAmount: user.TransactionAmount,
    });
  },
};
const RegisterOperation = {
  request_mapper: (req) => {
    return {
      ...req.body,
      user: req.middleware_auth,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      console.log("props: ", props);
      return zip(
        user.GET_ONE({ Email: props.email }),
        Funds.GET({
          FundIdentifier: {
            $in: props.funds,
          },
        }),
        of(props)
      );
    }),
    mergeMap(([user_, fund, props]) => {
      if (!!user_) {
        return throwError(new Error("USER ALREADY EXISTS"));
      }
      const password = props.password;
      const { salt, hash } = generatePassword(password);
      const id = "BX" + generateCode();

      return zip(
        of(props),
        of(fund),
        user.ADD({
          AccountNo: id,
          Email: props.email,
          // FirstName: props.firstName,
          // LastName: props.lastName,
          // MiddleName: props.middleName,
          // MobileNo: props.mobileNumber,
          Department: props.department,
          Nationality: "",
          DateOfBirth: "",
          Gender: "",
          RiskProfile: null,
          MasterInvestorCode: null,
          Tier: 1,
          salt,
          hash,
          UserLevel: props.userLevel,
          DateCreated: new Date(),
          TransactionAmount: 0,
          Active: true,
          FmProvider: props.FmProvider,
        }),
        addLog(props.user._id, "Authentication", "Add/Register New User")
      );
    }),
    mergeMap(async ([props, funds, user, log]) => {
      if (funds && funds.length) {
        let observables = [];
        for (let i = 0; i < funds.length; i++) {
          let fund = funds[i];
          let fundManagers =
            fund.managers && fund.managers.length ? fund.managers : [];
          fundManagers.push(user._id);
          observables.push(
            Funds.UPDATE({
              identifier: {
                _id: fund._id,
              },
              data: {
                managers: fundManagers,
              },
            })
          );
          observables.push(
            userFundsDB.ADD({
              fk_User: user._id,
              fk_Fund: fund._id,
              Date: new Date(),
            })
          );
        }

        return forkJoin(observables).subscribe((dataArray) => {});
      } else {
        return zip(of(props), of(user));
      }
    }),
    mergeMap((settings) => {
      return zip(of({}));
    })
  ),
  response_mapper: (req, res) => (val) => {
    res.send({
      message: "Successfully Registered User!",
    });
  },
  error_handler: (_req, res) => (err) => {
    let status = 500;
    if (err.message == "USER ALREADY EXISTS") {
      status = 400;
    }

    if (err.message == "ERROR IN FUND COUNT API") {
      status = 502;
    }

    console.log(err);
    res.status(status).json({
      code: status,
      status: "failed",
      message: err.message,
    });
  },
};

const RegisterAdminOperation = {
  request_mapper: (req) => {
    return {
      ...req.body,
      user: req.middleware_auth,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(user.GET({ Email: props.Email }), of(props));
    }),
    mergeMap(([user_, props]) => {
      if (user_.length != 0) {
        return throwError(new Error("USER ALREADY EXISTS"));
      }
      if (props.user.UserLevel != 1) {
        return throwError(new Error("UNAUTHORIZED"));
      }
      const password = props.password;
      const { salt, hash } = generatePassword(password);
      const id = "BX" + generateCode();
      return zip(
        of(props),
        user.ADD({
          Email: props.email,
          FirstName: props.firstName ? props.firstName : "",
          LastName: props.lastName ? props.lastName : "",
          MobileNo: props.MobileNo ? props.MobileNo : "",
          salt,
          hash,
          UserLevel: 1,
          DateCreated: new Date(),
          Active: true,
        })
      );
    })
  ),
  response_mapper: (req, res) => (val) => {
    res.send({
      message: "Successfully Registered User!",
    });
  },
  error_handler: (_req, res) => (err) => {
    let status = 500;
    if (err.message == "USER ALREADY EXISTS") {
      status = 400;
    }

    if (err.message == "UNAUTHORIZED") {
      status = 403;
    }

    console.log(err);
    res.status(status).json({
      code: status,
      status: "failed",
      message: err.message,
    });
  },
};
const ChangePasswordOperation = {
  requestValidationSchema: generateRequiredSchemaItems([
    "body.NewPassword",
    "body.CurrentPassword",
  ]),
  request_mapper: (req) => {
    return {
      ...req.body,
      user: req.middleware_auth,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      if (validPassword(props.user, props.CurrentPassword)) {
        const password = props.NewPassword;
        const { salt, hash } = generatePassword(password);
        return zip(
          of(props),
          user.UPDATE({
            identifier: {
              _id: props.user._id,
            },
            data: {
              salt: salt,
              hash: hash,
            },
          })
        );
      } else {
        return throwError(new Error("INCORRECT PASSWORD"));
      }
    })
  ),
  response_mapper:
    (req, res) =>
    ([props, user]) => {
      res.send({
        message: "Successfully Changed Password!",
      });
    },
  error_handler: (_req, res) => (err) => {
    let status = 500;
    if (err.message == "INCORRECT PASSWORD") {
      status = 400;
    }

    console.log(err);
    res.status(status).json({
      code: status,
      status: "failed",
      message: err.message,
    });
  },
};
const ResetPasswordOperation = {
  requestValidationSchema: generateRequiredSchemaItems(["body.Email"]),
  request_mapper: (req) => req.body,
  processor: pipe(
    mergeMap((props) => {
      return user.GET_ONE({ Email: props.Email });
    }),
    mergeMap((props) => {
      if (props != null) {
        const password = generateID(4);
        const { salt, hash } = generatePassword(password);
        return zip(
          of(props),
          of(password),
          user.UPDATE({
            identifier: {
              _id: props._id,
            },
            data: {
              salt: salt,
              hash: hash,
            },
          })
        );
      } else {
        return throwError(new Error("USER_DOES_NOT_EXISTS"));
      }
    }),
    mergeMap(([props, password, user]) => {
      return sendMessage({
        to: props.Email,
        subject: "Reset Password",
        html: `
              <h4>Hi ${props.FirstName} ${props.LastName},</h4>

              <p>
                 Your New Password is <b>${password}</b>
              </p>
              <p>
                Once you've logged in, go to your Profile to change your password.
              </p>

              <br/>

              <h4>
                Just a reminder:
              </h4>
              <p>
                Never share your password with anyone. Our customer service team will never ask you for your password, OTP, credit card or banking info.
              </p>
              <p>
                Create passwords that are hard to guess and don't use personal information. Be sure to include uppercase and lowercase letters, numbers, and symbols.
              </p>

              <br/>
              <br/>
              <h3>Thank you,</h3>
              <h3>Buxabee Team</h3>
          `,
      });
    })
  ),
  response_mapper: (req, res) => (val) => {
    res.send({
      message: "Successfully reset password!",
    });
  },
  error_handler: (_req, res) => (err) => {
    let status = 500;
    if (err.message == "USER_DOES_NOT_EXIST") {
      status = 400;
    }

    console.log(err);
    res.status(status).json({
      code: status,
      status: "failed",
      message: err.message,
    });
  },
};
const DeleteAccountOperation = {
  requestValidationSchema: generateRequiredSchemaItems(["query.id"]),
  request_mapper: (req) => {
    if (req.query.Barangay === undefined && req.query.UserLevel === undefined) {
      return { _id: req.query.id };
    } else if (req.query.UserLevel !== undefined) {
      return { _id: req.query.id, UserLevel: req.query.UserLevel };
    } else {
      return { _id: req.query.id, UserLevel: req.query.UserLevel };
    }
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(of(props), user.DELETE_ONE(props));
    }),
    mergeMap(([props, deleteduser]) => user.GET({ UserLevel: props.UserLevel }))
  ),
  response_mapper: (req, res) => (val) => {
    res.send({
      message: "Successfully Deleted Account!",
      accounts: val,
    });
  },
};
const GetOTPOperation = {
  requestValidationSchema: generateRequiredSchemaItems([
    "body.type",
    "body.FirstName",
    "body.LastName",
    "body.MobileNo",
    "body.Email",
    "body.otp",
  ]),
  request_mapper: (req) => req.body,
  processor: pipe(
    mergeMap((props) => {
      console.log("props: ", props);
      return props.type === "Email"
        ? sendMessage({
            to: props.Email,
            subject: "Buxabee One Time Pin (OTP)",
            html: `
              <h4>Hi ${props.FirstName} ${props.LastName},</h4>

              <p>
                 Your One Time Pin is <b>${props.otp}</b>
              </p>

              <p><b>DO NOT SHARE IT TO ANYONE!</b></p>

              <br/>
              <br/>
              <br/>

              <h3>Thank you,</h3>
              <h3>Buxabee Team</h3>
          `,
          })
        : sendSMS_PTX({
            to: props.MobileNo,
            text: `Hi ${props.FirstName} ${props.LastName}, your One Time Pin is ${props.otp}. DO NOT SHARE IT TO ANYONE! Thank you, Buxabee Team`,
          });
    })
  ),
  response_mapper: (req, res) => (val) => {
    res.send({
      data: val,
      message: "Successfully sent OTP!",
    });
  },
};
const GetAccounts_AdminOperation = {
  request_mapper: (req) => {
    return { UserLevel: 1 };
  },
  processor: mergeMap(user.GET),
  response_mapper: (req, res) => (val) => {
    res.send({
      accounts: val,
    });
  },
};
const GetAccounts_InvestorOperation = {
  request_mapper: (req) => {
    return {
      ...req.query,
      ...req.body,
      userData: req.middleware_auth,
    };
  },
  processor: pipe(
    mergeMap((params) => {
      return zip(of(params), Funds.GET({}));
    }),
    mergeMap(([query_params, fund]) => {
      //get the funds of user
      let userLevel = query_params.userData.UserLevel;
      let userId = query_params.userData._id.toString();

      let funds = [];
      if (userLevel == 1) {
        funds = fund;
      } else {
        for (let a = 0; a < fund.length; a++) {
          for (let b = 0; b < fund[a].managers.length; b++) {
            if (userId == String(fund[a].managers[b])) {
              funds.push(fund[a]);
            }
          }
        }
      }

      let userFunds = funds.map((a) => a._id);

      let match = {
        TransactionID: {
          $ne: null,
        },
        fk_Fund: { $in: userFunds },
        Type: 1,
      };

      return zip(
        of(userFunds),
        of(query_params),
        transactions.AGGREGATE([
          {
            $sort: {
              Date: -1,
            },
          },
          {
            $match: match,
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
            $unwind: "$user",
          },
          {
            $lookup: {
              from: "funds",
              localField: "fk_Fund",
              foreignField: "_id",
              as: "funds",
            },
          },
          {
            $unwind: "$funds",
          },
          {
            $group: {
              _id: "$fk_User",
              data: {
                $first: "$$ROOT",
              },
              sum: {
                $sum: {
                  $toInt: "$Amount",
                },
              },
              count: {
                $sum: 1,
              },
            },
          },
          {
            $replaceRoot: {
              newRoot: {
                $mergeObjects: [
                  "$data",
                  { totalAmount: "$sum", count: "$count" },
                ],
              },
            },
          },
        ]),
        user.GET({ bankId: { $ne: null } }),
        transactions.GET({})
      );
    }),
    //validate
    mergeMap(
      ([userfund, query_params, userTransaction, userss, transactions]) => {
        let transactemp = [];

        for (let a = 0; a < userfund.length; a++) {
          for (let b = 0; b < transactions.length; b++) {
            if (String(userfund[a]) == String(transactions[b].fk_Fund)) {
              transactemp.push(transactions[b]);
            }
          }
        }

        let userId = query_params.userData._id.toString();
        let holder = [];

        for (let i = 0; i < userss.length; i++) {
          let fundsCount = [];
          for (let d = 0; d < transactemp.length; d++) {
            // console.log(`${transactemp[d].fk_User} === ${userss[i]._id}`)
            if (String(transactemp[d].fk_User) === String(userss[i]._id)) {
              fundsCount.push(transactemp[d]);
            }
          }
          let unique = [
            ...new Set(fundsCount.map((item) => String(item.fk_Fund))),
          ];

          // let finalFundCount = unique.length;
          let regularUser = userss[i];
          let userWithTransaction = userTransaction.find(
            (o) => o.user._id.toString() === regularUser._id.toString()
          );
          if (query_params.fund_identifier) {
            userWithTransaction["count"] = 1;
            if (
              userWithTransaction &&
              userWithTransaction.funds &&
              userWithTransaction.funds.FundIdentifier
            ) {
              if (
                query_params.fund_identifier !==
                userWithTransaction.funds.FundIdentifier
              )
                continue;
            }
            if (!userWithTransaction) continue;
          }

          holder.push({
            _id: regularUser._id,
            bankId: regularUser.bankId,
            AccountNo: regularUser.AccountNo,
            Email: regularUser.Email,
            FirstName: regularUser.FirstName,
            LastName: regularUser.LastName,
            MiddleName: regularUser.MiddleName,
            MobileNo: regularUser.MobileNo,
            Nationality: regularUser.Nationality,
            DateOfBirth: regularUser.DateOfBirth,
            Gender: regularUser.Gender,
            RiskProfile: regularUser.RiskProfile,
            MasterInvestorCode: regularUser.MasterInvestorCode,
            Tier: regularUser.Tier,
            salt: regularUser.salt,
            hash: regularUser.hash,
            UserLevel: regularUser.UserLevel,
            DateCreated: regularUser.DateCreated,
            TransactionAmount: regularUser.TransactionAmount,
            Active: regularUser.Active,
            fundsCount: userWithTransaction ? unique.length : 0,
            funds: userWithTransaction ? userWithTransaction.funds : null,
          });
        }
        if (query_params.userData.UserLevel === 1) {
          return zip(of(holder));
        }

        let temp = [];

        for (let i = 0; i < holder.length; i++) {
          const trans = holder[i].funds;
          if (trans) {
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
              if (!!query_params.fund_identifier) {
                if (
                  query_params.fund_identifier.toLowerCase() ===
                  trans.FundIdentifier.toLowerCase()
                ) {
                  temp.push(holder[i]);
                }
              } else {
                temp.push(holder[i]);
              }
            } else {
              console.log("account holder has no funds");
            }
          } else {
            // console.log("no transaction");
          }
        }
        if (typeof query_params.keyword !== "undefined") {
          temp = _.filter(temp, (obj) => {
            const name = `${obj.FirstName} ${obj.LastName}`;
            const pattern = new RegExp(`^${query_params.keyword}`, "i");
            if (
              name.match(pattern) ||
              obj.RiskProfile.match(pattern) ||
              obj.AccountNo.match(pattern)
            )
              return true;
          });
        }
        return zip(of(temp));
      }
    )
  ),
  response_mapper: (req, res) => (val) => {
    res.send({
      accounts: val,
    });
  },
};
const UpdateUserOperation = {
  requestValidationSchema: generateRequiredSchemaItems(["body.MobileNo"]),
  request_mapper: (req) => {
    return {
      data: req.body,
      user: req.middleware_auth,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(
        of(props),
        user.UPDATE({
          identifier: {
            _id: props.user._id,
          },
          data: props.data,
        })
      );
    }),
    mergeMap(([props, temp]) => user.GET_ONE({ _id: props.user._id }))
  ),
  response_mapper: (req, res) => (user) => {
    res.send({
      data: user,
      message: "Successfully updated user information!",
    });
  },
};
const ActivateUserOperation = {
  requestValidationSchema: generateRequiredSchemaItems([
    "body.Active",
    "body.fk_User",
  ]),
  request_mapper: (req) => {
    return {
      data: req.body,
      user: req.middleware_auth,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      if (user.UserLevel > 2) {
        return throwError(new Error("UNAUTHORIZED"));
      }
      return of(props);
    }),
    mergeMap((props) => {
      return zip(
        of(props),
        user.UPDATE({
          identifier: {
            _id: props.data.fk_User,
          },
          data: {
            Active: props.data.Active,
          },
        })
      );
    }),
    mergeMap(([props, temp]) => user.GET_ONE({ _id: props.data.fk_User }))
  ),
  response_mapper: (req, res) => (user) => {
    res.send({
      data: user,
      message: "Successfully updated user information!",
    });
  },
  error_handler: (_req, res) => (err) => {
    let status = 500;
    console.log(err);

    if (err.message === "UNAUTHORIZED") status = 403;

    res.status(status).json({
      code: status,
      status: "failed",
      message: err.message,
    });
  },
};
const GetTransactionsOperation = {
  //payments
  request_mapper: (req) => {
    var accessor = req.middleware_auth;
    if (accessor.UserLevel == 1) {
      return {
        fk_User: mongoose.Types.ObjectId(req.query.fk_User),
        user: accessor,
      };
    } else {
      return {
        fk_User: req.middleware_auth._id,
        user: accessor,
      };
    }
  },
  processor: mergeMap((query) => {
    let query_ = [
      { $sort: { Date: -1 } },
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
        $match:
          query.user.UserLevel == 1
            ? { fk_User: mongoose.Types.ObjectId(query.fk_User) }
            : query,
      },
      {
        $lookup: {
          from: "funds",
          localField: "fk_Fund",
          foreignField: "_id",
          as: "funds",
        },
      },
      { $unwind: "$funds" },
      {
        $project: {
          _id: 0,
          fk_User: 1,
          Date: 1,
          Status: 1,
          Description: 1,
          TransactionID: 1,
          PaymentMethod: 1,
          RedemptionData: 1,
          RefNo: 1,
          Amount: 1,
          Fee: 1,
          Type: 1,
          "user.FirstName": 1,
          "user.LastName": 1,
          "user.MobileNo": 1,
          "funds.Name": 1,
          "funds.FundIdentifier": 1,
          "funds.Logo": 1,
        },
      },
    ];
    console.log("query: ", JSON.stringify(query_));
    return transactions.AGGREGATE(query_);
  }),
  response_mapper: (req, res) => (val) => {
    val = val.filter((m) => {
      if (m.Type == 1) {
        return m.RefNo != null;
      } else if (m.Type == 2) {
        return true;
      }
    });
    res.send({
      transactions: val,
    });
  },
};

const GetTransactionsInvestmentOperation = {
  //investments //fund count
  request_mapper: (req) => {
    // console.log(req.middleware_auth)
    var accessor = req.middleware_auth;
    if (accessor.UserLevel == 1) {
      return {
        fk_User: mongoose.Types.ObjectId(req.query.fk_User),
        user: accessor,
      };
    } else {
      return {
        fk_User: req.middleware_auth._id,
        user: accessor,
      };
    }
  },
  processor: mergeMap((query) => {
    return transactions_FC.AGGREGATE([
      { $sort: { Date: -1 } },
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
        $match:
          query.user.UserLevel == 1
            ? { fk_User: mongoose.Types.ObjectId(query.fk_User) }
            : query,
      },
      {
        $lookup: {
          from: "funds",
          localField: "fk_Fund",
          foreignField: "_id",
          as: "funds",
        },
      },
      { $unwind: "$funds" },
      {
        $project: {
          _id: 0,
          series: 1,
          fk_User: 1,
          Date: 1,
          Type: 1,
          amount: 1,
          capital: 1,
          fee: 1,
          net_proceeds: 1,
          unit_price: 1,
          units: 1,
          units_ending_values: 1,
          "user.FirstName": 1,
          "user.LastName": 1,
          "user.MobileNo": 1,
          "funds.Name": 1,
          "funds.FundIdentifier": 1,
          "funds.Logo": 1,
        },
      },
    ]);
  }),
  response_mapper: (req, res) => (val) => {
    // console.log(val)
    res.send({
      transactions: val,
    });
  },
};

const GetUserFundsOperation = {
  request_mapper: (req) => {
    var accessor = req.middleware_auth;
    if (accessor.UserLevel == 1) {
      return {
        fk_User: req.query.fk_User,
        user: accessor,
      };
    } else {
      return {
        fk_User: req.middleware_auth._id,
        user: accessor,
      };
    }
  },
  processor: mergeMap((query) => {
    return partner_codes.AGGREGATE([
      { $sort: { Date: -1 } },
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
        $match:
          query.user.UserLevel == 1
            ? { fk_User: mongoose.Types.ObjectId(query.fk_User) }
            : query,
      },
      {
        $lookup: {
          from: "funds",
          localField: "fk_Fund",
          foreignField: "_id",
          as: "funds",
        },
      },
      { $unwind: "$funds" },
      {
        $lookup: {
          from: "nav",
          let: {
            date: formatDatev2(new Date()),
            fk_Fund: "$fk_Fund",
          },
          pipeline: [
            { $match: { $expr: { $eq: ["$Date", "$$date"] } } },
            { $match: { $expr: { $eq: ["$fk_Fund", "$$fk_Fund"] } } },
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
        $lookup: {
          from: "user_totalequity",
          let: {
            date: getDateYesterday(),
            fk_Fund: "$fk_Fund",
            partnerCode: "$PartnerCode",
          },
          pipeline: [
            { $match: { $expr: { $eq: ["$Date", "$$date"] } } },
            { $match: { $expr: { $eq: ["$fk_Fund", "$$fk_Fund"] } } },
            { $match: { $expr: { $eq: ["$PartnerCode", "$$partnerCode"] } } },
          ],
          as: "equity",
        },
      },
      {
        $unwind: {
          path: "$equity",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 0,
          fk_User: 1,
          fk_Fund: 1,
          PartnerCode: 1,
          Balance: 1,
          TotalEquity: 1,
          TotalPaidIn: 1,
          TotalUnits: 1,
          Date: 1,
          Status: 1,
          DateCreated: 1,
          "equity.TotalEquity": 1,
          "navs.NavPerShare": 1,
          "user.FirstName": 1,
          "user.LastName": 1,
          "user.MobileNo": 1,
          "funds.Name": 1,
          "funds.Logo": 1,
          "funds.FundIdentifier": 1,
          "funds.RiskType": 1,
        },
      },
    ]);
  }),
  response_mapper: (req, res) => (val) => {
    console.log("funds: ", val);
    res.send({
      funds: val,
    });
  },
};

const UploadProfileImageOperation = {
  request_mapper: (req) => {
    return {
      image: req.file,
      user: req.middleware_auth,
    };
  },
  processor: mergeMap((props) =>
    of(props).pipe(
      mergeMap(() => {
        const image = {
          path: `user/${props.user._id}/thumbnail.jpg`,
          body: props.image.buffer,
        };
        return uploadFile(image);
      }),
      mergeMap((image) =>
        user.UPDATE({
          identifier: {
            _id: props.user._id,
          },
          data: {
            Image: `${image.path}?random=${generateCode()}`,
          },
        })
      ),
      mergeMap(() => user.GET_ONE({ _id: props.user._id }))
    )
  ),
  response_mapper: (_req, res) => (user) => {
    res.status(200).json({
      message: "Profile picture successfully uploaded!",
      data: {
        AccountNo: user.AccountNo,
        Image: user.Image,
        Email: user.Email,
        FirstName: user.FirstName,
        LastName: user.LastName,
        MiddleName: user.MiddleName,
        MobileNo: user.MobileNo,
        Nationality: user.Nationality,
        Gender: user.Gender,
        DateOfBirth: user.DateOfBirth,
        UserLevel: user.UserLevel,
        RiskProfile: user.RiskProfile,
        Tier: user.Tier,
        MasterInvestorCode: user.MasterInvestorCode,
        DateCreated: user.DateCreated,

        //tier 2

        Address: user.Address,
        TypeOfID: user.TypeOfID,
        IDNumber: user.IDNumber,
        ExpirationOfID: user.ExpirationOfID,
        SourceOfIncome: user.SourceOfIncome,
        NatureOfWork: user.NatureOfWork,
        NameOfEmployer: user.NameOfEmployer,
        OfficeAddress: user.OfficeAddress,
      },
    });
  },
};

const UpdateProfileOperation = {
  request_mapper: (req) => {
    return {
      user: req.middleware_auth,
      ...req.body,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(
        of(props),
        user.UPDATE({
          identifier: {
            _id: props.user._id,
          },
          data: {
            Email: props.email,
            UserRole: props.role,
          },
        })
      );
    }),
    mergeMap(([props]) => {
      return zip(user.GET_ONE({ _id: props.user._id }));
    })
  ),
  response_mapper:
    (_req, res) =>
    ([user]) => {
      res.status(200).json({
        message: "Profile successfully uploaded!",
        data: {
          AccountNo: user.AccountNo,
          Image: user.Image,
          Email: user.Email,
          FirstName: user.FirstName,
          LastName: user.LastName,
          MiddleName: user.MiddleName,
          MobileNo: user.MobileNo,
          Nationality: user.Nationality,
          Gender: user.Gender,
          DateOfBirth: user.DateOfBirth,
          UserLevel: user.UserLevel,
          RiskProfile: user.RiskProfile,
          Tier: user.Tier,
          MasterInvestorCode: user.MasterInvestorCode,
          DateCreated: user.DateCreated,

          //tier 2

          Address: user.Address,
          TypeOfID: user.TypeOfID,
          IDNumber: user.IDNumber,
          ExpirationOfID: user.ExpirationOfID,
          SourceOfIncome: user.SourceOfIncome,
          NatureOfWork: user.NatureOfWork,
          NameOfEmployer: user.NameOfEmployer,
          OfficeAddress: user.OfficeAddress,
        },
      });
    },
};

//Get the fund fund provider
const getFundFmProviderOperation = {
  request_mapper: (req) => {
    return req.query.fmprovider;
  },
  processor: pipe(
    //validate
    mergeMap((props) => {
      return zip(of(props));
    }),
    //process
    mergeMap(([props]) => {
      return zip(of(props), Funds.GET({}));
    }),
    //compute
    mergeMap(([props, funds]) => {
      let data = [];
      for (let a = 0; a < funds.length; a++) {
        for (let b = 0; b < funds[a].managers.length; b++) {
          if (String(funds[a].managers[b]) == props) {
            data.push(funds[a]);
          }
        }
      }
      return zip(of(data));
    })
  ),
  response_mapper:
    (_req, res) =>
    ([funds]) => {
      res.send(funds);
    },
};

const GetClientsCount = {
  processor: pipe(
    mergeMap((props) => {
      return user.GET_COUNT({ bankId: { $ne: null } });
    })
  ),
  response_mapper: (_req, res) => (count) => {
    res.status(200).json({
      message: "Total clients count",
      count: count,
    });
  },
};
const GetProfileOperation = {
  request_mapper: (req) => {
    return {
      user: req.middleware_auth,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(user.GET_ONE({ _id: props.user._id }));
    })
  ),
  response_mapper:
    (_req, res) =>
    ([user]) => {
      console.log("user", user);
      res.status(200).json({
        data: {
          AccountNo: user.AccountNo,
          Image: user.Image,
          Email: user.Email,
          FirstName: user.FirstName,
          LastName: user.LastName,
          MiddleName: user.MiddleName,
          MobileNo: user.MobileNo,
          Nationality: user.Nationality,
          Gender: user.Gender,
          DateOfBirth: user.DateOfBirth,
          UserLevel: user.UserLevel,
          RiskProfile: user.RiskProfile,
          Tier: user.Tier,
          MasterInvestorCode: user.MasterInvestorCode,
          DateCreated: user.DateCreated,

          //tier 2

          Address: user.Address,
          TypeOfID: user.TypeOfID,
          IDNumber: user.IDNumber,
          ExpirationOfID: user.ExpirationOfID,
          SourceOfIncome: user.SourceOfIncome,
          NatureOfWork: user.NatureOfWork,
          NameOfEmployer: user.NameOfEmployer,
          OfficeAddress: user.OfficeAddress,
        },
      });
    },
};

const GetAllUserOperation = {
  request_mapper: (req) => {
    return {
      user: req.middleware_auth,
      month: req.query.month,
      year: req.query.year,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      if (props.user.UserLevel < 4) {
        let match = {
          TransactionID: {
            $ne: null,
          },
          Type: 1,
        };
        if (props.month && props.year) {
          match["$and"] = [
            {
              $expr: {
                $eq: [{ $month: "$Date" }, parseInt(props.month)],
              },
            },
            {
              $expr: {
                $eq: [{ $year: "$Date" }, parseInt(props.year)],
              },
            },
          ];
        }
        console.log("props: ", props);
        console.log("match: ", match);
        return zip(
          transactions.AGGREGATE([
            {
              $sort: {
                Date: -1,
              },
            },
            {
              $match: match,
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
              $unwind: "$user",
            },
            {
              $lookup: {
                from: "funds",
                localField: "fk_Fund",
                foreignField: "_id",
                as: "funds",
              },
            },
            {
              $unwind: "$funds",
            },
            {
              $group: {
                _id: "$fk_User",
                data: { $first: "$$ROOT" },
                sum: {
                  $sum: {
                    $toInt: "$Amount",
                  },
                },
              },
            },
            {
              $replaceRoot: {
                newRoot: { $mergeObjects: ["$data", { totalAmount: "$sum" }] },
              },
            },
          ])
        );
      } else {
        //throw error
      }
    })
  ),
  response_mapper:
    (_req, res) =>
    ([result]) => {
      res.status(200).json({
        result,
      });
    },
};

const GetUserPortfolioOperation = {
  request_mapper: (req) => {
    return {
      user: req.middleware_auth,
      selectedUser: req.query.user,
      month: req.query.month,
      year: req.query.year,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(of(props), user.GET_ONE({ _id: props.selectedUser }));
    }),
    mergeMap(([props, selectedUser]) => {
      if (!selectedUser) {
        //throw error
      }
      return zip(
        of(props),
        of(selectedUser),
        getAccessToken(),
        transactionDB.GET({
          fk_User: selectedUser._id,
          Type: 1,
        }),
        transactionDB.GET({
          fk_User: selectedUser._id,
          Type: 2,
        })
      );
    }),
    mergeMap(([props, user, token, subscription, redemption]) => {
      let currentYear = new Date().getFullYear();
      let valueArray = [];
      let valueMinusArray = [];
      let dateArray = [];
      const mapComputation = (date) => {
        const startOfDate = moment(date).startOf("month");
        const endOfDate = moment(date).endOf("month");

        let redemptionTotal = 0;
        let subscriptionTotal = 0;
        let subscriptionMinusTotal = 0;
        //redemption
        for (let a = 0; a < redemption.length; a++) {
          if (
            moment(redemption[a].processing_dt).isBefore(endOfDate) &&
            moment(redemption[a].processing_dt).isAfter(startOfDate)
          ) {
            redemptionTotal += parseInt(redemption[a].Amount);
          }
        }

        //subscription
        for (let a = 0; a < subscription.length; a++) {
          // console.log("subscription: ", subscription[a]);
          if (
            moment(subscription[a].Date).isBefore(endOfDate) &&
            moment(subscription[a].Date).isAfter(startOfDate)
          ) {
            subscriptionTotal += parseInt(subscription[a].Amount);
            subscriptionMinusTotal += parseInt(subscription[a].Amount) - 20;
          }
        }
        valueArray.push(subscriptionTotal - redemptionTotal - 20);
        valueMinusArray.push(subscriptionMinusTotal);
        dateArray.push(moment(date).format("MMM - YYYY"));
      };

      for (let a = 0; a < 12; a++) {
        let date = moment(String(currentYear + "0101"), "YYYY/MM/DD");
        mapComputation(date.add(a, "months"));
      }

      return zip(
        of(props),
        of({
          valueArray,
          valueMinusArray,
          dateArray,
        }),
        getPortfolioData(
          token.access_token,
          user.MasterInvestorCode,
          user.FundCountID,
          props.month,
          props.year
        )
      );
    }),
    mergeMap(([props, subRedData, data]) => {
      return zip(
        of({
          subscriptionRedemptionData: subRedData,
          portfolio: data && data.result ? data.result : [],
          date: {
            month: props.month,
            year: props.year,
          },
        })
      );
    })
  ),
  response_mapper:
    (_req, res) =>
    ([result]) => {
      res.status(200).json({
        result,
      });
    },
};
const GetAdminUsersOperation = {
  request_mapper: (req) => {
    return {
      user: req.middleware_auth,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      if (props.user.UserLevel === 1) {
        return zip(
          user.GET({
            UserLevel: {
              $in: [1, 2, 3],
            },
          })
        );
      } else if (props.user.UserLevel === 1) {
        return zip(user.GET({ UserLevel: props.user.UserLevel }));
      } else if (props.user.UserLevel === 1) {
        return zip(user.GET({ UserLevel: props.user.UserLevel }));
      } else {
        return throwError(new Error("User is not valid here!"));
      }
    })
  ),
  response_mapper:
    (_req, res) =>
    ([user]) => {
      res.status(200).json({
        admins: user,
      });
    },
};

const GetUserTransacHistoryOperation = {
  request_mapper: (req) => {
    return req.query;
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(of(props), getAccessToken());
    }),
    mergeMap(([props, token]) => {
      return zip(
        // transactions.GET({
        //   fk_User: props.fk_user
        // })
        transactions.AGGREGATE([
          {
            $match: { fk_User: mongoose.Types.ObjectId(props.fk_user) },
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
            $project: {
              TransactionID: 1,
              oldTransactionID: 1,
              RefNo: 1,
              fk_User: 1,
              fk_Fund: 1,
              Amount: 1,
              Fee: 1,
              Status: 1,
              Date: 1,
              Type: 1,
              PaymentMethod: 1,
              Description: 1,
              RedemptionData: 1,
              SubscriptionData: 1,
              // nav: { $arrayElemAt: ["$nav", 0] },
              fund: { $arrayElemAt: ["$fund", 0] },
              nav: 1,
            },
          },
        ]),
        geAUMData_(
          token.access_token,
          moment().subtract(1, "day").format("YYYYMMDD")
        )
      );
    }),
    mergeMap(([data, aum]) => {
      const res = of(data).pipe(
        mergeMap(async (transactions) => {
          const temp = [];
          for (let transaction of transactions) {
            const nav = await NavCollection_v2.GET_ONE({
              fk_Fund: transaction.fk_Fund,
              Date: formatDatev2(new Date(transaction.Date)),
            });

            const nav_yesterday = await NavCollection_v2.GET_ONE({
              fk_Fund: transaction.fk_Fund,
              Date: formatDatev2(new Date(moment().subtract(1, "day"))),
            });
            const with_nav = {
              ...transaction,
              nav,
              nav_yesterday,
            };
            temp.push(with_nav);
          }
          return temp;
        })
      );
      return zip(res, of(aum));
    })
  ),
  response_mapper:
    (req, res) =>
    ([data_1, aum = { result: [] }]) => {
      console.log("aum => ", aum);
      let data = _.orderBy(data_1, (obj) => moment(obj.Date), "asc");
      let temp = [];
      for (let i = 0; i < data.length; i++) {
        let transaction = data[i];
        const fund_aum = _.find(
          aum.result,
          (obj) => obj.fund_identifier === transaction.fund.FundIdentifier
        );

        transaction.fund_aum = fund_aum || 0;

        const t_units = parseFloat(
          parseFloat(transaction.Amount) /
            parseFloat(transaction.nav.NavPerShare)
        );

        transaction.units = t_units;
        let last_running_u_b = 0;
        if (temp.length > 0) {
          last_running_u_b = _.filter(temp, ["fk_Fund", transaction.fk_Fund]);
          last_running_u_b = _.orderBy(
            last_running_u_b,
            (obj) => moment(obj.Date),
            "desc"
          )[0];

          if (
            typeof last_running_u_b !== "undefined" &&
            typeof last_running_u_b.runningUnitbalance !== "undefined"
          ) {
            last_running_u_b = last_running_u_b.runningUnitbalance;
          } else {
            last_running_u_b = 0;
          }
        }
        if (transaction.Type === 1) {
          transaction.runningUnitbalance =
            parseFloat(last_running_u_b) + parseFloat(t_units);
        }
        if (transaction.Type === 2) {
          transaction.runningUnitbalance =
            parseFloat(last_running_u_b) - parseFloat(t_units);
        }

        temp.push(transaction);
      }
      temp = _.orderBy(temp, (obj) => moment(obj.Date), "desc");
      res.send(temp);
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

const GetInvestedFundsPerUser = {
  request_mapper: (req) => {
    return req.query;
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(
        transactions.GET({
          fk_User: props.fk_user,
        }),
        Funds.GET({})
      );
    }),

    mergeMap(([transactions, funds]) => {
      let fundsInvested = [];

      const fkTransac = [
        ...new Set(transactions.map((item) => String(item.fk_Fund))),
      ];
      for (let a = 0; a < funds.length; a++) {
        for (let b = 0; b < fkTransac.length; b++) {
          if (String(funds[a]._id) == fkTransac[b]) {
            fundsInvested.push(funds[a]);
          }
        }
      }

      return zip(of(fundsInvested));
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

const GetUserLogsOperation = {
  request_mapper: (req) => {
    return {
      ...req.query,
      user: req.middleware_auth,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      console.log("props: ", props);
      let start = new Date(props.fromDate);
      start.setHours(0, 0, 0, 0);

      let end = new Date(props.toDate);
      end.setHours(23, 59, 59, 999);
      let qry = [
        {
          $sort: {
            Date: -1,
          },
        },
        {
          $match: {
            ...(props.fromDate &&
              props.toDate && {
                Date: { $gte: start, $lte: end },
              }),
            ...(props.key && {
              $or: [
                {
                  Type: {
                    $regex: new RegExp(props.key, "i"),
                  },
                },
                {
                  Label: {
                    $regex: new RegExp(props.key, "i"),
                  },
                },
              ],
            }),
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
          $unwind: "$user",
        },
      ];
      console.log("qry: ", JSON.stringify(qry));
      return zip(of(props), logs_collection.AGGREGATE(qry));
    }),

    mergeMap(([props, logs]) => {
      if (props.user.UserLevel === 1) {
        return zip(of(logs));
      }
      return zip(
        of(
          logs.filter((item) => {
            return (
              item.fk_User.toString() === props.user._id.toString() ||
              item.user.FmProvider === props.user.Email
            );
          })
        )
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

const GetUserAccountSummaryOperation = {
  request_mapper: (req) => {
    return {
      param: req.query,
      user: req.middleware_auth,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      return zip(of(props.param), of(props.user), Funds.GET({}));
    }),
    mergeMap(([props, active_user, funds]) => {
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

      return zip(of(props), of(funds));
    }),
    mergeMap(([props, funds]) => {
      const fundsUnique = [...new Set(funds.map((item) => item._id))];
      console.log("fundsUnique: ", fundsUnique);

      let start = new Date();
      start.setHours(0, 0, 0, 0);

      let end = new Date();
      end.setHours(23, 59, 59, 999);

      return zip(
        transactionDB.AGGREGATE([
          {
            $match: {
              Date: { $gte: start, $lt: end },
              Type: 1,
              fk_Fund: { $in: fundsUnique },
            },
          },
          {
            $group: { _id: null, sum: { $sum: "$Amount" } },
          },
        ]),
        transactionDB.AGGREGATE([
          {
            $match: {
              Type: 1,
              fk_Fund: { $in: fundsUnique },
            },
          },
          {
            $group: { _id: null, sum: { $sum: "$Amount" } },
          },
        ]),
        user.GET_COUNT({
          bankId: { $ne: null },
        }),
        transactionDB.AGGREGATE([
          {
            $match: {
              Type: 1,
              fk_Fund: { $in: fundsUnique },
            },
          },
        ])
      );
    }),

    mergeMap(
      ([
        netSubscriptionOfTheDay,
        allSubscription,
        totalUserCount,
        transaction,
      ]) => {
        let fkusers = [];
        for (let a = 0; a < transaction.length; a++) {
          fkusers.push(String(transaction[a].fk_User));
        }

        let retVal = {
          netSubscriptionOfTheDay:
            netSubscriptionOfTheDay &&
            netSubscriptionOfTheDay[0] &&
            netSubscriptionOfTheDay[0].sum
              ? netSubscriptionOfTheDay[0].sum
              : 0,
          avgInvestmentPerClient:
            allSubscription && allSubscription[0] && allSubscription[0].sum
              ? parseFloat(allSubscription[0].sum / totalUserCount).toFixed(2)
              : 0,
          totalClients: [...new Set(fkusers)].length,
        };
        return zip(of(retVal));
      }
    )
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

const GetTotalAumOperation = {
  request_mapper: (req) => {
    return {
      ...req.query,
      user: req.middleware_auth,
    };
  },
  processor: pipe(
    mergeMap((props) => {
      console.log("props: ", props);
      let start = new Date();
      start.setHours(0, 0, 0, 0);

      let end = new Date();
      end.setHours(23, 59, 59, 999);
      return zip(
        transactionDB.AGGREGATE([
          {
            $match: {
              Date: { $gte: start, $lt: end },
              Type: 1,
            },
          },
          {
            $group: { _id: null, sum: { $sum: "$Amount" } },
          },
        ]),
        transactionDB.AGGREGATE([
          {
            $match: {
              Type: 1,
            },
          },
          {
            $group: { _id: null, sum: { $sum: "$Amount" } },
          },
        ]),
        user.GET_COUNT({
          bankId: { $ne: null },
        })
      );
    }),

    mergeMap(([netSubscriptionOfTheDay, allSubscription, totalUserCount]) => {
      let retVal = {
        netSubscriptionOfTheDay:
          netSubscriptionOfTheDay &&
          netSubscriptionOfTheDay[0] &&
          netSubscriptionOfTheDay[0].sum
            ? netSubscriptionOfTheDay[0].sum
            : 0,
        avgInvestmentPerClient:
          allSubscription && allSubscription[0] && allSubscription[0].sum
            ? parseFloat(allSubscription[0].sum / totalUserCount).toFixed(2)
            : 0,
        totalClients: totalUserCount,
      };
      return zip(of(retVal));
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

export const loginController = createController(LoginOperation);
export const loginAdminController = createController(Login_AdminOperation);
export const registerController = createController(RegisterOperation);
export const registerAdminController = createController(RegisterAdminOperation);
export const changePasswordController = createController(
  ChangePasswordOperation
);
export const ResetPasswordController = createController(ResetPasswordOperation);
export const deleteAccountController = createController(DeleteAccountOperation);
export const getOTPController = createController(GetOTPOperation);
export const GetAccounts_Admin_Controller = createController(
  GetAccounts_AdminOperation
);
export const GetAccounts_Investor_Controller = createController(
  GetAccounts_InvestorOperation
);
export const GetUserDetailsController = createController(
  GetUserDetailsOperation
);
export const UpdateUserController = createController(UpdateUserOperation);
export const GetTransactionsController = createController(
  GetTransactionsOperation
);
export const GetUserFundsController = createController(GetUserFundsOperation);
export const GetTransactionsInvestmentController = createController(
  GetTransactionsInvestmentOperation
);
export const UploadProfileImageController = createController(
  UploadProfileImageOperation
);
export const ActivateUserController = createController(ActivateUserOperation);

export const GetAdminUsersController = createController(GetAdminUsersOperation);
export const GetUserProfileController = createController(GetProfileOperation);
export const UpdateUserProfileController = createController(
  UpdateProfileOperation
);
export const GetFundFmProviderController = createController(
  getFundFmProviderOperation
);

export const GetClientsCountController = createController(GetClientsCount);
export const GetAllUserController = createController(GetAllUserOperation);
export const GetUserPortfolioController = createController(
  GetUserPortfolioOperation
);

export const GetUserTransactionHistory = createController(
  GetUserTransacHistoryOperation
);
export const GetInvestedFundsController = createController(
  GetInvestedFundsPerUser
);

export const GetUserLogsController = createController(GetUserLogsOperation);
export const GetUserAccountSummaryController = createController(
  GetUserAccountSummaryOperation
);
export const GetTotalAumController = createController(GetTotalAumOperation);
