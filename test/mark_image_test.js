const markImageData = require("../src/mark-image/mark_image_data.json");

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

const page = 2;
const limit = 9;

const total = markImageData.length;
const totalPage = Math.ceil(Number(total) / Number(limit));
const current = (Number(page) - 1) * Number(limit);
const data = markImageData.slice(
  Number(current),
  Number(current) + Number(limit)
);

// console.log(current, current + limit);

console.log(getFilteredMarkImageDataFromTitle(page, limit, '하트'));
