const TOKEN = process.env.VERCEL_TOKEN; // set via environment variable, never hardcode
const PROJECT_ID = process.env.VERCEL_PROJECT_ID || "prj_eZUczRGvg35Z1YAv77LIMGlviF9r";
const TEAM_ID = process.env.VERCEL_TEAM_ID || "team_nta1fNZPeNFtH7zY0GJAVIFc";

async function main() {
  const listUrl = `https://api.vercel.com/v9/projects/${PROJECT_ID}/env?teamId=${TEAM_ID}`;
  const res = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  const data = await res.json();
  if (!data.envs) {
    console.error("Failed to list envs:", JSON.stringify(data));
    return;
  }
  console.log(`Found ${data.envs.length} env vars total.`);
  let deleted = 0;
  let failed = 0;
  for (const env of data.envs) {
    const delUrl = `https://api.vercel.com/v9/projects/${PROJECT_ID}/env/${env.id}?teamId=${TEAM_ID}`;
    const delRes = await fetch(delUrl, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    if (delRes.ok) {
      deleted++;
      console.log(`Deleted (${deleted}): ${env.key}`);
    } else {
      failed++;
      const errBody = await delRes.text();
      console.log(`FAILED: ${env.key} -> ${delRes.status} ${errBody}`);
    }
  }
  console.log(`\nDone. Deleted: ${deleted}, Failed: ${failed}`);
}

main();
