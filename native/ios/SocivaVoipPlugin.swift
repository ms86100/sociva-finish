import Foundation
import UIKit
import Capacitor
import PushKit
import CallKit
import AVFoundation

/**
 * Sociva VoIP: PushKit token + CallKit ring UI.
 * On VoIP push, reportNewIncomingCall runs immediately (Apple requirement).
 * JS claims the PushKit token via claim_voip_token and joins LiveKit after accept.
 */
@objc(SocivaVoipPlugin)
public class SocivaVoipPlugin: CAPPlugin, CAPBridgedPlugin, PKPushRegistryDelegate, CXProviderDelegate {
    public let identifier = "SocivaVoipPlugin"
    public let jsName = "SocivaVoip"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "registerVoipToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestCallPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reportIncomingCall", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endNativeCall", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMuted", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSpeaker", returnType: CAPPluginReturnPromise),
    ]

    private var pushRegistry: PKPushRegistry?
    private var provider: CXProvider?
    private let callController = CXCallController()
    private var cachedVoipToken: String?
    private var callIdToUUID: [String: UUID] = [:]
    private var uuidToCallId: [UUID: String] = [:]
    private var pendingPayloads: [String: [String: Any]] = [:]

    public override func load() {
        setupCallKit()
        setupPushKit()
        print("SocivaVoipPlugin loaded - PushKit + CallKit ready")
    }

    private func setupCallKit() {
        let config = CXProviderConfiguration(localizedName: "Sociva")
        config.supportsVideo = false
        config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.generic]
        if let icon = UIImage(named: "AppIcon") {
            config.iconTemplateImageData = icon.pngData()
        }
        let provider = CXProvider(configuration: config)
        provider.setDelegate(self, queue: nil)
        self.provider = provider
    }

    private func setupPushKit() {
        let registry = PKPushRegistry(queue: DispatchQueue.main)
        registry.delegate = self
        registry.desiredPushTypes = [.voIP]
        self.pushRegistry = registry
    }

    // MARK: - Cap methods

    @objc func registerVoipToken(_ call: CAPPluginCall) {
        if let token = cachedVoipToken, !token.isEmpty {
            call.resolve(["ok": true, "token": token, "platform": "ios_pushkit"])
            return
        }
        if pushRegistry == nil {
            setupPushKit()
        }
        call.resolve(["ok": false, "reason": "waiting_for_pushkit_token"])
    }

    @objc func requestCallPermissions(_ call: CAPPluginCall) {
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            call.resolve(["mic": granted])
        }
    }

    @objc func reportIncomingCall(_ call: CAPPluginCall) {
        guard let callId = call.getString("callId"), !callId.isEmpty else {
            call.reject("callId required")
            return
        }
        let callerName = call.getString("callerName") ?? "Sociva"
        reportCallKitIncoming(callId: callId, callerName: callerName, payload: call.getObject("payload") ?? [:]) { ok, reason in
            if ok {
                call.resolve(["ok": true])
            } else {
                call.resolve(["ok": false, "reason": reason ?? "callkit_failed"])
            }
        }
    }

    @objc func endNativeCall(_ call: CAPPluginCall) {
        guard let callId = call.getString("callId"),
              let uuid = callIdToUUID[callId] else {
            call.resolve()
            return
        }
        let end = CXEndCallAction(call: uuid)
        let tx = CXTransaction(action: end)
        callController.request(tx) { _ in
            call.resolve()
        }
    }

    @objc func setMuted(_ call: CAPPluginCall) {
        let muted = call.getBool("muted") ?? false
        try? AVAudioSession.sharedInstance().setMode(muted ? .voiceChat : .voiceChat)
        call.resolve()
    }

    @objc func setSpeaker(_ call: CAPPluginCall) {
        let speaker = call.getBool("speaker") ?? false
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: speaker ? [.defaultToSpeaker] : [])
            try session.overrideOutputAudioPort(speaker ? .speaker : .none)
            call.resolve()
        } catch {
            call.resolve()
        }
    }

    // MARK: - PushKit

    public func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        guard type == .voIP else { return }
        let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        cachedVoipToken = token
        notifyListeners("voipToken", data: [
            "token": token,
            "platform": "ios_pushkit",
        ])
    }

    public func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        if type == .voIP {
            cachedVoipToken = nil
        }
    }

    public func pushRegistry(
        _ registry: PKPushRegistry,
        didReceiveIncomingPushWith payload: PKPushPayload,
        for type: PKPushType,
        completion: @escaping () -> Void
    ) {
        guard type == .voIP else {
            completion()
            return
        }
        let dict = payload.dictionaryPayload
        let callId = (dict["call_id"] as? String) ?? UUID().uuidString
        let callerName = (dict["caller_name"] as? String) ?? "Sociva"
        reportCallKitIncoming(callId: callId, callerName: callerName, payload: dict) { _, _ in
            completion()
        }
        notifyListeners("incoming", data: [
            "callId": callId,
            "callerName": callerName,
            "payload": dict,
        ])
    }

    // MARK: - CallKit helpers

    private func reportCallKitIncoming(
        callId: String,
        callerName: String,
        payload: [String: Any],
        done: @escaping (Bool, String?) -> Void
    ) {
        let uuid = callIdToUUID[callId] ?? UUID()
        callIdToUUID[callId] = uuid
        uuidToCallId[uuid] = callId
        pendingPayloads[callId] = payload

        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: callerName)
        update.localizedCallerName = callerName
        update.hasVideo = false
        update.supportsDTMF = false
        update.supportsHolding = false
        update.supportsGrouping = false
        update.supportsUngrouping = false

        provider?.reportNewIncomingCall(with: uuid, update: update) { error in
            if let error = error {
                done(false, error.localizedDescription)
            } else {
                done(true, nil)
            }
        }
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth])
            try session.setActive(true)
        } catch {
            print("SocivaVoip audio session error: \(error)")
        }
    }

    // MARK: - CXProviderDelegate

    public func providerDidReset(_ provider: CXProvider) {
        callIdToUUID.removeAll()
        uuidToCallId.removeAll()
        pendingPayloads.removeAll()
    }

    public func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        configureAudioSession()
        let callId = uuidToCallId[action.callUUID] ?? action.callUUID.uuidString
        notifyListeners("accepted", data: [
            "callId": callId,
            "payload": pendingPayloads[callId] ?? [:],
        ])
        action.fulfill()
    }

    public func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        let callId = uuidToCallId[action.callUUID] ?? action.callUUID.uuidString
        notifyListeners("ended", data: ["callId": callId])
        callIdToUUID.removeValue(forKey: callId)
        uuidToCallId.removeValue(forKey: action.callUUID)
        pendingPayloads.removeValue(forKey: callId)
        action.fulfill()
    }

    public func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        notifyListeners("audioRoute", data: ["active": true])
    }

    public func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        notifyListeners("audioRoute", data: ["active": false])
    }
}
