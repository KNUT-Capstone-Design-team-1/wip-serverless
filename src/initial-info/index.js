const functions = require("@google-cloud/functions-framework");
const config = require("./config.json");
const { authenticate } = require("./authentication");

/**
 * 초기화 정보 조회
 * @param {Request} req
 * @returns
 */
function getInitInfo(req) {
  return authenticate(req) ? config : null;
}

functions.http("initInfo", (req, res) => {
  switch (req.method) {
    case "GET": {
      const initialInfo = getInitInfo(req);

      if (!initialInfo) {
        res.sendStatus(401);
        return;
      }

      res.status(200).json(initialInfo);
      break;
    }

    default:
      res.sendStatus(405);
  }
});
