const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

async function exportSongsData() {
  const rootDir = path.resolve(__dirname, "..");
  const publicDataDir = path.join(rootDir, "public", "data");

  if (!fs.existsSync(publicDataDir)) {
    fs.mkdirSync(publicDataDir, { recursive: true });
  }

  console.log("[데이터 내보내기] 응원가/등장곡 JSON 파일 생성을 시작합니다...");

  const currentSongsPath = path.join(rootDir, "src", "cheerSongs.js");
  const oldSongsPath = path.join(rootDir, "src", "oldCheerSongs.js");

  const currentMod = await import(pathToFileURL(currentSongsPath).href);
  const oldMod = await import(pathToFileURL(oldSongsPath).href);

  const currentData = currentMod.cheerSongs;
  const oldData = oldMod.cheerSongs;

  const currentJsonPath = path.join(publicDataDir, "cheerSongs.json");
  const oldJsonPath = path.join(publicDataDir, "oldCheerSongs.json");

  fs.writeFileSync(currentJsonPath, JSON.stringify(currentData, null, 2), "utf-8");
  fs.writeFileSync(oldJsonPath, JSON.stringify(oldData, null, 2), "utf-8");

  console.log(`[데이터 내보내기 완료]`);
  console.log(` - 현재 응원가: public/data/cheerSongs.json (${Object.keys(currentData).length}개 구단)`);
  console.log(` - 추억의 응원가: public/data/oldCheerSongs.json (${Object.keys(oldData).length}개 구단)`);
}

exportSongsData().catch((err) => {
  console.error("[데이터 내보내기 실패]", err);
  process.exit(1);
});
