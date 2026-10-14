// Audio-only Core Audio process tap. No microphone or screen capture APIs.
// Protocol: newline-delimited JSON on stdout; commands/EOF on stdin stop capture.
import Foundation
import CoreAudio
import AudioToolbox
import Darwin
import os

// Fixed storage: producer never allocates, waits for a lock, or writes stdout.
final class PCMQueue {
    let framesPerChunk: Int
    let capacity: Int
    private let samples: UnsafeMutablePointer<Float>
    private var lock = os_unfair_lock_s()
    private var head = 0
    private var tail = 0
    private var count = 0
    private var partial = 0
    init(frames: Int, capacity: Int = 16) {
        framesPerChunk = frames; self.capacity = capacity
        samples = .allocate(capacity: frames * capacity)
        samples.initialize(repeating: 0, count: frames * capacity)
    }
    deinit { samples.deallocate() }
    func push(_ source: UnsafePointer<Float>, frames: Int) {
        guard os_unfair_lock_trylock(&lock) else { return }
        defer { os_unfair_lock_unlock(&lock) }
        var offset = 0
        while offset < frames {
            // Drop newest data under backpressure; retain complete old packets.
            guard count < capacity else { return }
            let amount = min(frames - offset, framesPerChunk - partial)
            samples.advanced(by: tail * framesPerChunk + partial)
                .update(from: source.advanced(by: offset), count: amount)
            partial += amount; offset += amount
            if partial == framesPerChunk {
                tail = (tail + 1) % capacity; count += 1; partial = 0
            }
        }
    }
    func pop() -> Data? {
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }
        guard count > 0 else { return nil }
        let data = Data(bytes: samples.advanced(by: head * framesPerChunk),
                        count: framesPerChunk * MemoryLayout<Float>.size)
        head = (head + 1) % capacity; count -= 1
        return data
    }
}

func pcmLine(_ data: Data) -> Data {
    Data(("{\"type\":\"pcm\",\"data\":\"" + data.base64EncodedString() + "\"}\n").utf8)
}

// Serial writer has at most one pending encoded packet and a fixed-size PCM ring.
// Nonblocking writes permit shutdown even if the parent stops reading its pipe.
final class ProtocolWriter {
    private let queue = DispatchQueue(label: "audio.protocol.writer")
    private var timer: DispatchSourceTimer?
    private var pending: Data
    private var offset = 0
    private let pcm: PCMQueue?
    private let onFailure: () -> Void
    private let descriptor: Int32
    init(initial: Data, pcm: PCMQueue?, descriptor: Int32 = STDOUT_FILENO, onFailure: @escaping () -> Void) {
        pending = initial; self.pcm = pcm; self.descriptor = descriptor; self.onFailure = onFailure
    }
    func start() {
        let flags = fcntl(descriptor, F_GETFL)
        guard flags >= 0, fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) >= 0 else {
            onFailure(); return
        }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: .milliseconds(10))
        timer.setEventHandler { [weak self] in self?.drain() }
        self.timer = timer; timer.resume()
    }
    private func drain() {
        // Bound work per tick even when audio arrives faster than the reader.
        for _ in 0..<8 {
            if offset == pending.count {
                guard let data = pcm?.pop() else { return }
                pending = pcmLine(data); offset = 0
            }
            let sent = pending.withUnsafeBytes { raw in
                Darwin.write(descriptor, raw.baseAddress!.advanced(by: offset), pending.count - offset)
            }
            if sent > 0 { offset += sent; continue }
            if sent < 0 && errno == EINTR { continue }
            if sent < 0 && (errno == EAGAIN || errno == EWOULDBLOCK) { return }
            timer?.cancel(); onFailure(); return
        }
    }
    func stop() { queue.sync { timer?.cancel(); timer = nil } }
}

struct CaptureFailure: Error { let code: String; let status: OSStatus }
func checked(_ status: OSStatus, _ code: String) throws {
    if status != noErr { throw CaptureFailure(code: code, status: status) }
}

