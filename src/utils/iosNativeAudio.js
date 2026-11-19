import { Capacitor, registerPlugin } from "@capacitor/core";

export const isIOSNativeAudio =
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";

export const KboAudioPlayer = registerPlugin("KboAudioPlayer");

// 트랙 객체를 네이티브 AVPlayer + NowPlaying 메타데이터 형식으로 변환
export function buildNativeTrackPayload(track) {
  const title = track.typeLabel
    ? `${track.title} - ${track.typeLabel}`
    : track.title || "프로야구 응원가";
  const artist = track.teamName || "KBO";
  const album =
    track.category === "memories"
      ? "크뮤 · 추억의 응원가"
      : "크뮤 · 현재 응원가";
  const artworkUrl =
    track.profileSrc && /^https?:\/\//i.test(track.profileSrc)
      ? track.profileSrc
      : track.teamLogo && /^https?:\/\//i.test(track.teamLogo)
      ? track.teamLogo
      : undefined;

  return {
    url: track.audioSrc,
    title,
    artist,
    album,
    artworkUrl,
  };
}
