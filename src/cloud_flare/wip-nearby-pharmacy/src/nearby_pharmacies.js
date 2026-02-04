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
 * WHERE 쿼리와 파라미터를 생성
 * @param {Object} searchParams 검색 파라미터
 * @returns
 */
function generateWhere(searchParams) {
  const { x, y, states, region, district, address } = searchParams;

  const filterMapper = {
    states: [`states = ?`, [states]],
    region: [`region LIKE ?`, [`%${region}%`]],
    district: [`district LIKE ?`, [`%${district}%`]],
    address: [`address LIKE ?`, [`%${address}%`]],
  };

  const whereClauses = [];
  const whereValues = [];

  const attributeFilters = Object.entries(searchParams).filter(
    ([k, v]) => v && !["x", "y"].includes(k),
  );

  if (attributeFilters.length) {
    whereClauses.push(
      attributeFilters.map(([k]) => filterMapper[k][0]).join(" AND "),
    );

    whereValues.push(...attributeFilters.flatMap(([k]) => filterMapper[k][1]));
  }

  const hasCoordinate = x && y;
  if (hasCoordinate) {
    const earthRadius = 6371; // km
    const distanceLimit = 3; // km

    whereClauses.push(`? * acos(
      cos(radians(?)) * cos(radians(y)) *
      cos(radians(x) - radians(?)) +
      sin(radians(?)) * sin(radians(y))
    ) < ?`);

    whereValues.push(earthRadius, y, x, y, distanceLimit);
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

  const { whereQuery, whereValues } = generateWhere(searchParams);

  const sql = `SELECT id, name, states, region, district, postalCode, address, telephone, openData, x, y
               FROM NearbyPharmacies
               ${whereQuery || ''}`;

  const statement = env.D1.prepare(sql).bind(...whereValues);
  const pharmacies = await statement.all();

  return Response.json(pharmacies);
}
