import { MediaSession } from "@capgo/capacitor-media-session";

// 이미지 URL 확장자에서 MIME 타입 추론
function guessImageType(url) {
  if (!url || typeof url !== "string") return "image/jpeg";
  const cleanUrl = url.split("?")[0].toLowerCase();
  if (cleanUrl.endsWith(".png")) return "image/png";
  if (cleanUrl.endsWith(".webp")) return "image/webp";
  if (cleanUrl.endsWith(".svg")) return "image/svg+xml";
  return "image/jpeg";
}

// 네이티브 플레이어(잠금화면 / 제어센터 / Android 미디어 알림)에 표시할 메타데이터 구성
export async function updateMediaSessionMetadata(track) {
  if (!track) return;

  const title = track.typeLabel
    ? `${track.title} - ${track.typeLabel}`
    : track.title || "프로야구 응원가";
  const artist = track.teamName || "KBO";
  const album =
    track.category === "memories"
      ? "크뮤 · 추억의 응원가"
      : "크뮤 · 현재 응원가";

  const artwork = [];
  if (track.profileSrc && /^https?:\/\//i.test(track.profileSrc)) {
    artwork.push({
      src: track.profileSrc,
      sizes: "512x512",
      type: guessImageType(track.profileSrc),
    });
  } else if (track.teamLogo && /^https?:\/\//i.test(track.teamLogo)) {
    artwork.push({
      src: track.teamLogo,
      sizes: "512x512",
      type: guessImageType(track.teamLogo),
    });
  }

  try {
    await MediaSession.setMetadata({
      title,
      artist,
      album,
      artwork,
    });
  } catch {
    // 브라우저/플랫폼 미지원 시 무시
  }
}

// 재생 상태(playing / paused / none) 동기화
export async function updateMediaSessionPlaybackState(playbackState) {
  try {
    await MediaSession.setPlaybackState({ playbackState });
  } catch {
    // 무시
  }
}

// 진행 위치(duration / position / playbackRate) 동기화
export async function updateMediaSessionPositionState({
  duration,
  position,
  playbackRate = 1.0,
}) {
  if (!Number.isFinite(duration) || duration <= 0) return;
  const safePosition = Number.isFinite(position)
    ? Math.max(0, Math.min(position, duration))
    : 0;

  try {
    await MediaSession.setPositionState({
      duration,
      position: safePosition,
      playbackRate,
    });
  } catch {
    // 무시
  }
}

// 잠금화면 / 알림창 / 블루투스 이어폰 컨트롤 핸들러 등록
// actionsRef는 항상 최신 핸들러들을 담고 있는 React ref 객체입니다.
export async function registerMediaSessionActionHandlers(actionsRef) {
  const bindings = [
    ["play", () => actionsRef.current?.onPlay?.()],
    ["pause", () => actionsRef.current?.onPause?.()],
    ["previoustrack", () => actionsRef.current?.onPreviousTrack?.()],
    ["nexttrack", () => actionsRef.current?.onNextTrack?.()],
    ["seekto", (details) => actionsRef.current?.onSeekTo?.(details?.seekTime)],
    ["seekbackward", () => actionsRef.current?.onSeekBy?.(-10)],
    ["seekforward", () => actionsRef.current?.onSeekBy?.(10)],
    ["stop", () => actionsRef.current?.onStop?.()],
  ];

  for (const [action, handler] of bindings) {
    try {
      await MediaSession.setActionHandler({ action }, handler);
    } catch {
      // 일부 플랫폼에서 미지원 액션일 경우 무시
    }
  }
}

// 언마운트 시 액션 핸들러 해제
export async function clearMediaSessionActionHandlers() {
  const actions = [
    "play",
    "pause",
    "previoustrack",
    "nexttrack",
    "seekto",
    "seekbackward",
    "seekforward",
    "stop",
  ];

  for (const action of actions) {
    try {
      await MediaSession.setActionHandler({ action }, null);
    } catch {
      // 무시
    }
  }
}
