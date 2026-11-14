const functions = require("@google-cloud/functions-framework");
const express = require("express");
const { Storage } = require("@google-cloud/storage");
const { authenticate } = require("./authentication");
const { createResourceStore } = require("./resources");
const { sendJsonResponse } = require("./response");

// Always follow the published GCS snapshot; a deployment must not pin old data.
const store = createResourceStore(new Storage());
const app = express();

app.get("/", async (req, res, next) => {
  if (!authenticate(req)) return res.sendStatus(401);
  if (!req.query.page) return res.status(400).send("Page not received");

  const { table } = req.query;
  // Preserve the existing normalization for zero/negative pagination values.
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Number(req.query.limit) || 5000);
  if (typeof table !== "string" || !/^[a-z][a-z0-9_]*$/.test(table) ||
      !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 ||
      !Number.isSafeInteger(page * limit)) {
    return res.status(400).send("Invalid query");
  }

  try {
    await sendJsonResponse(req, res, await store.getResponse(table, page, limit));
  } catch (error) {
    console.error("Failed to load resource data", error.message);
    if (res.headersSent) return next(error);
    res.status(500).send("Failed to load resource data");
  }
});

functions.http("wip-resource-data", app);
