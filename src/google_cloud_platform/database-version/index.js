const functions = require('@google-cloud/functions-framework');
const { authenticate } = require("./authentication");
const config = require("./config.json");

/**
 * 데이터베이스 버전을 조회
 * @returns 
 */
function getDatabaseVersion() {
  const { schemaVersion, dataVersion } = config;

  if (typeof schemaVersion !== 'number' || typeof dataVersion !== 'number') {
    return { success: false, message: 'Invalid Config File' };
  }

  return { success: true, schemaVersion, dataVersion };
}

functions.http('database-version', (req, res) => {
  switch (req.method) {
    case "GET": {
      if (!authenticate(req)) {
        res.sendStatus(401);
        return;
      }

      res.status(200).json(getDatabaseVersion(req));
      break;
    }
  }
});