@available(macOS 14.2, *)
final class Capture {
    private var tap = AudioObjectID(kAudioObjectUnknown)
    private var device = AudioObjectID(kAudioObjectUnknown)
    private var io: AudioDeviceIOProcID?
    private var running = false
    private(set) var pcm: PCMQueue?
    private(set) var sampleRate: Double = 0
    func prepare() throws {
        // Exclude the helper and its Electron parent when they have HAL objects.
        var excluded: [AudioObjectID] = []
        for process in [getpid(), getppid()] {
            var pid = process
            var object = AudioObjectID(kAudioObjectUnknown)
            var size = UInt32(MemoryLayout<AudioObjectID>.size)
            var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject,
                mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
            let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address,
                UInt32(MemoryLayout<pid_t>.size), &pid, &size, &object)
            if status == noErr && object != kAudioObjectUnknown { excluded.append(object) }
        }
        let description = CATapDescription(monoGlobalTapButExcludeProcesses: excluded)
        description.isPrivate = true
        description.muteBehavior = .unmuted
        description.name = "System Audio"
        try checked(AudioHardwareCreateProcessTap(description, &tap), "tap_create_failed")
        var format = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        var address = AudioObjectPropertyAddress(mSelector: kAudioTapPropertyFormat,
            mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        try checked(AudioObjectGetPropertyData(tap, &address, 0, nil, &size, &format), "tap_format_failed")
        guard format.mFormatID == kAudioFormatLinearPCM,
              format.mFormatFlags & kAudioFormatFlagIsFloat != 0,
              format.mFormatFlags & kAudioFormatFlagIsBigEndian == 0,
              format.mBitsPerChannel == 32, format.mChannelsPerFrame == 1,
              format.mBytesPerFrame == 4,
              format.mSampleRate.isFinite, format.mSampleRate >= 8000,
              format.mSampleRate <= 384000 else {
            throw CaptureFailure(code: "unsupported_audio_format", status: 0)
        }
        sampleRate = format.mSampleRate
        pcm = PCMQueue(frames: max(1, Int(sampleRate * 0.04)))
        // Read the actual HAL UID rather than assuming the description UUID.
        var tapUID: CFString = "" as CFString
        address.mSelector = kAudioTapPropertyUID
        size = UInt32(MemoryLayout<CFString>.size)
        let uidStatus = withUnsafeMutablePointer(to: &tapUID) {
            AudioObjectGetPropertyData(tap, &address, 0, nil, &size, $0)
        }
        try checked(uidStatus, "tap_uid_failed")
        // A tap-only private aggregate cannot add microphone/hardware input.
        let aggregate: [String: Any] = [
            kAudioAggregateDeviceNameKey: "System Audio Capture",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceTapListKey: [[
                kAudioSubTapUIDKey: tapUID,
                kAudioSubTapDriftCompensationKey: true
            ]]
        ]
        try checked(AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &device), "aggregate_create_failed")
        try checked(AudioDeviceCreateIOProcID(device, audioCallback,
            Unmanaged.passUnretained(self).toOpaque(), &io), "io_create_failed")
    }
    func start() throws {
        try checked(AudioDeviceStart(device, io), "audio_start_failed")
        running = true
    }
    func accept(_ input: UnsafePointer<AudioBufferList>) {
        let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
        guard buffers.count == 1, let buffer = buffers.first,
              buffer.mNumberChannels == 1, let data = buffer.mData,
              buffer.mDataByteSize % 4 == 0 else { return }
        pcm?.push(data.assumingMemoryBound(to: Float.self), frames: Int(buffer.mDataByteSize) / 4)
    }
    func stop() {
        if device != kAudioObjectUnknown {
            if running { _ = AudioDeviceStop(device, io); running = false }
            if let io { _ = AudioDeviceDestroyIOProcID(device, io); self.io = nil }
            _ = AudioHardwareDestroyAggregateDevice(device); device = AudioObjectID(kAudioObjectUnknown)
        }
        if tap != kAudioObjectUnknown {
            _ = AudioHardwareDestroyProcessTap(tap); tap = AudioObjectID(kAudioObjectUnknown)
        }
    }
    deinit { stop() }
}

@available(macOS 14.2, *)
private let audioCallback: AudioDeviceIOProc = { _, _, input, _, _, _, context in
    if let context { Unmanaged<Capture>.fromOpaque(context).takeUnretainedValue().accept(input) }
    return noErr
}

