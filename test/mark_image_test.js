const markImageData = require("../src/mark-image/mark_image_data.json");

const page = 2;
const limit = 9;

const total = markImageData.length;
const totalPage = Math.ceil(Number(total) / Number(limit));
const current = (Number(page) - 1) * Number(limit);
const data = markImageData.slice(
  Number(current),
  Number(current) + Number(limit)
);

console.log(current, current + limit);