const markImageData = require("../src/mark-image/mark_image_data.json");

const page = 1;
const limit = 50;

const total = markImageData.length;
const totalPage = Math.ceil(total / limit);
const current = (page - 1) * limit;
const data = markImageData.slice(current, current + limit);

console.log(data, totalPage);