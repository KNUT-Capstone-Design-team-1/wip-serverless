const functions = require("@google-cloud/functions-framework");
const compression = require("compression");
const express = require("express");
const { Storage } = require("@google-cloud/storage");
const { authenticate } = require("./authentication");

const BUCKET_NAME = "wip-bucket";
const DEFAULT_PAGE_LIMIT = 5000;

// 전역 Storage 인스턴스 및 인메모리 캐시 재사용
const storage = new Storage();
const resourceCache = new Map();

const app = express();

app.use(
  compression({
    threshold: 1024, // 1KB 이상만 압축
  }),
);

/**
 * 테이블 별 원천 데이터 반환 (인메모리 캐싱 적용)
 * @param {String} table
 * @returns
 */
async function getResourcesByTable(table) {
  try {
    if (resourceCache.has(table)) {
      return { success: true, resources: resourceCache.get(table) };
    }

    const filePath = `${table}.json`;
    const file = storage.bucket(BUCKET_NAME).file(filePath);

    const [contents] = await file.download(); // 파일 전체를 메모리로 읽기
    const { resources } = JSON.parse(contents.toString("utf-8"));

    // 파싱된 데이터 메모리 캐시 저장
    resourceCache.set(table, resources);

    return { success: true, resources };
  } catch (e) {
    console.log(`Failed to load resource data %s`, e.stack || e);
    return { success: false, message: "Failed to load resource data" };
  }
}

/**
 * 원천 데이터를 페이징하여 반환
 * @param {String} table 테이블 이름
 * @param {Number|String} page 페이지
 * @param {Number|String} limit 페이징 단위
 * @returns
 */
async function getResources(table, page, limit = DEFAULT_PAGE_LIMIT) {
  const tableResourceGetResult = await getResourcesByTable(table);

  if (!tableResourceGetResult.success) {
    return tableResourceGetResult;
  }

  const { resources } = tableResourceGetResult;

  const pageSize = Math.max(1, Number(limit) || DEFAULT_PAGE_LIMIT);
  const pageNumber = Math.max(1, Number(page) || 1);

  const total = resources.length;
  const totalPage = Math.ceil(total / pageSize);
  const current = (pageNumber - 1) * pageSize;

  const resource = resources.slice(current, current + pageSize);

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

  const { table, page, limit } = req.query;

  const result = await getResources(table, page, limit);

  if (!result.success) {
    res.status(500).send(result.message);
    return;
  }

  res.status(200).json(result.data);
});

functions.http("wip-resource-data", app);
