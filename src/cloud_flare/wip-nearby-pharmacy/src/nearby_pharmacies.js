/**
 * 주변 약국 조회
 * @param {Request} request 요청 객체
 * @param {Env} env workers 환경 객체
 * @returns 
 */
export async function readPharmacies(request, env) {
  const queryParams = new URL(request.url).searchParams;

  const filter = {
    x: queryParams.get("x"),
    y: queryParams.get("y"),
    states: queryParams.get("states"),
    region: queryParams.get("region"),
    district: queryParams.get("district"),
    address: queryParams.get("address"),
  };

  const enteredFilterEntries = Object.entries(filter).filter(([_k, v]) => v);
  if (!enteredFilterEntries.length) {
    return new Response("No Filter", { status: 400 });
  }

  const { x, y, states, region, district, address } = filter;

  if ((x && !y) || (!x && y)) {
    return new Response("Coordinate data requires both x and y", {
      status: 400,
    });
  }

  const filterMapper = {
    states: [`states = ?`, [states]],
    region: [`region LIKE ?`, [`%${region}%`]],
    district: [`district LIKE ?`, [`%${district}%`]],
    address: [`address LIKE ?`, [`%${address}%`]],
  };

  let whereQuery = `WHERE `;
  const whereValues = [];

  const whereFilterEntries = enteredFilterEntries.filter(
    ([k]) => !["x", "y"].includes(k)
  );

  if (whereFilterEntries.length) {
    whereQuery += whereFilterEntries
      .map(([k]) => filterMapper[k][0])
      .join(" OR ");

    whereValues.push(whereFilterEntries.flatMap(([k]) => filterMapper[k][1]));
  }

  if (x && y) {
    const earthRadius = 6371; // km
    const distanceLimit = 3; // km

    const coordinateWhereQuery = `? * acos(
             cos(radians(?)) * cos(radians(y)) *
             cos(radians(x) - radians(?)) +
             sin(radians(?)) * sin(radians(y))
           ) < ?`;

    whereFilterEntries.length

    whereQuery += whereFilterEntries.length ? ` AND ${coordinateWhereQuery}` : coordinateWhereQuery;

    whereValues.push(earthRadius, y, x, y, distanceLimit);
  }

  const sql = `SELECT id, name, states, region, district, postalCode, address, telephone, openData, x, y
               FROM NearbyPharmacies
               ${whereQuery}`;

  const statement = env.D1.prepare(sql).bind(...whereValues);
  const pharmacies = await env.D1.batch([statement]);

  return Response.json(pharmacies);
}
