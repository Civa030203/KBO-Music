const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const mobileBuildDir = path.join(rootDir, "mobile-build");

console.log("[크뮤 모바일 빌드] 초경량 스트리밍 번들 빌드를 시작합니다...");

// 기존 mobile-build 폴더 정리
if (fs.existsSync(mobileBuildDir)) {
  fs.rmSync(mobileBuildDir, { recursive: true, force: true });
}

// BUILD_PATH=mobile-build, PUBLIC_URL=. 로 React 프로덕션 빌드 수행
// 기존 웹 배포용 build/ 폴더와 homepage 경로 설정에는 영향을 주지 않습니다.
const reactScriptsBin = path.join(
  rootDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "react-scripts.cmd" : "react-scripts"
);

execSync(`"${reactScriptsBin}" build`, {
  cwd: rootDir,
  stdio: "inherit",
  env: {
    ...process.env,
    BUILD_PATH: "mobile-build",
    PUBLIC_URL: ".",
    GENERATE_SOURCEMAP: "false",
  },
});

// GitHub Pages에서 원격 스트리밍하는 대용량 정적 리소스(music, profiles) 제외
const excludedDirs = ["music", "profiles"];
for (const dirName of excludedDirs) {
  const targetPath = path.join(mobileBuildDir, dirName);
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
    console.log(`[크뮤 모바일 빌드] 스트리밍 리소스 제외 완료: mobile-build/${dirName}`);
  }
}

// 앱에서 사용하지 않는 웹 전용 파일 제외
const excludedFiles = ["robots.txt", "ads.txt"];
for (const fileName of excludedFiles) {
  const targetPath = path.join(mobileBuildDir, fileName);
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { force: true });
  }
}

console.log("[크뮤 모바일 빌드] 완료! 결과물 위치: mobile-build/");
