import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getInitialSongData, syncRemoteSongData } from "./utils/songDataService";
import { useLocation, useNavigate } from "react-router-dom";
import {
  updateMediaSessionMetadata,
  updateMediaSessionPlaybackState,
  updateMediaSessionPositionState,
  registerMediaSessionActionHandlers,
  clearMediaSessionActionHandlers,
} from "./utils/mediaSession";
import {
  initNativeAppUI,
  registerNativeBackButton,
} from "./utils/nativeApp";
import {
  isIOSNativeAudio,
  KboAudioPlayer,
  buildNativeTrackPayload,
} from "./utils/iosNativeAudio";

const PLAYLIST_STORAGE_KEY = "kbo_music_playlist_v1";

// 프로필 이미지 URL 생성 헬퍼
function getProfileUrl(song, category) {
  if (song.link) return song.link;
  if (category === "memories") {
    const year = song.memory || "2026";
    return `https://6ptotvmi5753.edge.naverncp.com/KBO_IMAGE/person/middle/${year}/${song.playerID}.jpg`;
  }
  const year = song.retired ? song.retired : "2026";
  return `https://6ptotvmi5753.edge.naverncp.com/KBO_IMAGE/person/middle/${year}/${song.playerID}.jpg`;
}

// 오디오 MP3 URL 생성 헬퍼
function getAudioUrl({ category, type, teamID, playerTeam, fileName, playerID }) {
  const targetFile = fileName || playerID;
  if (category === "memories") {
    const folder = type === "intro" ? "intro/old" : "player/old";
    return `https://civa030203.github.io/KBO-Music/music/${folder}/${teamID}/${targetFile}.mp3`;
  }
  const folder = type === "intro" ? "intro" : "player";
  const targetTeam = teamID === "WBC" ? playerTeam : teamID;
  return `https://civa030203.github.io/KBO-Music/music/${folder}/${targetTeam}/${targetFile}.mp3`;
}

// 선수의 등장곡 목록 추출 헬퍼 (방식 A 적용)
function getIntroItems(song, category) {
  if (song.intros && Array.isArray(song.intros) && song.intros.length > 0) {
    return song.intros.map((intro, idx) => ({
      title: intro.title || (song.intros.length > 1 ? `등장곡 ${idx + 1}` : "등장곡"),
      fileName: intro.fileName || song.fileName || song.playerID,
    }));
  }
  if (category === "current") {
    if (song.hasIntro === false) return [];
    return [{ title: "등장곡", fileName: song.fileName || song.playerID }];
  }
  if (category === "memories") {
    if (song.hasIntro === true) {
      return [{ title: "등장곡", fileName: song.fileName || song.playerID }];
    }
    return [];
  }
  return [];
}

// 표준 트랙 아이템 생성 헬퍼
function createTrackItem({ song, teamName, teamData, category, type, cheerObj = null, introObj = null }) {
  const fileName =
    type === "intro"
      ? (introObj ? introObj.fileName : song.fileName)
      : (cheerObj ? cheerObj.fileName : song.fileName);

  const typeLabel =
    type === "intro"
      ? (introObj ? introObj.title || "등장곡" : "등장곡")
      : (cheerObj ? cheerObj.title || "응원가" : "응원가");

  const lyrics =
    type === "intro"
      ? ""
      : cheerObj
        ? cheerObj.lyrics || ""
        : song.lyrics || "";

  return {
    uid: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    trackKey: `${category}-${teamData.teamID}-${song.playerID}-${type}-${fileName || "default"}`,
    category, // "current" | "memories"
    type, // "cheer" | "intro"
    typeLabel,
    teamName,
    teamID: teamData.teamID,
    teamColor1: teamData.teamColor1,
    teamColor2: teamData.teamColor2,
    teamLogo: teamData.logo,
    playerID: song.playerID,
    playerTeam: song.playerTeam || null,
    title: song.title,
    fileName,
    lyrics,
    misc: song.misc || "",
    isLegend: Boolean(song.isLegend),
    retired: song.retired || null,
    memory: song.memory || null,
    link: song.link || null,
    profileSrc: getProfileUrl(song, category),
    audioSrc: getAudioUrl({
      category,
      type,
      teamID: teamData.teamID,
      playerTeam: song.playerTeam,
      fileName,
      playerID: song.playerID,
    }),
  };
}

// 한 선수의 모든 트랙 생성 (팀 전체 재생/담기용)
function buildTracksForSong(song, teamName, teamData, category) {
  const tracks = [];
  const introItems = getIntroItems(song, category);
  introItems.forEach((introObj) => {
    tracks.push(
      createTrackItem({
        song,
        teamName,
        teamData,
        category,
        type: "intro",
        introObj,
      })
    );
  });

  if (song.cheers && song.cheers.length > 0) {
    song.cheers.forEach((cheerObj) => {
      tracks.push(
        createTrackItem({
          song,
          teamName,
          teamData,
          category,
          type: "cheer",
          cheerObj,
        })
      );
    });
  } else {
    tracks.push(
      createTrackItem({
        song,
        teamName,
        teamData,
        category,
        type: "cheer",
      })
    );
  }
  return tracks;
}

