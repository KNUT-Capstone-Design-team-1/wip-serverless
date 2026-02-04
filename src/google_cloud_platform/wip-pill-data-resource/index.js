const functions = require("@google-cloud/functions-framework");
const compression = require("compression");
const express = require("express");

const { authenticate } = require("./authentication");
const pillData = require("./pill_data.json");

const PAGE_LIMIT = 5000;

const app = express();

app.use(
  compression({
    threshold: 1024, // 1KB 이상만 압축
  }),
);

/**
 * pill_data 테이블 원천 데이터 반환
 */
function getPillDataResource(req) {
  const { page } = req.query;

  if (!pillData?.resources) {
    return { success: false, message: "Invalid Resource Data" };
  }

  const { resources } = pillData;

  const total = resources.length;
  const totalPage = Math.ceil(total / PAGE_LIMIT);
  const current = (Number(page) - 1) * PAGE_LIMIT;

  const resource = resources.slice(current, current + PAGE_LIMIT);

  return { success: true, data: { resource, total, totalPage, current } };
}

app.get("/", (req, res) => {
  if (!authenticate(req)) {
    res.sendStatus(401);
    return;
  }

  if (!req.query.page) {
    res.status(400).send("Page not received");
    return;
  }

  const result = getPillDataResource(req);

  if (!result.success) {
    res.status(500).send(result.message);
    return;
  }

  res.status(200).json(result.data);
});

functions.http("wip-pill-data-resource", app);
