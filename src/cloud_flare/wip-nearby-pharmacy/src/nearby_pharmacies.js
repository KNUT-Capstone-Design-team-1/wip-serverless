/**
 * Request로 부터 검색 파라미터를 반환
 * @param {Request} request 요청 객체
 * @returns
 */
function getSearchParams(request) {
  const queryParams = new URL(request.url).searchParams;

  const searchParams = {
    x: queryParams.get("x"),
    y: queryParams.get("y"),
    states: queryParams.get("states"),
    region: queryParams.get("region"),
    district: queryParams.get("district"),
    address: queryParams.get("address"),
  };

  return searchParams;
}

/**
 * 검색 파라미터를 밸리데이션
 * @param {Object} searchParams 검색 파라미터
 * @returns
 */
function validateSearchParams(searchParams) {
  const enteredSearchParamsEntries = Object.entries(searchParams).filter(
    ([_k, v]) => v,
  );

  if (!enteredSearchParamsEntries.length) {
    return { success: false, message: "Invalid Search Params" };
  }

  const { x, y } = searchParams;

  if ((x && !y) || (!x && y)) {
    return { success: false, message: "Coordinate data requires both x and y" };
  }

  return { success: true, message: "" };
}

/**
 * FTS 쿼리 반환
 * @param {Object} regionInfo 지역 정보
 * @returns
 */
function buildFtsQuery(regionInfo) {
  const { address, region, district } = regionInfo;

  const tokens = [];

  if (address) {
    tokens.push(address);
  }

  if (region) {
    tokens.push(region);
  }

  if (district) {
    tokens.push(district);
  }

  if (!tokens.length) {
    return null;
  }

  return tokens
    .map((t) => t.trim())
    .filter(Boolean)
    .join(" AND ");
}

/**
 * WHERE 쿼리와 파라미터를 생성
 * @param {Object} searchParams 검색 파라미터
 * @returns
 */
function generateWhere(searchParams, ftsTokens) {
  const { x, y, states, region, district } = searchParams;

  const whereClauses = [];
  const whereValues = [];

  if (states) {
    whereClauses.push(`p.states = ?`);
    whereValues.push(states);
  }

  if (region) {
    whereClauses.push(`p.region = ?`);
    whereValues.push(region);
  }

  if (district) {
    whereClauses.push(`p.district = ?`);
    whereValues.push(district);
  }

  if (ftsTokens) {
    whereClauses.push(`f MATCH ?`);
    whereValues.push(ftsTokens);
  }

  const hasCoordinate = x && y;
  if (hasCoordinate) {
    const distanceKm = 3;
    const lat = Number(y);
    const lng = Number(x);

    const latDelta = distanceKm / 111;
    const lngDelta = distanceKm / (111 * Math.cos((lat * Math.PI) / 180));

    whereClauses.push(`p.y BETWEEN ? AND ?`);
    whereClauses.push(`p.x BETWEEN ? AND ?`);

    whereValues.push(
      lat - latDelta,
      lat + latDelta,
      lng - lngDelta,
      lng + lngDelta,
    );
  }

  const whereQuery = whereClauses.length
    ? `WHERE ${whereClauses.join(" AND ")}`
    : "";

  return { whereQuery, whereValues };
}

/**
 * 주변 약국 조회
 * @param {Request} request 요청 객체
 * @param {Object} env workers 환경 객체
 * @returns
 */
export async function readPharmacies(request, env) {
  const searchParams = getSearchParams(request);

  const validate = validateSearchParams(searchParams);
  if (!validate.success) {
    return new Response(validate.message, { status: 400 });
  }

  const ftsTokens = buildFtsQuery(searchParams);
  const { whereQuery, whereValues } = generateWhere(searchParams, ftsTokens);

  const hasCoordinate = searchParams.x && searchParams.y;
  const coordinateQuery = `, acos(
    cos(radians(?)) * cos(radians(p.y)) *
    cos(radians(p.x) - radians(?)) +
    sin(radians(?)) * sin(radians(p.y))
  ) * 6371 AS distance`;

  const ftsJoinQuery = `JOIN nearby_pharmacies_fts AS f ON f.rowid = p.rowid`;

  const sql = `
    SELECT
      p.id,
      p.name,
      p.states,
      p.region,
      p.district,
      p.postalCode,
      p.address,
      p.telephone,
      p.openData,
      p.x,
      p.y
      ${hasCoordinate ? coordinateQuery : ``}
    FROM NearbyPharmacies p
    ${whereQuery}
    ${ftsTokens ? `AND f MATCH ?` : ``}
    ${hasCoordinate ? `ORDER BY distance` : ``}
    LIMIT ?`;

  const values = [];

  if (hasCoordinate) {
    values.push(searchParams.y, searchParams.x, searchParams.y);
  }

  values.push(...whereValues);

  if (ftsTokens) {
    values.push(ftsTokens);
  }

  const statement = env.D1.prepare(sql).bind(...values, 30);
  const pharmacies = await statement.all();

  return Response.json(pharmacies);
}
