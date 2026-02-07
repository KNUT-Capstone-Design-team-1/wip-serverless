const functions = require("@google-cloud/functions-framework");
const compression = require("compression");
const express = require("express");
const { authenticate } = require("./authentication");
const config = require("./config.json");

const app = express();

app.use(
  compression({
    threshold: 1024, // 1KB 이상만 압축
  }),
);

app.get("/", (req, res) => {
  if (!authenticate(req)) {
    res.sendStatus(401);
    return;
  }

  res.status(200).json(config);
});

functions.http("wip-database-version", app);
