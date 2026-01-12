const functions = require("@google-cloud/functions-framework");
const { authenticate } = require("./authentication");
const pillData = require("./pill_data.json");

const PAGE_LIMIT = 1000;

/**
 * pill_data 테이블 원천 데이터 반환
 * @param {Request} req
 * @returns
 */
function getPillDataResource(req) {
  const { page } = req.query;

  if (!resources) {
    return { success: false, message: "Invalid Resource Data" };
  }

  const total = resource.length;
  const totalPage = Math.ceil(Number(total) / Number(PAGE_LIMIT));
  const current = (Number(page) - 1) * Number(PAGE_LIMIT);

  const { resources } = pillData;

  const resource = resources.slice(
    Number(current),
    Number(current) + Number(limit)
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
