const functions = require("@google-cloud/functions-framework");
const compression = require("compression");
const express = require("express");
const { authenticate } = require("./authentication");

const app = express();

app.use(
  compression({
    threshold: 1024, // 1KB 이상만 압축
  }),
);

/**
 * 로그를 증적
 * @param {Request} req
 */
async function writeLog(req) {
  const { logLevel, logContents } = req.body;

  console.log(`==========Log Level: ${logLevel} : ${logContents}==========`);
}

app.post("/", async (req, res) => {
  if (!authenticate(req)) {
    res.sendStatus(401);
    return;
  }

  res.sendStatus(201); // 오류 상황에서 빠른 응답을 위해 응답 후 로그 증적

  writeLog(req).catch((e) =>
    console.log(`Failed to write log. %s`, e?.stack || e),
  );
});

functions.http("wip-log", app);