// 시간 포맷 헬퍼 (초 -> M:SS)
function formatTime(sec) {
  if (!sec || !Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

// 선수 카드 내 개별 곡 액션 버튼 (즉시 재생 + 플레이리스트 담기)
function TrackActionButton({ label, onPlay, onAdd, color, isActive }) {
  return (
    <div
      className={`inline-flex items-stretch rounded-xl overflow-hidden shadow-sm transition-transform active:scale-95 ${isActive ? "ring-2 ring-yellow-300" : ""
        }`}
      style={{ backgroundColor: color || "#334155" }}
    >
      <button
        type="button"
        onClick={onPlay}
        className="px-3 py-1.5 text-xs md:text-sm font-semibold text-white hover:bg-black/20 transition-colors flex items-center gap-1.5 whitespace-nowrap"
        title={`${label} 즉시 재생`}
      >
        <span className="text-[10px]">{isActive ? "🔊" : "▶"}</span>
        <span>{label}</span>
      </button>
      <button
        type="button"
        onClick={onAdd}
        className="px-2.5 py-1.5 text-xs md:text-sm font-bold text-white border-l border-white/25 hover:bg-black/30 transition-colors flex items-center justify-center"
        title={`${label} 플레이리스트에 추가`}
        aria-label={`${label} 플레이리스트에 추가`}
      >
        +
      </button>
    </div>
  );
}

// 선수 카드 컴포넌트
function PlayerSongCard({
  song,
  teamName,
  teamData,
  category,
  showTeamBadge = false,
  currentTrack,
  onPlayTrack,
  onAddTrack,
}) {
  const profileUrl = getProfileUrl(song, category);
  const introItems = getIntroItems(song, category);

  const isTrackCurrent = (type, itemObj = null) => {
    if (!currentTrack) return false;
    const fileName = itemObj ? itemObj.fileName : song.fileName;
    const key = `${category}-${teamData.teamID}-${song.playerID}-${type}-${fileName || "default"}`;
    return currentTrack.trackKey === key;
  };

  return (
    <div
      className="text-white rounded-2xl shadow-md p-3.5 transition-all hover:shadow-lg border border-white/10"
      style={{ backgroundColor: teamData.teamColor1 }}
    >
      <div className="flex flex-col gap-2.5">
        {/* 상단: 프로필 이미지 + 선수 정보 + 배지 */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-full overflow-hidden flex-shrink-0 bg-white/20 border border-white/30">
              <img
                src={profileUrl}
                alt={`${song.title} 프로필`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span
                  className={`text-sm md:text-base font-bold truncate ${song.isLegend ? "text-amber-300" : "text-white"
                    }`}
                >
                  {song.title}
                </span>
                {song.isLegend && (
                  <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-200 border border-amber-300/40">
                    LEGEND
                  </span>
                )}
              </div>
              {song.misc && (
                <p className="text-xs text-white/75 truncate mt-0.5">{song.misc}</p>
              )}
            </div>
          </div>

          {showTeamBadge && (
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <div className="flex items-center gap-1.5 bg-black/30 px-2.5 py-1 rounded-full text-xs font-semibold">
                <img
                  src={teamData.logo}
                  alt={teamName}
                  className="w-4 h-4 object-contain"
                />
                <span>{teamName}</span>
              </div>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${category === "current"
                  ? "bg-emerald-500/30 text-emerald-100 border border-emerald-300/30"
                  : "bg-amber-500/30 text-amber-100 border border-amber-300/30"
                  }`}
              >
                {category === "current" ? "현재 응원가" : "추억의 응원가"}
              </span>
            </div>
          )}
        </div>

        {/* 하단: 재생 및 플레이리스트 추가 버튼들 */}
        <div className="flex gap-2 flex-wrap pt-0.5">
          {introItems.map((introObj, idx) => (
            <TrackActionButton
              key={`intro-${idx}`}
              label={introObj.title}
              color={teamData.teamColor2}
              isActive={isTrackCurrent("intro", introObj)}
              onPlay={() =>
                onPlayTrack(
                  createTrackItem({
                    song,
                    teamName,
                    teamData,
                    category,
                    type: "intro",
                    introObj,
                  })
                )
              }
              onAdd={() =>
                onAddTrack(
                  createTrackItem({
                    song,
                    teamName,
                    teamData,
                    category,
                    type: "intro",
                    introObj,
                  })
                )
              }
            />
          ))}

          {song.cheers && song.cheers.length > 0 ? (
            song.cheers.map((cheer, idx) => (
              <TrackActionButton
                key={`cheer-${idx}`}
                label={cheer.title || `응원가 ${idx + 1}`}
                color={teamData.teamColor2}
                isActive={isTrackCurrent("cheer", cheer)}
                onPlay={() =>
                  onPlayTrack(
                    createTrackItem({
                      song,
                      teamName,
                      teamData,
                      category,
                      type: "cheer",
                      cheerObj: cheer,
                    })
                  )
                }
                onAdd={() =>
                  onAddTrack(
                    createTrackItem({
                      song,
                      teamName,
                      teamData,
                      category,
                      type: "cheer",
                      cheerObj: cheer,
                    })
                  )
                }
              />
            ))
          ) : (
            <TrackActionButton
              label="응원가"
              color={teamData.teamColor2}
              isActive={isTrackCurrent("cheer")}
              onPlay={() =>
                onPlayTrack(
                  createTrackItem({
                    song,
                    teamName,
                    teamData,
                    category,
                    type: "cheer",
                  })
                )
              }
              onAdd={() =>
                onAddTrack(
                  createTrackItem({
                    song,
                    teamName,
                    teamData,
                    category,
                    type: "cheer",
                  })
                )
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

const App = ({ initialMode }) => {
  const location = useLocation();
  const navigate = useNavigate();

  // 응원가/등장곡 데이터 상태 (로컬 캐시 즉시 로드 + 원격 백그라운드 동기화)
  const [songData, setSongData] = useState(() => getInitialSongData());
  const currentCheerSongs = songData.current;
  const oldCheerSongs = songData.memories;

  // 마운트 시 원격 최신 데이터 백그라운드 동기화 (앱 업데이트 없이 즉시 반영)
  useEffect(() => {
    let isMounted = true;
    syncRemoteSongData().then((updated) => {
      if (isMounted && updated) {
        setSongData((prev) => ({
          current: updated.current || prev.current,
          memories: updated.memories || prev.memories,
        }));
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // 현재 응원가("current") vs 추억의 응원가("memories") 상태
  const [activeCategory, setActiveCategory] = useState(() => {
    if (initialMode === "memories" || location.pathname === "/memories") {
      return "memories";
    }
    return "current";
  });

  // URL 경로 변경 시 탭 동기화 (오디오 상태는 그대로 유지)
  useEffect(() => {
    if (location.pathname === "/memories" && activeCategory !== "memories") {
      setActiveCategory("memories");
    } else if (location.pathname === "/" && activeCategory !== "current") {
      setActiveCategory("current");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const activeDataMap = activeCategory === "current" ? currentCheerSongs : oldCheerSongs;

  const [selectedTeam, setSelectedTeam] = useState("");
  const [isTeamDropdownOpen, setIsTeamDropdownOpen] = useState(false);

  // 검색 상태
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState("all"); // "all" | "current" | "memories"

  // 플레이리스트 상태 (localStorage 연동)
  const [playlist, setPlaylist] = useState(() => {
    try {
      const saved = localStorage.getItem(PLAYLIST_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [currentPlaylistIndex, setCurrentPlaylistIndex] = useState(-1);
  const [currentTrack, setCurrentTrack] = useState(null);

  // 오디오 컨트롤 상태
  const audioRef = useRef(null);
  const lastPositionSyncRef = useRef(0);
  const mediaActionsRef = useRef({});
  const audioEndedRef = useRef(() => { });
  const audioErrorRef = useRef(() => { });
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const backButtonRef = useRef(() => false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [repeatMode, setRepeatMode] = useState("none"); // "none" | "all" | "one"
  const [isShuffle, setIsShuffle] = useState(false);

  // 모바일 바텀 시트(플레이어 확장) 상태
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState("player"); // "player" | "playlist"

  // 토스트 알림 상태
  const [toastMessage, setToastMessage] = useState(null);
  const toastTimeoutRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2400);
  }, []);

  // 플레이리스트 localStorage 저장
  useEffect(() => {
    try {
      localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(playlist));
    } catch {
      // ignore storage errors
    }
  }, [playlist]);

  // 탭 전환 핸들러 (현재 응원가 <-> 추억의 응원가)
  const handleCategoryChange = (nextCategory) => {
    setActiveCategory(nextCategory);
    if (nextCategory === "memories") {
      if (location.pathname !== "/memories") navigate("/memories");
      if (selectedTeam && !oldCheerSongs[selectedTeam]) {
        setSelectedTeam("");
      }
    } else {
      if (location.pathname !== "/") navigate("/");
      if (selectedTeam && !currentCheerSongs[selectedTeam]) {
        setSelectedTeam("");
      }
    }
  };

  // 현재 트랙 변경 시 오디오 소스 업데이트, 자동 재생 및 네이티브 미디어 세션 메타데이터 동기화
  useEffect(() => {
    if (!currentTrack) return;

    lastPositionSyncRef.current = 0;
    currentTimeRef.current = 0;
    durationRef.current = 0;
    setCurrentTime(0);
    setDuration(0);

    if (isIOSNativeAudio) {
      KboAudioPlayer.loadAndPlay(buildNativeTrackPayload(currentTrack))
        .then(() => {
          setIsPlaying(true);
        })
        .catch(() => {
          setIsPlaying(false);
        });
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;

    updateMediaSessionMetadata(currentTrack);

    if (audio.src !== currentTrack.audioSrc) {
      audio.src = currentTrack.audioSrc;
      audio.load();
    }
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          setIsPlaying(true);
          updateMediaSessionPlaybackState("playing");
        })
        .catch(() => {
          setIsPlaying(false);
          updateMediaSessionPlaybackState("paused");
        });
    }
  }, [currentTrack]);

  // 재생 상태 변경 시 네이티브 미디어 세션 동기화
  useEffect(() => {
    if (isIOSNativeAudio) return;

    const state = isPlaying ? "playing" : currentTrack ? "paused" : "none";
    updateMediaSessionPlaybackState(state);
    if (audioRef.current && Number.isFinite(audioRef.current.duration) && audioRef.current.duration > 0) {
      updateMediaSessionPositionState({
        duration: audioRef.current.duration,
        position: audioRef.current.currentTime,
        playbackRate: isPlaying ? audioRef.current.playbackRate || 1.0 : 0.0,
      });
    }
  }, [isPlaying, currentTrack]);

  // 네이티브 앱 UI 초기화 및 미디어 세션 / 뒤로가기 핸들러 등록
  useEffect(() => {
    initNativeAppUI();
    const unregisterBackButton = registerNativeBackButton(backButtonRef);

    // Safari 16.4+ 웹 환경에서도 백그라운드 재생이 끊기지 않도록 audioSession 타입 지정
    try {
      if (typeof navigator !== "undefined" && "audioSession" in navigator && navigator.audioSession) {
        navigator.audioSession.type = "playback";
      }
    } catch {
      // 미지원 브라우저 무시
    }

    if (!isIOSNativeAudio) {
      registerMediaSessionActionHandlers(mediaActionsRef);
      return () => {
        unregisterBackButton();
        clearMediaSessionActionHandlers();
      };
    }

    // iOS 네이티브 AVPlayer 이벤트 리스너 등록
    const listenerPromises = [
      KboAudioPlayer.addListener("timeUpdate", (data) => {
        const nextTime = typeof data?.currentTime === "number" ? data.currentTime : 0;
        const nextDuration = typeof data?.duration === "number" ? data.duration : 0;
        currentTimeRef.current = nextTime;
        setCurrentTime(nextTime);
        if (nextDuration > 0) {
          durationRef.current = nextDuration;
          setDuration(nextDuration);
        }
      }),
      KboAudioPlayer.addListener("loadedMetadata", (data) => {
        const nextDuration = typeof data?.duration === "number" ? data.duration : 0;
        if (nextDuration > 0) {
          durationRef.current = nextDuration;
          setDuration(nextDuration);
        }
      }),
      KboAudioPlayer.addListener("playbackStateChanged", (data) => {
        setIsPlaying(Boolean(data?.isPlaying));
      }),
      KboAudioPlayer.addListener("ended", () => {
        audioEndedRef.current?.();
      }),
      KboAudioPlayer.addListener("error", () => {
        audioErrorRef.current?.();
      }),
      KboAudioPlayer.addListener("remoteAction", (data) => {
        const action = data?.action;
        if (action === "nexttrack") {
          mediaActionsRef.current?.onNextTrack?.();
        } else if (action === "previoustrack") {
          mediaActionsRef.current?.onPreviousTrack?.();
        } else if (action === "seekto" && typeof data?.seekTime === "number") {
          currentTimeRef.current = data.seekTime;
          setCurrentTime(data.seekTime);
        }
      }),
    ];

    return () => {
      unregisterBackButton();
      Promise.all(listenerPromises)
        .then((handles) => {
          handles.forEach((handle) => handle?.remove?.());
        })
        .catch(() => { });
    };
  }, []);

  // 재생 / 일시정지 토글
  const togglePlayPause = () => {
    if (!currentTrack && playlist.length > 0) {
      setCurrentPlaylistIndex(0);
      setCurrentTrack(playlist[0]);
      return;
    }
    if (!currentTrack) return;

    if (isIOSNativeAudio) {
      if (isPlaying) {
        KboAudioPlayer.pause().catch(() => { });
      } else {
        KboAudioPlayer.play().catch(() => { });
      }
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => { });
    } else {
      audio.pause();
    }
  };

  // 다음 곡 재생
  const handleNextTrack = useCallback(() => {
    if (playlist.length === 0) return;

    if (isShuffle && playlist.length > 1) {
      let nextIdx = Math.floor(Math.random() * playlist.length);
      if (nextIdx === currentPlaylistIndex) {
        nextIdx = (nextIdx + 1) % playlist.length;
      }
      setCurrentPlaylistIndex(nextIdx);
      setCurrentTrack(playlist[nextIdx]);
      return;
    }

    const nextIdx = currentPlaylistIndex + 1;
    if (nextIdx < playlist.length) {
      setCurrentPlaylistIndex(nextIdx);
      setCurrentTrack(playlist[nextIdx]);
    } else if (repeatMode === "all") {
      setCurrentPlaylistIndex(0);
      setCurrentTrack(playlist[0]);
    } else {
      setIsPlaying(false);
    }
  }, [playlist, currentPlaylistIndex, isShuffle, repeatMode]);

  // 이전 곡 재생
  const handlePrevTrack = () => {
    if (isIOSNativeAudio) {
      if (currentTimeRef.current > 3) {
        currentTimeRef.current = 0;
        setCurrentTime(0);
        KboAudioPlayer.seekTo({ time: 0 }).catch(() => { });
        return;
      }
      if (playlist.length === 0) return;

      const prevIdx = currentPlaylistIndex - 1;
      if (prevIdx >= 0) {
        setCurrentPlaylistIndex(prevIdx);
        setCurrentTrack(playlist[prevIdx]);
      } else if (repeatMode === "all") {
        const lastIdx = playlist.length - 1;
        setCurrentPlaylistIndex(lastIdx);
        setCurrentTrack(playlist[lastIdx]);
      } else if (currentPlaylistIndex >= 0 && playlist[currentPlaylistIndex]) {
        currentTimeRef.current = 0;
        setCurrentTime(0);
        KboAudioPlayer.seekTo({ time: 0 }).catch(() => { });
      }
      return;
    }

    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    if (playlist.length === 0) return;

    const prevIdx = currentPlaylistIndex - 1;
    if (prevIdx >= 0) {
      setCurrentPlaylistIndex(prevIdx);
      setCurrentTrack(playlist[prevIdx]);
    } else if (repeatMode === "all") {
      const lastIdx = playlist.length - 1;
      setCurrentPlaylistIndex(lastIdx);
      setCurrentTrack(playlist[lastIdx]);
    } else if (currentPlaylistIndex >= 0 && playlist[currentPlaylistIndex]) {
      if (audio) audio.currentTime = 0;
    }
  };

  // 오디오 종료 이벤트
  const handleAudioEnded = () => {
    if (repeatMode === "one") {
      if (isIOSNativeAudio) {
        currentTimeRef.current = 0;
        setCurrentTime(0);
        KboAudioPlayer.seekTo({ time: 0 })
          .then(() => KboAudioPlayer.play())
          .catch(() => { });
        return;
      }
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch(() => { });
      }
      return;
    }
    if (playlist.length > 0 && currentPlaylistIndex !== -1) {
      handleNextTrack();
    } else {
      setIsPlaying(false);
    }
  };

  // 오디오 에러 발생 시 (없는 등장곡 등) 플레이리스트 재생 중이면 다음 곡으로 자동 스킵
  const handleAudioError = () => {
    if (playlist.length > 0 && currentPlaylistIndex !== -1) {
      handleNextTrack();
    } else {
      setIsPlaying(false);
      showToast("음원 파일을 불러올 수 없습니다.");
    }
  };

  audioEndedRef.current = handleAudioEnded;
  audioErrorRef.current = handleAudioError;

  // 네이티브 잠금화면 / 제어센터 / 알림창 미디어 버튼 최신 콜백 유지
  mediaActionsRef.current = {
    onPlay: () => {
      const audio = audioRef.current;
      if (!audio) return;
      if (!currentTrack && playlist.length > 0) {
        setCurrentPlaylistIndex(0);
        setCurrentTrack(playlist[0]);
        return;
      }
      audio.play().catch(() => { });
    },
    onPause: () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    },
    onPreviousTrack: () => {
      handlePrevTrack();
    },
    onNextTrack: () => {
      handleNextTrack();
    },
    onSeekTo: (seekTime) => {
      const audio = audioRef.current;
      if (!audio || typeof seekTime !== "number" || !Number.isFinite(seekTime)) return;
      const maxDuration = Number.isFinite(audio.duration) ? audio.duration : seekTime;
      const clamped = Math.max(0, Math.min(seekTime, maxDuration));
      audio.currentTime = clamped;
      setCurrentTime(clamped);
      updateMediaSessionPositionState({
        duration: audio.duration,
        position: clamped,
        playbackRate: audio.paused ? 0.0 : audio.playbackRate || 1.0,
      });
    },
    onSeekBy: (deltaSec) => {
      const audio = audioRef.current;
      if (!audio || !Number.isFinite(audio.duration)) return;
      const nextTime = Math.max(0, Math.min(audio.currentTime + deltaSec, audio.duration));
      audio.currentTime = nextTime;
      setCurrentTime(nextTime);
      updateMediaSessionPositionState({
        duration: audio.duration,
        position: nextTime,
        playbackRate: audio.paused ? 0.0 : audio.playbackRate || 1.0,
      });
    },
    onStop: () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
      setCurrentTime(0);
      setIsPlaying(false);
      updateMediaSessionPlaybackState("none");
    },
  };

  // Android 하드웨어 뒤로가기 버튼 최신 상태 콜백 유지
  backButtonRef.current = () => {
    if (isMobileSheetOpen) {
      setIsMobileSheetOpen(false);
      return true;
    }
    if (isTeamDropdownOpen) {
      setIsTeamDropdownOpen(false);
      return true;
    }
    if (searchQuery.trim().length > 0) {
      setSearchQuery("");
      return true;
    }
    if (selectedTeam) {
      setSelectedTeam("");
      return true;
    }
    return false;
  };

  // 즉시 재생 핸들러
  const handlePlayTrackImmediate = (track) => {
    const existingIdx = playlist.findIndex((item) => item.trackKey === track.trackKey);
    if (existingIdx !== -1) {
      setCurrentPlaylistIndex(existingIdx);
      setCurrentTrack(playlist[existingIdx]);
    } else {
      setCurrentPlaylistIndex(-1);
      setCurrentTrack(track);
    }
  };

  // 플레이리스트에 단일 트랙 추가 핸들러
  const handleAddTrackToPlaylist = (track) => {
    setPlaylist((prev) => {
      const next = [...prev, track];
      if (!currentTrack) {
        setCurrentPlaylistIndex(next.length - 1);
        setCurrentTrack(track);
      }
      return next;
    });
    showToast(`플레이리스트에 추가됨: ${track.title} (${track.typeLabel})`);
  };

  // 구단 전체 재생 핸들러
  const handlePlayTeamAll = () => {
    if (!selectedTeam || !activeDataMap[selectedTeam]) return;
    const teamData = activeDataMap[selectedTeam];
    const allTracks = [];
    teamData.songs.forEach((song) => {
      allTracks.push(...buildTracksForSong(song, selectedTeam, teamData, activeCategory));
    });
    if (allTracks.length === 0) return;
    setPlaylist(allTracks);
    setCurrentPlaylistIndex(0);
    setCurrentTrack(allTracks[0]);
    showToast(`${selectedTeam} 전체 ${allTracks.length}곡 재생을 시작합니다.`);
  };

  // 구단 전체 플레이리스트에 추가 핸들러
  const handleAddTeamAllToPlaylist = () => {
    if (!selectedTeam || !activeDataMap[selectedTeam]) return;
    const teamData = activeDataMap[selectedTeam];
    const allTracks = [];
    teamData.songs.forEach((song) => {
      allTracks.push(...buildTracksForSong(song, selectedTeam, teamData, activeCategory));
    });
    if (allTracks.length === 0) return;
    setPlaylist((prev) => {
      const next = [...prev, ...allTracks];
      if (!currentTrack && next.length > 0) {
        setCurrentPlaylistIndex(0);
        setCurrentTrack(next[0]);
      }
      return next;
    });
    showToast(`${selectedTeam} ${allTracks.length}곡이 플레이리스트에 추가되었습니다.`);
  };

  // 플레이리스트 내 특정 곡 클릭 재생
  const handleSelectPlaylistItem = (index) => {
    if (index < 0 || index >= playlist.length) return;
    setCurrentPlaylistIndex(index);
    setCurrentTrack(playlist[index]);
  };

  // 플레이리스트에서 특정 곡 삭제
  const handleRemovePlaylistItem = (index, e) => {
    e.stopPropagation();
    setPlaylist((prev) => {
      const next = prev.filter((_, idx) => idx !== index);
      if (index === currentPlaylistIndex) {
        if (next.length === 0) {
          setCurrentPlaylistIndex(-1);
        } else if (index < next.length) {
          setCurrentTrack(next[index]);
        } else {
          setCurrentPlaylistIndex(next.length - 1);
          setCurrentTrack(next[next.length - 1]);
        }
      } else if (index < currentPlaylistIndex) {
        setCurrentPlaylistIndex((c) => c - 1);
      }
      return next;
    });
  };

  // 플레이리스트 순서 이동
  const handleMovePlaylistItem = (index, direction, e) => {
    e.stopPropagation();
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= playlist.length) return;
    setPlaylist((prev) => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return next;
    });
    if (currentPlaylistIndex === index) {
      setCurrentPlaylistIndex(targetIndex);
    } else if (currentPlaylistIndex === targetIndex) {
      setCurrentPlaylistIndex(index);
    }
  };

  // 플레이리스트 전체 비우기
  const handleClearPlaylist = () => {
    setPlaylist([]);
    setCurrentPlaylistIndex(-1);
    showToast("플레이리스트를 비웠습니다.");
  };

  // 반복 모드 변경
  const cycleRepeatMode = () => {
    setRepeatMode((prev) => {
      if (prev === "none") return "all";
      if (prev === "all") return "one";
      return "none";
    });
  };

  // 통합 검색 결과 계산 (현재 응원가 + 추억의 응원가)
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return { all: [], current: [], memories: [] };

    const currentMatches = [];
    Object.entries(currentCheerSongs).forEach(([teamName, teamData]) => {
      teamData.songs.forEach((song) => {
        if (song.title.toLowerCase().includes(q)) {
          currentMatches.push({
            song,
            teamName,
            teamData,
            category: "current",
          });
        }
      });
    });

    const memoriesMatches = [];
    Object.entries(oldCheerSongs).forEach(([teamName, teamData]) => {
      teamData.songs.forEach((song) => {
        if (song.title.toLowerCase().includes(q)) {
          memoriesMatches.push({
            song,
            teamName,
            teamData,
            category: "memories",
          });
        }
      });
    });

    return {
      all: [...currentMatches, ...memoriesMatches],
      current: currentMatches,
      memories: memoriesMatches,
    };
  }, [searchQuery, currentCheerSongs, oldCheerSongs]);

  const displayedSearchResults =
    searchScope === "current"
      ? searchResults.current
      : searchScope === "memories"
        ? searchResults.memories
        : searchResults.all;

  const isSearching = searchQuery.trim().length > 0;

  // 플레이어 컨트롤 UI 렌더링 함수 (데스크톱 & 모바일 시트 공용)
  const renderPlayerCard = () => {
    if (!currentTrack) {
      return (
        <div className="bg-white/80 backdrop-blur rounded-2xl shadow-md border border-gray-200 p-8 text-center text-gray-500">
          <div className="text-4xl mb-3">⚾</div>
          <p className="font-bold text-gray-700 text-base">현재 재생 중인 응원가가 없습니다</p>
          <p className="text-xs text-gray-500 mt-1">
            좌측에서 팀을 선택하거나 선수를 검색하여 응원가를 재생해 보세요!
          </p>
        </div>
      );
    }

    return (
      <div
        className="shadow-xl rounded-2xl p-5 md:p-6 w-full text-white relative overflow-hidden transition-colors duration-300"
        style={{
          background: `linear-gradient(135deg, ${currentTrack.teamColor1} 0%, ${currentTrack.teamColor2} 100%)`,
        }}
      >
        {/* 배경 워터마크 팀 로고 */}
        <img
          src={currentTrack.teamLogo}
          alt=""
          className="absolute -right-10 top-1/2 -translate-y-1/2 w-72 h-72 opacity-15 pointer-events-none select-none"
        />

        {/* 상단 선수 정보 영역 */}
        <div className="relative z-10 flex items-center gap-4 mb-4">
          <div className="w-20 h-24 md:w-24 md:h-28 rounded-2xl overflow-hidden flex-shrink-0 bg-white/20 border-2 border-white/30 shadow-md">
            <img
              src={currentTrack.profileSrc}
              alt={`${currentTrack.title} 프로필`}
              className="w-full h-full object-cover"
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap mb-1">
              <span className="inline-flex items-center gap-1 text-xs font-bold bg-black/30 px-2.5 py-0.5 rounded-full">
                <img
                  src={currentTrack.teamLogo}
                  alt={currentTrack.teamName}
                  className="w-3.5 h-3.5 object-contain"
                />
                {currentTrack.teamName}
              </span>
              <span className="text-xs font-bold bg-white/20 px-2 py-0.5 rounded-full">
                {currentTrack.category === "current" ? "현재" : "추억"} · {currentTrack.typeLabel}
              </span>
            </div>

            <h2 className="text-xl md:text-2xl font-extrabold truncate">
              {currentTrack.title}
            </h2>

            {currentTrack.misc && (
              <p className="text-xs text-white/85 mt-1 font-medium bg-black/20 inline-block px-2 py-0.5 rounded-lg">
                {currentTrack.misc}
              </p>
            )}
          </div>
        </div>

        {/* 오디오 진행바 (Seek Bar) */}
        <div className="relative z-10 mb-3">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(currentTime, duration || 0)}
            onChange={(e) => {
              const val = Number(e.target.value);
              currentTimeRef.current = val;
              setCurrentTime(val);
              if (isIOSNativeAudio) {
                KboAudioPlayer.seekTo({ time: val }).catch(() => { });
              } else if (audioRef.current) {
                audioRef.current.currentTime = val;
              }
            }}
            className="w-full h-1.5 bg-white/30 rounded-lg appearance-none cursor-pointer accent-white"
          />
          <div className="flex justify-between text-[11px] text-white/80 mt-1 font-mono">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* 재생 컨트롤 버튼 바 */}
        <div className="relative z-10 flex items-center justify-between gap-2 mb-4 bg-black/25 rounded-xl px-3 py-2">
          <button
            type="button"
            onClick={() => setIsShuffle(!isShuffle)}
            className={`px-2 py-1 rounded-lg text-xs font-bold transition-colors ${isShuffle ? "bg-white text-black" : "text-white/75 hover:text-white"
              }`}
            title="셔플 재생"
          >
            🔀 셔플
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handlePrevTrack}
              className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/30 flex items-center justify-center text-sm font-bold transition-colors"
              title="이전 곡"
            >
              ⏮
            </button>
            <button
              type="button"
              onClick={togglePlayPause}
              className="w-11 h-11 rounded-full bg-white text-gray-900 hover:scale-105 active:scale-95 flex items-center justify-center text-base font-extrabold shadow transition-transform"
              title={isPlaying ? "일시정지" : "재생"}
            >
              {isPlaying ? "⏸" : "▶"}
            </button>
            <button
              type="button"
              onClick={handleNextTrack}
              className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/30 flex items-center justify-center text-sm font-bold transition-colors"
              title="다음 곡"
            >
              ⏭
            </button>
          </div>

          <button
            type="button"
            onClick={cycleRepeatMode}
            className={`px-2 py-1 rounded-lg text-xs font-bold transition-colors ${repeatMode !== "none" ? "bg-white text-black" : "text-white/75 hover:text-white"
              }`}
            title="반복 설정"
          >
            {repeatMode === "one" ? "🔂 한곡" : repeatMode === "all" ? "🔁 전체" : "🔁 끔"}
          </button>
        </div>

        {/* 가사 표시 영역 */}
        {currentTrack.type === "cheer" ? (
          <div className="relative z-10 bg-black/25 rounded-xl p-4 max-h-60 overflow-y-auto">
            <div className="text-xs font-bold uppercase tracking-wider text-white/70 mb-2 text-center">
              가사
            </div>
            <p className="text-sm md:text-base italic whitespace-pre-wrap leading-relaxed text-center font-medium">
              {currentTrack.lyrics || "등록된 가사가 없습니다."}
            </p>
          </div>
        ) : (
          <div className="relative z-10 bg-black/25 rounded-xl p-4 text-center text-sm text-white/85">
            🎵 선수 등장곡 재생 중입니다.
          </div>
        )}
      </div>
    );
  };

  // 플레이리스트 패널 렌더링 함수 (데스크톱 & 모바일 시트 공용)
  const renderPlaylistPanel = () => {
    return (
      <div className="bg-white rounded-2xl shadow-md border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold text-gray-800 text-sm md:text-base">
              재생 플레이리스트
            </span>
            <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {playlist.length}
            </span>
          </div>
          {playlist.length > 0 && (
            <button
              type="button"
              onClick={handleClearPlaylist}
              className="text-xs font-semibold text-red-600 hover:text-red-700 hover:underline"
            >
              전체 비우기
            </button>
          )}
        </div>

        {playlist.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-xs md:text-sm">
            곡 버튼 우측의 <strong>+</strong> 버튼이나 <strong>전체 담기</strong>를 눌러 원하는 응원가와 등장곡을 담아보세요!
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto divide-y divide-gray-100">
            {playlist.map((item, idx) => {
              const isCurrent = idx === currentPlaylistIndex;
              return (
                <div
                  key={item.uid || `${item.trackKey}-${idx}`}
                  onClick={() => handleSelectPlaylistItem(idx)}
                  className={`px-3.5 py-2.5 flex items-center justify-between gap-2 cursor-pointer transition-colors ${isCurrent ? "bg-red-50/90" : "hover:bg-gray-50"
                    }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span
                      className={`text-xs font-bold w-5 text-center flex-shrink-0 ${isCurrent ? "text-red-600" : "text-gray-400"
                        }`}
                    >
                      {isCurrent ? "🔊" : idx + 1}
                    </span>
                    <img
                      src={item.teamLogo}
                      alt={item.teamName}
                      className="w-5 h-5 object-contain flex-shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-xs md:text-sm truncate ${isCurrent ? "font-extrabold text-red-600" : "font-semibold text-gray-800"
                            }`}
                        >
                          {item.title}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-semibold flex-shrink-0">
                          {item.typeLabel}
                        </span>
                        {item.category === "memories" && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold flex-shrink-0">
                            추억
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-400 truncate">{item.teamName}</p>
                    </div>
                  </div>

                  {/* 순서 변경 및 삭제 버튼 */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={(e) => handleMovePlaylistItem(idx, -1, e)}
                      disabled={idx === 0}
                      className="w-6 h-6 rounded hover:bg-gray-200 disabled:opacity-30 text-gray-500 text-xs flex items-center justify-center"
                      title="위로 이동"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleMovePlaylistItem(idx, 1, e)}
                      disabled={idx === playlist.length - 1}
                      className="w-6 h-6 rounded hover:bg-gray-200 disabled:opacity-30 text-gray-500 text-xs flex items-center justify-center"
                      title="아래로 이동"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleRemovePlaylistItem(idx, e)}
                      className="w-6 h-6 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 text-xs flex items-center justify-center font-bold"
                      title="삭제"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-gray-100 safe-page-bottom">
      {/* 단일 전역 오디오 엘리먼트 (탭 전환이나 화면 크기 변경에도 끊기지 않음) */}
      <audio
        ref={audioRef}
        playsInline
        preload="auto"
        onTimeUpdate={() => {
          const audio = audioRef.current;
          if (!audio) return;
          setCurrentTime(audio.currentTime);
          const now = Date.now();
          if (now - lastPositionSyncRef.current >= 1000 && Number.isFinite(audio.duration) && audio.duration > 0) {
            lastPositionSyncRef.current = now;
            updateMediaSessionPositionState({
              duration: audio.duration,
              position: audio.currentTime,
              playbackRate: audio.paused ? 0.0 : audio.playbackRate || 1.0,
            });
          }
        }}
        onLoadedMetadata={() => {
          const audio = audioRef.current;
          if (!audio) return;
          const nextDuration = audio.duration || 0;
          setDuration(nextDuration);
          if (nextDuration > 0) {
            updateMediaSessionPositionState({
              duration: nextDuration,
              position: audio.currentTime || 0,
              playbackRate: audio.paused ? 0.0 : audio.playbackRate || 1.0,
            });
          }
        }}
        onSeeked={() => {
          const audio = audioRef.current;
          if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
          lastPositionSyncRef.current = Date.now();
          updateMediaSessionPositionState({
            duration: audio.duration,
            position: audio.currentTime,
            playbackRate: audio.paused ? 0.0 : audio.playbackRate || 1.0,
          });
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={handleAudioEnded}
        onError={handleAudioError}
        className="hidden"
      />

      {/* 토스트 알림 */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed safe-toast-top left-1/2 -translate-x-1/2 z-50 bg-gray-900/95 text-white text-xs md:text-sm font-semibold px-4 py-2.5 rounded-full shadow-lg border border-white/15 whitespace-nowrap"
          >
            {toastMessage}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 상단 고정 헤더 */}
      <header className="bg-red-600 text-white shadow-md fixed top-0 left-0 w-full z-40 safe-area-top">
        <div className="px-4 md:px-8 py-3.5 max-w-7xl mx-auto flex items-center justify-between gap-3">
          <h1
            onClick={() => {
              setSearchQuery("");
              setIsTeamDropdownOpen(false);
            }}
            className="text-lg md:text-xl font-extrabold tracking-tight cursor-pointer flex items-center gap-2 min-w-0 truncate"
          >
            <span>⚾</span>
            <span className="truncate">프로야구 응원가 플레이어</span>
          </h1>

          {/* 현재 응원가 / 추억의 응원가 세그먼트 탭 */}
          <div className="bg-red-800/70 p-1 rounded-xl flex items-center text-xs md:text-sm font-bold flex-shrink-0">
            <button
              type="button"
              onClick={() => handleCategoryChange("current")}
              className={`px-3 py-1.5 rounded-lg transition-all ${activeCategory === "current"
                ? "bg-white text-red-600 shadow-sm"
                : "text-red-100 hover:text-white"
                }`}
            >
              현재 응원가
            </button>
            <button
              type="button"
              onClick={() => handleCategoryChange("memories")}
              className={`px-3 py-1.5 rounded-lg transition-all ${activeCategory === "memories"
                ? "bg-white text-red-600 shadow-sm"
                : "text-red-100 hover:text-white"
                }`}
            >
              추억의 응원가
            </button>
          </div>
        </div>
      </header>

      {/* 메인 컨텐츠 - 데스크톱 좌우 2단 분할 */}
      <main className="safe-main-top px-4 md:px-8 max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* 왼쪽 컬럼: 검색 + 팀 선택 + 선수 응원가 리스트 */}
        <div className="md:col-span-7 lg:col-span-7 space-y-5">
          {/* 컨트롤 박스: 통합 선수 검색 + 구단 선택 드롭다운 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 space-y-3">
            {/* 선수 검색 입력창 */}
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                🔍
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="선수 이름 또는 등번호 검색 (현재·추억의 응원가 통합)"
                className="w-full pl-9 pr-9 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-bold bg-gray-200 rounded-full w-5 h-5 flex items-center justify-center"
                  title="검색어 지우기"
                >
                  ✕
                </button>
              )}
            </div>

            {/* 구단 선택 드롭다운 트리거 (검색 중이 아닐 때 표시) */}
            {!isSearching && (
              <div>
                <button
                  type="button"
                  onClick={() => setIsTeamDropdownOpen(!isTeamDropdownOpen)}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 bg-white hover:bg-gray-50 cursor-pointer flex items-center justify-between transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    {selectedTeam && activeDataMap[selectedTeam] && (
                      <img
                        src={activeDataMap[selectedTeam].logo}
                        alt={selectedTeam}
                        className="w-6 h-6 object-contain"
                      />
                    )}
                    <span className="font-bold text-sm md:text-base text-gray-800">
                      {selectedTeam
                        ? `선택된 팀 : ${selectedTeam}`
                        : `${activeCategory === "current" ? "현재 응원가" : "추억의 응원가"} - 구단을 선택하세요`}
                    </span>
                  </div>
                  <span className="text-gray-500 text-xs">
                    {isTeamDropdownOpen ? "▲ 접기" : "▼ 구단 변경"}
                  </span>
                </button>

                {isTeamDropdownOpen && (
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {Object.keys(activeDataMap).map((team) => {
                      const tData = activeDataMap[team];
                      return (
                        <div
                          key={team}
                          onClick={() => {
                            setSelectedTeam(team);
                            setIsTeamDropdownOpen(false);
                          }}
                          className="p-3 flex flex-col items-center justify-center hover:scale-[1.03] active:scale-95 transition-transform rounded-xl cursor-pointer text-white shadow"
                          style={{
                            background: `linear-gradient(135deg, ${tData.teamColor1} 0%, ${tData.teamColor2} 100%)`,
                          }}
                        >
                          <img
                            src={tData.logo}
                            alt={`${team} 로고`}
                            className="w-16 h-16 object-contain mb-1.5"
                          />
                          <span className="text-xs font-bold tracking-tight">{team}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 검색 모드 화면 */}
          {isSearching ? (
            <div className="space-y-4">
              {/* 검색 범위 필터 탭 */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSearchScope("all")}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${searchScope === "all"
                      ? "bg-red-600 text-white"
                      : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
                      }`}
                  >
                    전체 ({searchResults.all.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSearchScope("current")}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${searchScope === "current"
                      ? "bg-red-600 text-white"
                      : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
                      }`}
                  >
                    현재 응원가 ({searchResults.current.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSearchScope("memories")}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${searchScope === "memories"
                      ? "bg-red-600 text-white"
                      : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
                      }`}
                  >
                    추억의 응원가 ({searchResults.memories.length})
                  </button>
                </div>
                <span className="text-xs text-gray-500">
                  &lsquo;{searchQuery}&rsquo; 검색 결과 {displayedSearchResults.length}건
                </span>
              </div>

              {displayedSearchResults.length === 0 ? (
                <div className="bg-white rounded-2xl p-10 text-center text-gray-500 border border-gray-200">
                  일치하는 선수를 찾지 못했습니다.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {displayedSearchResults.map((item, idx) => (
                    <PlayerSongCard
                      key={`${item.category}-${item.teamData.teamID}-${item.song.playerID}-${idx}`}
                      song={item.song}
                      teamName={item.teamName}
                      teamData={item.teamData}
                      category={item.category}
                      showTeamBadge={true}
                      currentTrack={currentTrack}
                      onPlayTrack={handlePlayTrackImmediate}
                      onAddTrack={handleAddTrackToPlaylist}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* 일반 구단 선택 모드 화면 */
            <>
              {!selectedTeam && !isTeamDropdownOpen && (
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
                  <h2 className="text-base font-bold text-gray-800 mb-4 text-center">
                    구단을 선택해 주세요 ({activeCategory === "current" ? "현재 응원가" : "추억의 응원가"})
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {Object.keys(activeDataMap).map((team) => {
                      const tData = activeDataMap[team];
                      return (
                        <div
                          key={team}
                          onClick={() => setSelectedTeam(team)}
                          className="p-4 flex flex-col items-center justify-center hover:scale-[1.03] active:scale-95 transition-transform rounded-xl cursor-pointer text-white shadow"
                          style={{
                            background: `linear-gradient(135deg, ${tData.teamColor1} 0%, ${tData.teamColor2} 100%)`,
                          }}
                        >
                          <img
                            src={tData.logo}
                            alt={`${team} 로고`}
                            className="w-16 h-16 object-contain mb-2"
                          />
                          <span className="text-xs md:text-sm font-bold">{team}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {selectedTeam && activeDataMap[selectedTeam] && (
                <div className="space-y-4">
                  {/* 선택된 구단 배너 & 전체 재생/담기 액션 */}
                  <div
                    className="rounded-2xl p-5 text-white shadow-md flex flex-col sm:flex-row items-center justify-between gap-4"
                    style={{
                      background: `linear-gradient(135deg, ${activeDataMap[selectedTeam].teamColor1} 0%, ${activeDataMap[selectedTeam].teamColor2} 100%)`,
                    }}
                  >
                    <div className="flex items-center gap-4">
                      <img
                        src={activeDataMap[selectedTeam].logo}
                        alt={`${selectedTeam} 로고`}
                        className="w-16 h-16 object-contain drop-shadow"
                      />
                      <div>
                        <span className="text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-white/20">
                          {activeCategory === "current" ? "현재 응원가" : "추억의 응원가"}
                        </span>
                        <h2 className="text-2xl font-extrabold mt-1">{selectedTeam}</h2>
                        <p className="text-xs text-white/80">
                          등록 선수 {activeDataMap[selectedTeam].songs.length}명
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap justify-center">
                      <button
                        type="button"
                        onClick={handlePlayTeamAll}
                        className="px-4 py-2 rounded-xl bg-white text-gray-900 font-bold text-xs md:text-sm shadow hover:bg-gray-100 active:scale-95 transition-all"
                      >
                        ▶ 팀 전체 재생
                      </button>
                      <button
                        type="button"
                        onClick={handleAddTeamAllToPlaylist}
                        className="px-3.5 py-2 rounded-xl bg-black/30 hover:bg-black/45 text-white font-bold text-xs md:text-sm border border-white/25 active:scale-95 transition-all"
                      >
                        + 팀 전체 담기
                      </button>
                    </div>
                  </div>

                  {/* 선수 카드 리스트 */}
                  <div
                    className={`grid gap-3 ${activeCategory === "memories"
                      ? "grid-cols-1 sm:grid-cols-2"
                      : "grid-cols-1"
                      }`}
                  >
                    {activeDataMap[selectedTeam].songs.map((song, index) => (
                      <motion.div
                        key={`${selectedTeam}-${song.playerID}-${index}`}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, delay: Math.min(index * 0.015, 0.3) }}
                      >
                        <PlayerSongCard
                          song={song}
                          teamName={selectedTeam}
                          teamData={activeDataMap[selectedTeam]}
                          category={activeCategory}
                          showTeamBadge={false}
                          currentTrack={currentTrack}
                          onPlayTrack={handlePlayTrackImmediate}
                          onAddTrack={handleAddTrackToPlaylist}
                        />
                      </motion.div>
                    ))}
                  </div>

                  {activeCategory === "memories" && (
                    <p className="text-xs text-center text-gray-500 py-3 font-medium">
                      선수 정렬은 가나다 순이며, 이적·은퇴가 아닌 단순 응원가 교체 또는 군입대한 선수는 상단에 배치되어 있습니다.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* 오른쪽 컬럼 (데스크톱 전용 Sticky 영역): 플레이어 + 플레이리스트 */}
        <div className="hidden md:block md:col-span-5 lg:col-span-5">
          <div className="sticky top-24 space-y-4">
            {renderPlayerCard()}
            {renderPlaylistPanel()}
          </div>
        </div>
      </main>

      {/* 모바일 전용 하단 미니 플레이어 바 (화면의 40%를 차지하던 기존 상단 고정 플레이어 대체) */}
      {(currentTrack || playlist.length > 0) && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-gray-900/95 backdrop-blur-md text-white shadow-2xl border-t border-white/15 safe-area-bottom">
          {/* 상단 미니 진행 상태바 */}
          <div className="w-full h-1 bg-white/15 overflow-hidden">
            <div
              className="h-full bg-red-500 transition-all duration-200"
              style={{
                width: duration > 0 ? `${Math.min(100, (currentTime / duration) * 100)}%` : "0%",
              }}
            />
          </div>

          <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
            {/* 좌측 클릭 시 상세 바텀 시트 열기 */}
            <div
              onClick={() => {
                setMobileTab("player");
                setIsMobileSheetOpen(true);
              }}
              className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
            >
              {currentTrack ? (
                <>
                  <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 border border-white/30 bg-white/10">
                    <img
                      src={currentTrack.profileSrc}
                      alt={currentTrack.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold truncate">{currentTrack.title}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/20 font-semibold flex-shrink-0">
                        {currentTrack.typeLabel}
                      </span>
                    </div>
                    <p className="text-xs text-gray-300 truncate">
                      {currentTrack.teamName} · 터치하여 가사/상세 보기
                    </p>
                  </div>
                </>
              ) : (
                <div className="text-xs text-gray-300 py-1">
                  플레이리스트에 {playlist.length}곡이 담겨 있습니다 (터치하여 열기)
                </div>
              )}
            </div>

            {/* 우측 미니 컨트롤 버튼들 */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                type="button"
                onClick={togglePlayPause}
                className="w-9 h-9 rounded-full bg-white text-gray-900 flex items-center justify-center font-bold text-sm shadow"
                title={isPlaying ? "일시정지" : "재생"}
              >
                {isPlaying ? "⏸" : "▶"}
              </button>
              <button
                type="button"
                onClick={handleNextTrack}
                className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-xs"
                title="다음 곡"
              >
                ⏭
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileTab("playlist");
                  setIsMobileSheetOpen(true);
                }}
                className="px-2.5 h-8 rounded-full bg-white/15 hover:bg-white/25 flex items-center gap-1 text-xs font-bold"
                title="플레이리스트 열기"
              >
                <span>☰</span>
                <span>{playlist.length}</span>
              </button>
              <button
                type="button"
                onClick={() => setIsMobileSheetOpen(true)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-xs"
                title="플레이어 펼치기"
              >
                ▲
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 모바일 전용 확장 바텀 시트 (플레이어 가사 & 플레이리스트) */}
      <AnimatePresence>
        {isMobileSheetOpen && (
          <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
            {/* 반투명 배경 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileSheetOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-xs"
            />

            {/* 시트 본문 */}
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              className="relative z-10 bg-gray-100 rounded-t-3xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl"
            >
              {/* 시트 헤더 (탭 전환 + 접기 버튼) */}
              <div className="bg-white px-4 pt-3 pb-2.5 border-b border-gray-200 flex items-center justify-between">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMobileTab("player")}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${mobileTab === "player"
                      ? "bg-red-600 text-white"
                      : "bg-gray-100 text-gray-600"
                      }`}
                  >
                    현재 재생 / 가사
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobileTab("playlist")}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${mobileTab === "playlist"
                      ? "bg-red-600 text-white"
                      : "bg-gray-100 text-gray-600"
                      }`}
                  >
                    플레이리스트 ({playlist.length})
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setIsMobileSheetOpen(false)}
                  className="px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold flex items-center gap-1"
                >
                  <span>▼</span>
                  <span>접기</span>
                </button>
              </div>

              {/* 시트 내부 스크롤 컨텐츠 */}
              <div className="p-4 overflow-y-auto space-y-4 safe-area-bottom">
                {mobileTab === "player" ? renderPlayerCard() : renderPlaylistPanel()}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;
