import AVFoundation
import Foundation
import Speech

struct Output: Encodable {
  let type: String
  let text: String?
  let error: String?
  let level: Double?

  init(type: String, text: String?, error: String?, level: Double? = nil) {
    self.type = type
    self.text = text
    self.error = error
    self.level = level
  }
}

final class VoiceAgent {
  private let engine = AVAudioEngine()
  private var recognizer: SFSpeechRecognizer?
  private var request = SFSpeechAudioBufferRecognitionRequest()
  private var task: SFSpeechRecognitionTask?
  private var latest = ""
  private var endpointTimer: Timer?
  private var lastSpeechAt = Date.distantPast
  private var speechStarted = false
  private var endingAudio = false
  private var finished = false
  private var tapInstalled = false
  private var retryAttempted = false
  private var taskGeneration = 0
  private var lastLevelAt = Date.distantPast
  private var pcmSampleRate = 16_000.0
  private var pcmRemainder = Data()

  func start(locale: String) {
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)), recognizer.isAvailable else {
      finish(error: "Speech recognition is unavailable for \(locale).")
      return
    }

    self.recognizer = recognizer
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    input.installTap(onBus: 0, bufferSize: 1_024, format: format) { [weak self] buffer, _ in
      guard let self else { return }
      request.append(buffer)
      reportLevel(buffer)
    }
    tapInstalled = true
    startRecognitionTask(requiresOnDevice: recognizer.supportsOnDeviceRecognition)

    do {
      engine.prepare()
      try engine.start()
      emit(Output(type: "listening", text: nil, error: nil))
      startEndpointMonitor()
    } catch {
      finish(error: errorDescription(error))
    }
  }

  func startPCM(locale: String, sampleRate: Double) {
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)), recognizer.isAvailable else {
      finish(error: "Speech recognition is unavailable for \(locale).")
      return
    }
    self.recognizer = recognizer
    pcmSampleRate = sampleRate
    startRecognitionTask(requiresOnDevice: recognizer.supportsOnDeviceRecognition)
    emit(Output(type: "listening", text: nil, error: nil))
    FileHandle.standardInput.readabilityHandler = { [weak self] handle in
      guard let self else { return }
      let data = handle.availableData
      if data.isEmpty {
        DispatchQueue.main.async { self.endPCMInput() }
        return
      }
      appendPCM(data)
    }
  }

  private func appendPCM(_ data: Data) {
    pcmRemainder.append(data)
    let byteCount = pcmRemainder.count - pcmRemainder.count % 2
    guard byteCount > 0,
          let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: pcmSampleRate, channels: 1, interleaved: true),
          let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(byteCount / 2)),
          let samples = buffer.int16ChannelData?[0] else { return }
    pcmRemainder.prefix(byteCount).withUnsafeBytes { bytes in
      guard let source = bytes.baseAddress else { return }
      memcpy(samples, source, byteCount)
    }
    buffer.frameLength = buffer.frameCapacity
    request.append(buffer)
    pcmRemainder.removeFirst(byteCount)
  }

  private func endPCMInput() {
    guard !finished, !endingAudio else { return }
    endingAudio = true
    FileHandle.standardInput.readabilityHandler = nil
    request.endAudio()
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.finish() }
  }

  private func startRecognitionTask(requiresOnDevice: Bool) {
    guard let recognizer else {
      finish(error: "Speech recognizer was not initialized.")
      return
    }
    taskGeneration += 1
    let generation = taskGeneration
    request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    request.requiresOnDeviceRecognition = requiresOnDevice
    request.taskHint = .dictation
    if #available(macOS 13.0, *) { request.addsPunctuation = true }
    task = recognizer.recognitionTask(with: request) { [weak self] result, error in
      guard let self, generation == taskGeneration else { return }
      if let result {
        latest = result.bestTranscription.formattedString
        DispatchQueue.main.async { [weak self] in self?.markSpeechActivity() }
        if !result.isFinal { emit(Output(type: "partial", text: latest, error: nil)) }
        if result.isFinal { finish() }
        return
      }
      guard let error else { return }
      handleRecognitionError(error, requiresOnDevice: requiresOnDevice)
    }
  }

  private func handleRecognitionError(_ error: Error, requiresOnDevice: Bool) {
    if !latest.isEmpty {
      finish()
      return
    }
    if !retryAttempted {
      retryAttempted = true
      taskGeneration += 1
      task?.cancel()
      task = nil
      request.endAudio()
      emit(Output(type: "retrying", text: nil, error: errorDescription(error)))
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { [weak self] in
        guard let self, !finished else { return }
        startRecognitionTask(requiresOnDevice: false)
      }
      return
    }
    finish(error: errorDescription(error))
  }

  private func startEndpointMonitor() {
    endpointTimer?.invalidate()
    let listeningStartedAt = Date()
    endpointTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
      guard let self, !finished, !endingAudio else { return }
      let now = Date()
      if !speechStarted {
        if now.timeIntervalSince(listeningStartedAt) >= 12 { endAudioInput() }
        return
      }
      let delay = endpointDelay()
      if now.timeIntervalSince(lastSpeechAt) >= delay { endAudioInput() }
    }
  }

  private func markSpeechActivity() {
    guard !finished, !endingAudio else { return }
    speechStarted = true
    lastSpeechAt = Date()
  }

  private func endpointDelay() -> TimeInterval {
    let text = latest.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return 2.8 }
    if let last = text.last, ".?!…".contains(last) { return 1.65 }
    if text.split(whereSeparator: { $0.isWhitespace }).count <= 3 { return 3.2 }
    return 2.35
  }

  private func endAudioInput() {
    guard !finished, !endingAudio else { return }
    endingAudio = true
    endpointTimer?.invalidate()
    endpointTimer = nil
    if engine.isRunning { engine.stop() }
    removeTap()
    request.endAudio()
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.finish() }
  }

  private func finish(error: String? = nil) {
    guard !finished else { return }
    finished = true
    endpointTimer?.invalidate()
    endpointTimer = nil
    if engine.isRunning { engine.stop() }
    FileHandle.standardInput.readabilityHandler = nil
    removeTap()
    task?.cancel()
    if let error {
      emit(Output(type: "error", text: nil, error: error))
      exit(1)
    }
    if !latest.isEmpty { emit(Output(type: "final", text: latest, error: nil)) }
    exit(0)
  }

  private func removeTap() {
    guard tapInstalled else { return }
    engine.inputNode.removeTap(onBus: 0)
    tapInstalled = false
  }

  private func reportLevel(_ buffer: AVAudioPCMBuffer) {
    let now = Date()
    guard now.timeIntervalSince(lastLevelAt) >= 0.08 else { return }
    lastLevelAt = now
    guard let samples = buffer.floatChannelData?[0] else { return }
    let count = Int(buffer.frameLength)
    guard count > 0 else { return }
    let stride = 8
    var sum = 0.0
    var sampled = 0
    for index in Swift.stride(from: 0, to: count, by: stride) {
      let value = Double(samples[index])
      sum += value * value
      sampled += 1
    }
    let decibels = 20 * log10(max(sqrt(sum / Double(sampled)), 0.0001))
    let level = min(1, max(0, (decibels + 52) / 52))
    DispatchQueue.main.async {
      emit(Output(type: "level", text: nil, error: nil, level: level))
      if decibels >= -50 { self.markSpeechActivity() }
    }
  }
}

