async function updateNotice(idx, request, env) {
    const contentType = request.headers.get("Content-Type");

    if (contentType !== "application/json") {
        console.log(`[UPDATE-NOTICE] Allowed only json contents type`);
        return new Response("Bad Request", { status: 400 });
    }

    const payload = await request.json();

    if (!payload) {
        console.log(`[UPDATE-NOTICE] No payload`);
        return new Response("Bad Request", { status: 400 });
    }

    const { title, contents, mustRead } = payload;

    if (!title && !contents && (typeof mustRead !== "boolean" && !mustRead)) {
        console.log(`[UPDATE-NOTICE] Required value not exist. title: %s, contents: %s`, title, contents);
        return new Response("Bad Request", { status: 400 });
    }

    const sql = `UPDATE Notices SET 
                 ${title ? "title = ?," : ""}
                 ${contents ? "contents = ?," : ""}
                 ${mustRead ? "mustRead = ?," : ""}
                 updateDate = NOW()
                 WHERE idx = ?`;

    await env.DB.prepare(sql).bind(title, contents, mustRead, idx);

    return new Response("Success");
}

async function deleteNotice(idx, env) {
    const sql = `DELETE FROM Notices WHERE idx = ?`;

    await env.DB.prepare(sql).bind(idx);

    return new Response("Success");
}

module.exports = { updateNotice, deleteNotice };