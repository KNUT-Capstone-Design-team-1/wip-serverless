const functions = require("@google-cloud/functions-framework");
const express = require("express");
const { authenticate } = require("./authentication");
const { createJsonResponse, sendJsonResponse } = require("./response");

// Serialize once per instance; compressed variants are generated lazily and reused.
const schemas = new Map([
  "pill_data", "mark_images", "nearby_pharmacies", "cannabis", "narcotics",
  "psychotropics", "prohibited_list", "functional_food_nutrients",
  "functional_food_classification", "health_functional_food_raw_material",
].map((table) => [table, createJsonResponse({ columns: require("./schemas/" + table + ".json").columns })]));

const app = express();

app.get("/", async (req, res, next) => {
  if (!authenticate(req)) return res.sendStatus(401);
  const response = schemas.get(req.query.table);
  if (!response) return res.status(500).send("Invalid Table Name");
  try {
    await sendJsonResponse(req, res, response);
  } catch (error) {
    next(error);
  }
});

functions.http("wip-table-schema", app);
