const functions = require("@google-cloud/functions-framework");
const compression = require("compression");
const express = require("express");
const { Storage } = require("@google-cloud/storage");
const { authenticate } = require("./authentication");

const BUCKET_NAME = "wip-bucket";
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
async function getResourcesByTable(table) {
  try {
    const filePath = `${table}.json`;

    const storage = new Storage();
    const file = storage.bucket(BUCKET_NAME).file(filePath);

    const [contents] = await file.download(); // 파일 전체를 메모리로 읽기

    const { resources } = JSON.parse(contents.toString("utf-8"));

    return { success: true, resources };
  } catch (e) {
    console.log(`Failed to load resource data %s`, e.stack || e);
    return { success: false, message: "Failed to load resource data" };
  }
}

/**
 * 원천 데이터를 페이징하여 반환
 * @param {String} 테이블 이름
 * @returns {Number} 페이지
 */
async function getResources(table, page) {
  const tableResourceGetResult = await getResourcesByTable(table);

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

app.get("/", async (req, res) => {
  if (!authenticate(req)) {
    res.sendStatus(401);
    return;
  }

  if (!req.query.page) {
    res.status(400).send("Page not received");
    return;
  }

  const { table, page } = req.query;

  const result = await getResources(table, page);

  if (!result.success) {
    res.status(500).send(result.message);
    return;
  }

  res.status(200).json(result.data);
});

functions.http("wip-resource-data", app);
