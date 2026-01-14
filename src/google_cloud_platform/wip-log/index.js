const functions = require("@google-cloud/functions-framework");
const { authenticate } = require("./authentication");

/**
 * 로그를 증적
 * @param {Request} req
 */
async function writeLog(req) {
  const { logLevel, logContents } = req.body;

  console.log(`==========Log Level: ${logLevel} : ${logContents}==========`);
}

functions.http("wip-log", (req, res) => {
  switch (req.method) {
    case "POST": {
      if (!authenticate(req)) {
        res.sendStatus(401);
        return;
      }

      res.sendStatus(201); // 오류 상황에서 빠른 응답을 위해 응답 후 로그 증적

      writeLog(req).catch((e) =>
        console.log(`Failed to write log. %s`, e?.stack || e)
      );

      break;
    }
  }
});
