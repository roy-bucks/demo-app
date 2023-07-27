import bodyParser from "body-parser";
import chalk from "chalk";
import busboy from "connect-busboy";
import cors from "cors";
import express from "express";
import mongoose from "mongoose";
import { dbURL, port } from "./config";

require("dotenv").config();

const app = express();

app.use(
  bodyParser.urlencoded({
    extended: true,
    limit: "10mb",
  })
);
app.use(
  bodyParser.json({
    limit: "10mb",
  })
);

// app.use(formidable())

app.use(busboy());
app.use(cors());

const passport = require("passport");
require("./config/passport_config");
app.use(passport.initialize());
app.use(passport.session());
// app.use(express.static(__dirname + '/public'));
const routes = require("./routes/index");
routes(app);

mongoose
  .connect(dbURL, {
    useNewUrlParser: true,
    autoReconnect: true,
    reconnectTries: Number.MAX_VALUE,
    reconnectInterval: 500,
  })
  .then(() => {
    console.clear();
    console.log("Successfully connected to the database");

    // app.all("*", (_req, res) => {
    //   try {
    //     res.sendFile(__dirname + '/public/index.html');
    //   } catch (error) {
    //     res.json({ success: false, message: "Something went wrong" });
    //   }
    // });
    app.listen(port, () =>
      console.log(chalk.bgBlueBright(`Example app listening on port ${port}!`))
    );
  })
  .catch((err) => {
    console.log(err);
    console.log(
      "Could not connect to the database. Will attempt to reconnect later..."
    );
  });

require("./utilities/scheduled");