func errorDescription(_ error: Error) -> String {
  let value = error as NSError
  return "\(value.localizedDescription) [\(value.domain) \(value.code)]"
}

func emit(_ output: Output) {
  guard let data = try? JSONEncoder().encode(output), let line = String(data: data, encoding: .utf8) else { return }
  print(line)
  fflush(stdout)
}

func requestPermissions(_ completion: @escaping (Bool) -> Void) {
  SFSpeechRecognizer.requestAuthorization { status in
    guard status == .authorized else {
      emit(Output(type: "error", text: nil, error: "Speech recognition permission is \(status.rawValue)."))
      exit(2)
    }
    AVCaptureDevice.requestAccess(for: .audio) { granted in
      DispatchQueue.main.async { completion(granted) }
    }
  }
}

func requestSpeechPermission(_ completion: @escaping (Bool) -> Void) {
  SFSpeechRecognizer.requestAuthorization { status in
    DispatchQueue.main.async { completion(status == .authorized) }
  }
}

let arguments = Array(CommandLine.arguments.dropFirst())
let stdinPCM = arguments.first == "--stdin-pcm"
let locale = stdinPCM ? (arguments.dropFirst().first ?? "en-US") : (arguments.first ?? "en-US")
let sampleRate = stdinPCM ? (Double(arguments.dropFirst(2).first ?? "16000") ?? 16_000) : 16_000
let agent = VoiceAgent()
if stdinPCM {
  requestSpeechPermission { granted in
    guard granted else {
      emit(Output(type: "error", text: nil, error: "Speech recognition permission was denied."))
      exit(2)
    }
    agent.startPCM(locale: locale, sampleRate: sampleRate)
  }
} else {
  requestPermissions { granted in
    guard granted else {
      emit(Output(type: "error", text: nil, error: "Microphone permission was denied."))
      exit(3)
    }
    agent.start(locale: locale)
  }
}
RunLoop.main.run()
