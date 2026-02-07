const functions = require("@google-cloud/functions-framework");
const compression = require("compression");
const express = require("express");
const { authenticate } = require("./authentication");
const pillData = require("./resources/pill_data.json");
const markImages = require("./resources/mark_images.json");
const nearbyPharmacies = require("./resources/nearby_pharmacies.json");

const PAGE_LIMIT = 5000;

const app = express();

app.use(
  compression({
    threshold: 1024, // 1KB 이상만 압축
  }),
);

/**
 * 테이블 별 원천 데이터 반환
 * @param {String} table 
 * @returns 
 */
function getResourcesByTable(table) {
  switch (table) {
    case "pill_data":
      return { success: true, resources: pillData };

    case "mark_images":
      return { success: true, resources: markImages };

    case "nearby_pharmacies":
      return { success: true, resources: nearbyPharmacies };

    default:
      return { success: false, message: "Invalid Table Name" };
  }
}

/**
 * 원천 데이터를 페이징하여 반환
 * @param {String} 테이블 이름
 * @returns {Number} 페이지
 */
function getResources(table, page) {
  const tableResourceGetResult = getResourcesByTable(table);

  if (!tableResourceGetResult.success) {
    return tableResourceGetResult;
  }

  const { resources } = tableResourceGetResult;

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

  const { table, page } = req.query;

  const result = getResources(table, page);

  if (!result.success) {
    res.status(500).send(result.message);
    return;
  }

  res.status(200).json(result.data);
});

functions.http("wip-resource-data", app);
