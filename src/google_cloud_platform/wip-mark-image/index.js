require("dotenv").config();
const functions = require("@google-cloud/functions-framework");
const { authenticate } = require("./authentication");
const markImageData = require("./mark_image_data.json");

/**
 * 마크 이미지 제목으로 검색
 * @param {Number} page 
 * @param {Number} limit 
 * @param {String} title 
 * @returns
 */
function getFilteredMarkImageDataFromTitle(page, limit, title) {
  const filteredData = markImageData.filter((v) => v.title.includes(title));

  const total = filteredData.length;
  const totalPage = Math.ceil(Number(total) / Number(limit));
  const current = (Number(page) - 1) * Number(limit);

  const data = filteredData.slice(
    Number(current),
    Number(current) + Number(limit)
  );

  return { total, totalPage, page, limit, data };
}

/**
 * 마크 이미지 검색
 * @param {Request} req 
 * @returns 
 */
async function getMarkImageData(req) {
  try {
    const { page, limit, title } = req.query;

    if (!page || !limit) {
      throw new Error(
        `Page and limit not received. page: ${page}, limit: ${limit}`
      );
    }

    if (limit > 50) {
      throw new Error(`Limit is very large. limit: ${limit}`);
    }

    const total = markImageData.length;
    const totalPage = Math.ceil(Number(total) / Number(limit));
    const current = (Number(page) - 1) * Number(limit);

    if (title) {
      return getFilteredMarkImageDataFromTitle(page, limit, title);
    }

    const data = markImageData.slice(
      Number(current),
      Number(current) + Number(limit)
    );

    return { total, totalPage, page, limit, data };
  } catch (e) {
    console.log("Standard API Error", e.stack || e);
    throw e;
  }
}

functions.http("markImage", async (req, res) => {
  switch (req.method) {
    case "GET": {
      if (!authenticate(req)) {
        res.sendStatus(401);
        return;
      }

      res.status(200).json(await getMarkImageData(req));
      break;
    }
  }
});
