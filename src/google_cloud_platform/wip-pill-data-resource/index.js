const functions = require("@google-cloud/functions-framework");
const { authenticate } = require("./authentication");
const pillData = require("./pill_data.json");

const PAGE_LIMIT = 5000;

/**
 * pill_data 테이블 원천 데이터 반환
 * @param {Request} req
 * @returns
 */
function getPillDataResource(req) {
  const { page } = req.query;

  if (!pillData?.resources) {
    return { success: false, message: "Invalid Resource Data" };
  }

  const { resources } = pillData;
  
  const total = resources.length;
  const totalPage = Math.ceil(Number(total) / Number(PAGE_LIMIT));
  const current = (Number(page) - 1) * Number(PAGE_LIMIT);

  const resource = resources.slice(
    Number(current),
    Number(current) + Number(PAGE_LIMIT)
  );

  return { success: true, data: { resource, total, totalPage, current } };
}

functions.http("pill-data-resource", (req, res) => {
  switch (req.method) {
    case "GET": {
      if (!authenticate(req)) {
        res.sendStatus(401);
        return;
      }

      if (!req.query.page) {
        res.status(402).send(`Page not received`);
      }

      const result = getPillDataResource(req);

      if (!result.success) {
        res.status(500).send(result.message);
        return;
      }

      res.status(200).json(result.data);
      break;
    }
  }
});
