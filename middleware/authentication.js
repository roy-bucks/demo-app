import { tokenKey } from "../config";
import { config } from "../config/fc_config";
import { BanksModel } from "../models/banks.schema";
import { UserModel } from "../models/user.schema";

const jwt = require("jsonwebtoken");

export const verifyToken = (req, res, next) => {
  const bearerHeader = req.headers["authorization"];


  
  if (typeof bearerHeader !== "undefined") {
    const token = bearerHeader.split(" ")[1];
    const decodeData = jwt.decode(token, tokenKey);
    try {
      if (Date.now() >= decodeData.exp * 1000) {
        console.log("Token expired");
        res.sendStatus(403);
      } else {
        const user = decodeData._doc;
        // console.log("user: ", user);

        UserModel.findById(user._id)
          .then((res) => {
            req.middleware_auth = res;

            if (res.Active === true) {
              next();
            } else {
              res.sendStatus(503);
            }
          })
          .catch((err) => {
            console.log(err);
            res.sendStatus(403);
          });
      }
    } catch (err) {
      console.log("authentication err: ", err);
      res.sendStatus(403);
    }
  } else {
    console.log("Error Exist");
    res.sendStatus(403);
  }
};

export const verifyBankToken = (req, res, next) => {
  const bearerHeader = req.headers["authorization"];

  if (typeof bearerHeader !== "undefined") {
    const token = bearerHeader.split(" ")[1];
    const decodeData = jwt.decode(token, tokenKey);
    try {
      if (Date.now() >= decodeData.exp * 1000) {
        res.sendStatus(403);
      } else {
        const user = decodeData._doc;
        console.log("user: ", user);
        BanksModel.findById(user._id)
          .then((res) => {
            console.log("res: ", res);
            req.middleware_auth = res;
            if (res.Active === true) {
              console.log("passed");
              next();
            } else res.sendStatus(503);
          })
          .catch((err) => {
            res.sendStatus(403);
          });
      }
    } catch (err) {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(403);
  }
};

export const verifyBankTokenForRefresh = (req, res, next) => {
  const bearerHeader = req.headers["authorization"];
  if (typeof bearerHeader !== "undefined") {
    const token = bearerHeader.split(" ")[1];
    const decodeData = jwt.decode(token, tokenKey);
    try {
      const user = decodeData._doc;
      BanksModel.findById(user._id)
        .then((res) => {
          req.user = res;
          if (res.Active === true) next();
          else res.sendStatus(503);
        })
        .catch((err) => {
          res.sendStatus(403);
        });
    } catch (err) {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(403);
  }
};

export const verifyBankUserToken = (req, res, next) => {
  const bearerHeader = req.headers["authorization"];
  if (typeof bearerHeader !== "undefined") {
    const token = bearerHeader.split(" ")[1];
    const decodeData = jwt.decode(token, tokenKey);
    try {
      if (Date.now() >= decodeData.exp * 1000) {
        console.log("token expired");
        res.sendStatus(403);
      } else {
        const user = decodeData._doc;

        console.log(user);

        UserModel.findById(user._id)
          .then((res) => {
            req.middleware_auth = res;
            if (res.Active === true) {
              console.log("Cleared");
              next();
            } else {
              res.sendStatus(503);
            }
          })
          .catch((err) => {
            console.log("Cannot find the user");
            res.sendStatus(403);
          });
      }
    } catch (err) {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(403);
  }
};

export const verifyBankWithUserToken = (req, res, next) => {
  const bearerHeader = req.headers["authorization"];
  const userAuthHeader = req.headers["user-authorization"];

  console.log("I am here");

  console.log("user: ", userAuthHeader);

  if (typeof bearerHeader !== "undefined") {
    const bankToken =
      bearerHeader.split(" ").length > 1
        ? bearerHeader.split(" ")[1]
        : bearerHeader.split(" ")[0];
    const userToken =
      userAuthHeader.split(" ").length > 1
        ? userAuthHeader.split(" ")[1]
        : userAuthHeader.split(" ")[0];
    const decodeBankData = jwt.decode(bankToken, tokenKey);
    const decodeUserData = jwt.decode(userToken, tokenKey);
    try {
      if (Date.now() >= decodeBankData.exp * 1000) {
        res.sendStatus(403);
      } else if (Date.now() >= decodeUserData.exp * 1000) {
        res.sendStatus(403);
      } else {
        const bank = decodeBankData._doc;
        const user = decodeUserData._doc;

        console.log("bank: ", bank);
        console.log("user: ", user);

        //change the id from bank._id to bank.bankId
        BanksModel.findById(bank._id)
          .then((result) => {
            if (result.Active === true) {
              req.bank = result;
              UserModel.findById(user._id)
                .then((result) => {
                  req.bankUser = result;
                  req.verificationSignature = req.headers["request-signature"];
                  req.middleware_auth = user;

                  if (
                    result.Active === true &&
                    result.bankId.toString() === req.bank._id.toString()
                  ) {
                    return next();
                  } else {
                    return res.sendStatus(503);
                  }
                })
                .catch((err) => {
                  console.log("Cannot find the user");
                  res.sendStatus(403);
                });
            } else {
              res.sendStatus(503);
            }
          })
          .catch((err) => {
            console.log("error ", err);
            res.sendStatus(403);
          });
      }
    } catch (err) {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(403);
  }
};

export const verifyApiKey = (req, res, next) => {
  const bearerHeader = req.headers["authorization"];
  if (typeof bearerHeader !== "undefined") {
    const key = bearerHeader.split(" ")[1];
    try {
      if (key !== config.BXB_API_KEY) {
        res.sendStatus(403);
      } else {
        next();
      }
    } catch (err) {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(403);
  }
};
