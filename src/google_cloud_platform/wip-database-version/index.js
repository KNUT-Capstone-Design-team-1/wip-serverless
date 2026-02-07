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

/**
 * 데이터베이스 버전을 조회
 * @returns
 */
function getDatabaseVersion() {
  if (!config?.pillData) {
    return { success: false, message: "Invalid Config File" };
  }

  return { success: true, data: config };
}

app.get("/", (req, res) => {
  if (!authenticate(req)) {
    res.sendStatus(401);
    return;
  }

  const result = getDatabaseVersion();

  if (!result.success) {
    res.status(500).send(result.message);
    return;
  }

  res.status(200).json(result.data);
});

functions.http("wip-database-version", app);
