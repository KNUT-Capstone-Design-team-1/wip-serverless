const functions = require("@google-cloud/functions-framework");
const compression = require("compression");
const express = require("express");
const { authenticate } = require("./authentication");
const pillDataSchema = require("./schemas/pill_data.json");
const markImagesSchema = require("./schemas/mark_images.json");
const nearbyPharmaciesSchema = require("./schemas/nearby_pharmacies.json");

const app = express();

app.use(
  compression({
    threshold: 1024, // 1KB 이상만 압축
  }),
);

/**
 * 테이블의 스키마를 반환
 * @param table 테이블 이름
 * @returns
 */
function getPillDataTableSchema(table) {
  switch (table) {
    case "pill_data":
      return { success: true, columns: pillDataSchema.columns };

    case "mark_images":
      return { success: true, columns: markImagesSchema.columns };

    case "nearby_pharmacies":
      return { success: true, columns: nearbyPharmaciesSchema.columns };

    default:
      return { success: false, message: "Invalid Table Name" };
  }
}

app.get("/", (req, res) => {
  if (!authenticate(req)) {
    res.sendStatus(401);
    return;
  }

  const result = getPillDataTableSchema(req.query.table);

  if (!result.success) {
    res.status(500).send(result.message);
    return;
  }

  res.status(200).json(result.columns);
});

functions.http("wip-table-schema", app);
