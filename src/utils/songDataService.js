import { cheerSongs as defaultCurrentCheerSongs } from "../cheerSongs";
import { cheerSongs as defaultOldCheerSongs } from "../oldCheerSongs";

const STORAGE_KEY_CURRENT = "kbo_music_data_current_v1";
const STORAGE_KEY_OLD = "kbo_music_data_old_v1";

const REMOTE_BASE_URL = "https://civa030203.github.io/KBO-Music";

/**
 * 로컬 스토리지에서 캐시된 응원가 데이터를 안전하게 로드합니다.
 * 캐시가 없거나 유효하지 않으면 번들링된 기본 데이터를 반환합니다.
 */
export function getInitialSongData() {
  let current = defaultCurrentCheerSongs;
  let memories = defaultOldCheerSongs;

  try {
    const cachedCurrentStr = localStorage.getItem(STORAGE_KEY_CURRENT);
    if (cachedCurrentStr) {
      const parsed = JSON.parse(cachedCurrentStr);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
        current = parsed;
      }
    }
  } catch (e) {
    console.warn("[SongDataService] 현재 응원가 로컬 캐시 파싱 실패, 기본 번들 데이터를 사용합니다.", e);
  }

  try {
    const cachedOldStr = localStorage.getItem(STORAGE_KEY_OLD);
    if (cachedOldStr) {
      const parsed = JSON.parse(cachedOldStr);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
        memories = parsed;
      }
    }
  } catch (e) {
    console.warn("[SongDataService] 추억의 응원가 로컬 캐시 파싱 실패, 기본 번들 데이터를 사용합니다.", e);
  }

  return { current, memories };
}

/**
 * 원격 JSON 데이터를 비동기로 fetch하여 캐시를 갱신합니다.
 * 성공 시 { current, memories }를 반환하고 로컬 스토리지에 저장합니다.
 * 실패 시 null을 반환합니다.
 */
export async function syncRemoteSongData() {
  const cacheBuster = `t=${Date.now()}`;
  const fetchOptions = {
    cache: "no-store",
    headers: {
      "Pragma": "no-cache",
      "Cache-Control": "no-cache",
    },
  };

  const fetchJson = async (fileName) => {
    // 1차 시도: 배포된 원격 GitHub Pages URL (모바일 앱 및 웹 공통 최신 데이터)
    try {
      const remoteUrl = `${REMOTE_BASE_URL}/data/${fileName}?${cacheBuster}`;
      const res = await fetch(remoteUrl, fetchOptions);
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === "object" && Object.keys(data).length > 0) {
          return data;
        }
      }
    } catch (err) {
      // 콘솔 로그는 남기되 다음 폴백 시도
    }

    // 2차 시도: 현재 호스트 상대 경로 (로컬 개발 환경 등)
    try {
      const localUrl = `${process.env.PUBLIC_URL || ""}/data/${fileName}?${cacheBuster}`;
      const res = await fetch(localUrl, fetchOptions);
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === "object" && Object.keys(data).length > 0) {
          return data;
        }
      }
    } catch (err) {
      // 무시
    }

    return null;
  };

  try {
    const [remoteCurrent, remoteOld] = await Promise.all([
      fetchJson("cheerSongs.json"),
      fetchJson("oldCheerSongs.json"),
    ]);

    let updated = false;
    const result = {};

    if (remoteCurrent) {
      try {
        localStorage.setItem(STORAGE_KEY_CURRENT, JSON.stringify(remoteCurrent));
      } catch (e) {
        // quota exceeded 등 예외 무시
      }
      result.current = remoteCurrent;
      updated = true;
    }

    if (remoteOld) {
      try {
        localStorage.setItem(STORAGE_KEY_OLD, JSON.stringify(remoteOld));
      } catch (e) {
        // quota exceeded 등 예외 무시
      }
      result.memories = remoteOld;
      updated = true;
    }

    if (updated) {
      console.log("[SongDataService] 원격 최신 응원가 데이터 동기화 완료.");
      return result;
    }
  } catch (err) {
    console.warn("[SongDataService] 원격 응원가 데이터 동기화 실패 (기존 데이터 유지):", err);
  }

  return null;
}
