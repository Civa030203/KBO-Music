import Foundation
import UIKit
import AVFoundation
import MediaPlayer
import Capacitor

@objc(KboAudioPlayerPlugin)
public class KboAudioPlayerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KboAudioPlayerPlugin"
    public let jsName = "KboAudioPlayer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "loadAndPlay", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seekTo", returnType: CAPPluginReturnPromise)
    ]

    private var player: AVPlayer?
    private var timeObserverToken: Any?
    private var statusObservation: NSKeyValueObservation?
    private var endObserver: NSObjectProtocol?
    private var failObserver: NSObjectProtocol?
    private var interruptionObserver: NSObjectProtocol?
    private var nowPlayingInfo: [String: Any] = [:]
    private var remoteCommandsConfigured = false
    private var currentDuration: Double = 0
    private var currentArtworkUrl: String?
    private var currentTrackToken: Int = 0

    public override func load() {
        super.load()
        configureAudioSession()
        configureRemoteCommands()
        observeAudioInterruptions()
    }

    deinit {
        cleanupObservers()
        if let interruptionObserver = interruptionObserver {
            NotificationCenter.default.removeObserver(interruptionObserver)
        }
    }

    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)
        } catch {
            print("[KboAudioPlayer] AVAudioSession setup error: \(error.localizedDescription)")
        }
    }

    private func observeAudioInterruptions() {
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] notification in
            guard let self = self,
                  let userInfo = notification.userInfo,
                  let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: typeValue) else {
                return
            }

            if type == .began {
                self.updateNowPlayingPlaybackRate(0.0)
                self.notifyListeners("playbackStateChanged", data: ["isPlaying": false])
            } else if type == .ended {
                if let optionsValue = userInfo[AVAudioSessionInterruptionOptionKey] as? UInt {
                    let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)
                    if options.contains(.shouldResume) {
                        self.configureAudioSession()
                        self.player?.play()
                        self.updateNowPlayingPlaybackRate(1.0)
                        self.notifyListeners("playbackStateChanged", data: ["isPlaying": true])
                    }
                }
            }
        }
    }

    private func configureRemoteCommands() {
        guard !remoteCommandsConfigured else { return }
        remoteCommandsConfigured = true

        DispatchQueue.main.async {
            UIApplication.shared.beginReceivingRemoteControlEvents()
            let commandCenter = MPRemoteCommandCenter.shared()

            commandCenter.playCommand.isEnabled = true
            commandCenter.playCommand.addTarget { [weak self] _ in
                guard let self = self else { return .commandFailed }
                self.configureAudioSession()
                self.player?.play()
                self.updateNowPlayingPlaybackRate(1.0)
                self.notifyListeners("playbackStateChanged", data: ["isPlaying": true])
                self.notifyListeners("remoteAction", data: ["action": "play"])
                return .success
            }

            commandCenter.pauseCommand.isEnabled = true
            commandCenter.pauseCommand.addTarget { [weak self] _ in
                guard let self = self else { return .commandFailed }
                self.player?.pause()
                self.updateNowPlayingPlaybackRate(0.0)
                self.notifyListeners("playbackStateChanged", data: ["isPlaying": false])
                self.notifyListeners("remoteAction", data: ["action": "pause"])
                return .success
            }

            commandCenter.nextTrackCommand.isEnabled = true
            commandCenter.nextTrackCommand.addTarget { [weak self] _ in
                self?.notifyListeners("remoteAction", data: ["action": "nexttrack"])
                return .success
            }

            commandCenter.previousTrackCommand.isEnabled = true
            commandCenter.previousTrackCommand.addTarget { [weak self] _ in
                self?.notifyListeners("remoteAction", data: ["action": "previoustrack"])
                return .success
            }

            commandCenter.changePlaybackPositionCommand.isEnabled = true
            commandCenter.changePlaybackPositionCommand.addTarget { [weak self] event in
                guard let self = self,
                      let positionEvent = event as? MPChangePlaybackPositionCommandEvent else {
                    return .commandFailed
                }
                let targetTime = CMTime(seconds: positionEvent.positionTime, preferredTimescale: 600)
                self.player?.seek(to: targetTime) { _ in
                    self.updateNowPlayingElapsedTime(positionEvent.positionTime)
                }
                self.notifyListeners("remoteAction", data: [
                    "action": "seekto",
                    "seekTime": positionEvent.positionTime
                ])
                return .success
            }
        }
    }

    private func cleanupObservers() {
        if let token = timeObserverToken, let player = player {
            player.removeTimeObserver(token)
            timeObserverToken = nil
        }
        statusObservation?.invalidate()
        statusObservation = nil
        if let endObserver = endObserver {
            NotificationCenter.default.removeObserver(endObserver)
            self.endObserver = nil
        }
        if let failObserver = failObserver {
            NotificationCenter.default.removeObserver(failObserver)
            self.failObserver = nil
        }
    }

    @objc func loadAndPlay(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"),
              let url = URL(string: urlString) else {
            call.reject("Invalid audio URL")
            return
        }

        let title = call.getString("title") ?? "프로야구 응원가"
        let artist = call.getString("artist") ?? "KBO"
        let album = call.getString("album") ?? "크뮤"
        let artworkUrl = call.getString("artworkUrl")

        DispatchQueue.main.async {
            self.configureAudioSession()
            self.cleanupObservers()
            self.currentDuration = 0
            self.currentTrackToken += 1
            let activeToken = self.currentTrackToken

            let item = AVPlayerItem(url: url)
            if self.player == nil {
                self.player = AVPlayer(playerItem: item)
                self.player?.automaticallyWaitsToMinimizeStalling = true
            } else {
                self.player?.replaceCurrentItem(with: item)
            }

            // 잠금화면 / 제어센터 / Dynamic Island 메타데이터 즉시 갱신
            self.nowPlayingInfo = [
                MPMediaItemPropertyTitle: title,
                MPMediaItemPropertyArtist: artist,
                MPMediaItemPropertyAlbumTitle: album,
                MPNowPlayingInfoPropertyElapsedPlaybackTime: 0.0,
                MPNowPlayingInfoPropertyPlaybackRate: 1.0,
                MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0
            ]
            MPNowPlayingInfoCenter.default().nowPlayingInfo = self.nowPlayingInfo

            if let artworkUrl = artworkUrl, artworkUrl != self.currentArtworkUrl {
                self.currentArtworkUrl = artworkUrl
                self.loadArtwork(from: artworkUrl, token: activeToken)
            }

            self.statusObservation = item.observe(\.status, options: [.new]) { [weak self] playerItem, _ in
                guard let self = self else { return }
                DispatchQueue.main.async {
                    if playerItem.status == .readyToPlay {
                        let durationSeconds = CMTimeGetSeconds(playerItem.duration)
                        if durationSeconds.isFinite && durationSeconds > 0 {
                            self.currentDuration = durationSeconds
                            self.nowPlayingInfo[MPMediaItemPropertyPlaybackDuration] = durationSeconds
                            MPNowPlayingInfoCenter.default().nowPlayingInfo = self.nowPlayingInfo
                            self.notifyListeners("loadedMetadata", data: ["duration": durationSeconds])
                        }
                    } else if playerItem.status == .failed {
                        self.updateNowPlayingPlaybackRate(0.0)
                        self.notifyListeners("playbackStateChanged", data: ["isPlaying": false])
                        self.notifyListeners("error", data: [
                            "message": playerItem.error?.localizedDescription ?? "Audio load failed"
                        ])
                    }
                }
            }

            self.endObserver = NotificationCenter.default.addObserver(
                forName: .AVPlayerItemDidPlayToEndTime,
                object: item,
                queue: .main
            ) { [weak self] _ in
                guard let self = self else { return }
                // 백그라운드에서 다음 곡 전환이 완료될 때까지 짧은 백그라운드 실행 시간 확보
                var bgTask: UIBackgroundTaskIdentifier = .invalid
                bgTask = UIApplication.shared.beginBackgroundTask(withName: "KboNextTrack") {
                    if bgTask != .invalid {
                        UIApplication.shared.endBackgroundTask(bgTask)
                        bgTask = .invalid
                    }
                }
                self.notifyListeners("ended", data: [:])
                DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
                    if bgTask != .invalid {
                        UIApplication.shared.endBackgroundTask(bgTask)
                        bgTask = .invalid
                    }
                }
            }

            self.failObserver = NotificationCenter.default.addObserver(
                forName: .AVPlayerItemFailedToPlayToEndTime,
                object: item,
                queue: .main
            ) { [weak self] _ in
                self?.notifyListeners("error", data: ["message": "Playback failed"])
            }

            let interval = CMTime(seconds: 0.5, preferredTimescale: 600)
            self.timeObserverToken = self.player?.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
                guard let self = self else { return }
                let currentSec = CMTimeGetSeconds(time)
                guard currentSec.isFinite && currentSec >= 0 else { return }

                if self.currentDuration <= 0, let duration = self.player?.currentItem?.duration {
                    let durSec = CMTimeGetSeconds(duration)
                    if durSec.isFinite && durSec > 0 {
                        self.currentDuration = durSec
                        self.nowPlayingInfo[MPMediaItemPropertyPlaybackDuration] = durSec
                        self.notifyListeners("loadedMetadata", data: ["duration": durSec])
                    }
                }

                let isPlaying = (self.player?.rate ?? 0) > 0
                self.nowPlayingInfo[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentSec
                self.nowPlayingInfo[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? 1.0 : 0.0
                MPNowPlayingInfoCenter.default().nowPlayingInfo = self.nowPlayingInfo

                self.notifyListeners("timeUpdate", data: [
                    "currentTime": currentSec,
                    "duration": self.currentDuration
                ])
            }

            self.player?.play()
            self.notifyListeners("playbackStateChanged", data: ["isPlaying": true])
            call.resolve()
        }
    }

    @objc func play(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.configureAudioSession()
            self.player?.play()
            self.updateNowPlayingPlaybackRate(1.0)
            self.notifyListeners("playbackStateChanged", data: ["isPlaying": true])
            call.resolve()
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.player?.pause()
            self.updateNowPlayingPlaybackRate(0.0)
            self.notifyListeners("playbackStateChanged", data: ["isPlaying": false])
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.player?.pause()
            self.player?.seek(to: .zero)
            self.updateNowPlayingPlaybackRate(0.0)
            self.updateNowPlayingElapsedTime(0.0)
            self.notifyListeners("playbackStateChanged", data: ["isPlaying": false])
            call.resolve()
        }
    }

    @objc func seekTo(_ call: CAPPluginCall) {
        let time = call.getDouble("time") ?? 0
        DispatchQueue.main.async {
            let target = CMTime(seconds: max(0, time), preferredTimescale: 600)
            self.player?.seek(to: target) { _ in
                self.updateNowPlayingElapsedTime(max(0, time))
            }
            call.resolve()
        }
    }

    private func updateNowPlayingPlaybackRate(_ rate: Double) {
        nowPlayingInfo[MPNowPlayingInfoPropertyPlaybackRate] = rate
        if let player = player {
            let currentSec = CMTimeGetSeconds(player.currentTime())
            if currentSec.isFinite && currentSec >= 0 {
                nowPlayingInfo[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentSec
            }
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nowPlayingInfo
    }

    private func updateNowPlayingElapsedTime(_ time: Double) {
        nowPlayingInfo[MPNowPlayingInfoPropertyElapsedPlaybackTime] = time
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nowPlayingInfo
    }

    private func loadArtwork(from urlString: String, token: Int) {
        guard let url = URL(string: urlString) else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let self = self,
                  let data = data,
                  let image = UIImage(data: data) else { return }
            DispatchQueue.main.async {
                guard self.currentTrackToken == token else { return }
                self.nowPlayingInfo[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                MPNowPlayingInfoCenter.default().nowPlayingInfo = self.nowPlayingInfo
            }
        }.resume()
    }
}