// This branch never creates a tap/device or requests permission.
func selfTest() {
    let ring = PCMQueue(frames: 4, capacity: 2)
    let values: [Float] = [0.25, -0.5, 0, 1, -1, 0.5, 0.75, -0.25, 42, 42, 42, 42]
    values.withUnsafeBufferPointer { ring.push($0.baseAddress!, frames: 2) }
    precondition(ring.pop() == nil)
    values.withUnsafeBufferPointer { ring.push($0.baseAddress!.advanced(by: 2), frames: 10) }
    let first = ring.pop()!; let second = ring.pop()!
    precondition(ring.pop() == nil) // third chunk dropped: fixed queue capacity.
    let expectedFirst = values.prefix(4).withContiguousStorageIfAvailable { Data(buffer: $0) }!
    let expectedSecond = values.dropFirst(4).prefix(4).withContiguousStorageIfAvailable { Data(buffer: $0) }!
    precondition(first == expectedFirst && second == expectedSecond)
    values.withUnsafeBufferPointer { ring.push($0.baseAddress!, frames: 4) }
    precondition(ring.pop() == first) // wraparound after overflow.
    let line = pcmLine(first)
    let object = try! JSONSerialization.jsonObject(with: line) as! [String: String]
    precondition(object["type"] == "pcm" && Data(base64Encoded: object["data"]!) == first)
    precondition(first.prefix(4) == Data([0, 0, 128, 62])) // Float32 little endian 0.25.
    // Fill a synthetic pipe beyond its capacity. The serial writer must remain
    // cancellable while a reader is absent, including a partially written packet.
    var pipeFDs: [Int32] = [0, 0]
    precondition(pipe(&pipeFDs) == 0)
    let blockedWriter = ProtocolWriter(initial: Data(repeating: 65, count: 1_048_576),
        pcm: nil, descriptor: pipeFDs[1]) { preconditionFailure("synthetic_pipe_failure") }
    blockedWriter.start()
    Thread.sleep(forTimeInterval: 0.05)
    let start = DispatchTime.now().uptimeNanoseconds
    blockedWriter.stop()
    precondition(DispatchTime.now().uptimeNanoseconds - start < 1_000_000_000)
    _ = fcntl(pipeFDs[0], F_SETFL, O_NONBLOCK)
    var readBytes = [UInt8](repeating: 0, count: 4096)
    let readCount = Darwin.read(pipeFDs[0], &readBytes, readBytes.count)
    precondition(readCount > 0 && readBytes.prefix(readCount).allSatisfy { $0 == 65 })
    close(pipeFDs[0]); close(pipeFDs[1])
    print("{\"type\":\"self_test\",\"ok\":true}")
}

signal(SIGPIPE, SIG_IGN)
if CommandLine.arguments.dropFirst().contains("--self-test") {
    selfTest(); exit(0)
}

@available(macOS 14.2, *)
func runCapture() {
    let capture = Capture()
    var writer: ProtocolWriter?
    var sources: [DispatchSourceSignal] = []
    var stopped = false
    func stop(_ status: Int32 = 0) {
        guard !stopped else { return }; stopped = true
        capture.stop(); writer?.stop()
        exit(status)
    }
    for number in [SIGTERM, SIGINT] {
        signal(number, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
        source.setEventHandler { stop() }; source.resume(); sources.append(source)
    }
    let input = DispatchSource.makeReadSource(fileDescriptor: STDIN_FILENO, queue: .main)
    input.setEventHandler {
        var bytes = [UInt8](repeating: 0, count: 256)
        let count = Darwin.read(STDIN_FILENO, &bytes, bytes.count)
        if count == 0 || (count > 0 && bytes.prefix(count).contains(10)) { stop() }
        if count < 0 && errno != EINTR && errno != EAGAIN { stop() }
    }
    input.resume()
    do {
        try capture.prepare()
        // Emit ready only after AudioDeviceStart succeeds. PCM is buffered meanwhile.
        try capture.start()
        let ready = Data("{\"type\":\"ready\",\"sampleRate\":\(capture.sampleRate),\"channels\":1,\"format\":\"f32le\"}\n".utf8)
        writer = ProtocolWriter(initial: ready, pcm: capture.pcm) {
            DispatchQueue.main.async { stop(1) }
        }
        writer?.start()
    } catch {
        capture.stop()
        let failure = error as? CaptureFailure ?? CaptureFailure(code: "internal_error", status: 0)
        // All error codes are static; no object IDs, UIDs, process or device names.
        let line = "{\"type\":\"error\",\"code\":\"\(failure.code)\",\"status\":\(failure.status)}\n"
        _ = line.withCString { Darwin.write(STDOUT_FILENO, $0, strlen($0)) }
        exit(1)
    }
    withExtendedLifetime((capture, sources, input)) { dispatchMain() }
}

if #available(macOS 14.2, *) { runCapture() }
else { print("{\"type\":\"error\",\"code\":\"unsupported_os\",\"status\":0}"); exit(1) }
