import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";

// 모바일 네이티브 환경(iOS / Android) 초기 설정
export async function initNativeAppUI() {
  if (!Capacitor.isNativePlatform()) return;

  const platform = Capacitor.getPlatform();

  try {
    // 어두운(빨간) 헤더 배경에 맞춘 흰색 상태바 텍스트/아이콘
    await StatusBar.setStyle({ style: Style.Dark });

    if (platform === "android") {
      await StatusBar.setOverlaysWebView({ overlay: false });
      await StatusBar.setBackgroundColor({ color: "#dc2626" });
    }
  } catch {
    // Android 15+ 등 일부 API 제한 무시
  }

  try {
    await SplashScreen.hide();
  } catch {
    // 무시
  }
}

// Android 하드웨어 뒤로가기 버튼 핸들러 등록
export function registerNativeBackButton(onBackHandlerRef) {
  if (!Capacitor.isNativePlatform()) {
    return () => {};
  }

  let listenerHandle = null;
  let cancelled = false;

  CapApp.addListener("backButton", () => {
    const handled = onBackHandlerRef.current?.();
    if (!handled) {
      // 백그라운드 오디오 재생을 유지하기 위해 앱을 종료하지 않고 백그라운드로 최소화
      CapApp.minimizeApp().catch(() => {
        CapApp.exitApp();
      });
    }
  })
    .then((handle) => {
      if (cancelled) {
        handle.remove();
      } else {
        listenerHandle = handle;
      }
    })
    .catch(() => {});

  return () => {
    cancelled = true;
    if (listenerHandle) {
      listenerHandle.remove();
    }
  };
}
