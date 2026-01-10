const functions = require('@google-cloud/functions-framework');
const { authenticate } = require("./authentication");
const schema = require("./schema.json");

/**
 * pill_data 테이블의 스키마를 반환
 * @returns 
 */
function getPillDataTableSchema() {
  const { columns } = schema;

  if (!columns?.length) {
    return { success: false, message: 'Invalid Schema File' };
  }

  return { success: true, columns };
}

functions.http('pill-data-table-schema', (req, res) => {
  switch (req.method) {
    case "GET": {
      if (!authenticate(req)) {
        res.sendStatus(401);
        return;
      }

      const result = getPillDataTableSchema(req);

      if (!result.success) {
        res.status(500).send(result.message);
        return;
      }

      res.status(200).json(result);
      break;
    }
  }
});
